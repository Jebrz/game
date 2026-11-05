import { describe, expect, it } from 'vitest';
import { CATASTROPHE } from '../src/config/balance';
import * as A from '../src/sim/actions';
import { advance } from '../src/sim/clock';
import { estimate, frontSpeed, minutesUntil, predictAtArrival } from '../src/sim/catastrophe';
import { applyScheduledSwap } from '../src/sim/hangar';
import { mineralStatus } from '../src/sim/objectives';
import { deserialize, serialize } from '../src/sim/save';
import { createInitialState } from '../src/sim/state';
import { step } from '../src/sim/step';
import type { GameState, PlanetState } from '../src/sim/types';
import { legFuel, obtainableFuel } from '../src/sim/world';
import { autoPlayer, botInterval, type BotOpts } from './autoplay';
import { toLegacy } from './legacy';

function started(seed = 3): GameState {
  const s = createInitialState(seed);
  A.startGame(s);
  return s;
}

/** 让列车直接具备离站条件并前往 index（测试辅助：使用正常的离站函数） */
function travelTo(s: GameState, index: number): void {
  s.train.driveRepaired = true;
  s.inventory.trainFuel += 60;
  A.departTo(s, index);
  if (s.phase !== 'travel') throw new Error(`无法离站：${A.canDepartTo(s, index)}`);
  while (s.phase === 'travel') step(s);
}

function play(seed: number, o: BotOpts, until: (s: GameState) => boolean = () => false, max = 6000): GameState {
  const s = createInitialState(seed);
  for (let i = 0; i < max && !A.stageComplete(s) && s.phase !== 'failed' && !until(s); i++) {
    if (s.time % botInterval(o) === 0) autoPlayer(s, o);
    s.paused = false;
    step(s);
  }
  return s;
}

describe('灾变：由慢到快', () => {
  it('推进速度单调加快；起始星球有足够时间（约 1800 分钟后才抵达）', () => {
    let last = 0;
    for (let t = 0; t <= 3000; t += 50) {
      const v = frontSpeed(t);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(frontSpeed(0)).toBeCloseTo(CATASTROPHE.v0);
    const s = started();
    const eta = estimate(s).remaining;
    expect(eta).toBeGreaterThan(1500);
    expect(eta).toBeLessThan(1850);
  });

  it('预计到达平滑变化，无跳变；暂停不推进', () => {
    const s = started(5);
    let prev = estimate(s);
    for (let i = 0; i < 1500; i++) {
      step(s);
      const e = estimate(s);
      expect(prev.remaining - e.remaining).toBeGreaterThanOrEqual(0.9); // 每分钟至少减少约 1 分钟
      expect(prev.remaining - e.remaining).toBeLessThanOrEqual(1.1); // 不会突然缩短
      expect(Math.abs(prev.low - e.low)).toBeLessThanOrEqual(3);
      prev = e;
    }
    s.paused = true;
    const f = s.catastrophe.front;
    advance(s, { acc: 0 }, 5000);
    expect(s.catastrophe.front).toBe(f);
  });

  it('换星球不重置灾变；出发前的预测与到达后的实际一致；交易站停泊时冻结', () => {
    const s = started(7);
    for (let i = 0; i < 600; i++) step(s);
    const f0 = s.catastrophe.front;
    const pred = predictAtArrival(s, s.journey.nodes[1].pos);
    travelTo(s, 1);
    expect(s.catastrophe.front).toBeGreaterThan(f0);
    expect(s.time).toBe(pred.arriveAt);
    expect(Math.abs(estimate(s).remaining - pred.remaining)).toBeLessThanOrEqual(2);
    // 后续星球的可停留时间短于起始星球的初始窗口（灾变在加速）
    expect(pred.remaining).toBeLessThan(estimate(started(7)).remaining);
    travelTo(s, s.journey.nodes.length - 1);
    expect(s.phase).toBe('station');
    const fs = s.catastrophe.front;
    for (let i = 0; i < 300; i++) step(s);
    expect(s.catastrophe.front).toBe(fs);
  });

  it('首站稍慢离开，下一站也不会抵达即失败', () => {
    const s = started(9);
    // 拖到危险边缘才离开起始星球
    while (estimate(s).low > CATASTROPHE.edgeAt) step(s);
    s.paused = false;
    const p = predictAtArrival(s, s.journey.nodes[1].pos);
    expect(p.remaining).toBeGreaterThan(200);
  });
});

describe('航线与星球生成', () => {
  it('同一种子生成完全相同的航线与地图（读档不会刷新）', () => {
    expect(JSON.stringify(createInitialState(42).journey)).toBe(JSON.stringify(createInitialState(42).journey));
    expect(JSON.stringify(createInitialState(42).planet)).toBe(JSON.stringify(createInitialState(42).planet));
  });

  it('起始星球安全富矿；2～3 颗星球；各类资源/原住民组合都会出现；每站都有可行燃料来源', () => {
    const combos = new Set<string>();
    const counts = new Set<number>();
    for (let seed = 1; seed <= 300; seed++) {
      const s = createInitialState(seed);
      const nodes = s.journey.nodes;
      expect(nodes[0].kind).toBe('planet');
      expect(nodes[nodes.length - 1].kind).toBe('station');
      const planets = nodes.filter((n) => n.kind === 'planet').length;
      counts.add(planets);
      expect(planets).toBeGreaterThanOrEqual(2);
      expect(planets).toBeLessThanOrEqual(3);
      const P0 = s.planet!;
      expect(P0.resourceProfile).toBe('rich');
      expect(P0.natives.kind).toBe('none');
      // 起始星球：维修主驱动 + 第一段燃料都能在本星取得
      expect(obtainableFuel(P0)).toBeGreaterThanOrEqual(legFuel(nodes[1].pos - nodes[0].pos));
      for (let i = 1; i < nodes.length - 1; i++) {
        const P = nodes[i].planet!;
        combos.add(`${P.resourceProfile}/${P.natives.kind}`);
        // 保底：不需要先去下一颗星球就能取得下一段燃料（不计敌对禁区、未许可领地按友好可协商计入）
        expect(obtainableFuel(P, 0), `seed ${seed} ${P.name}`).toBeGreaterThanOrEqual(legFuel(nodes[i + 1].pos - nodes[i].pos));
        if (P.resourceProfile === 'barren') expect(P.deposits.filter((d) => d.zone !== 'hostile' && d.zone !== 'permit').length).toBe(0);
        if (P.natives.kind === 'hostile') {
          expect(P.deposits.some((d) => d.zone === 'hostile')).toBe(true);
        }
      }
    }
    expect(counts).toEqual(new Set([2, 3]));
    for (const r of ['rich', 'poor', 'barren']) for (const n of ['none', 'friendly', 'hostile']) expect(combos.has(`${r}/${n}`), `${r}/${n}`).toBe(true);
  });

  it('燃料不足时说明缺口且不扣燃料；可跳过星球（需要更多燃料）', () => {
    const s = started();
    s.train.driveRepaired = true;
    s.inventory.trainFuel = 2;
    expect(A.canDepartTo(s, 1)).toContain('缺');
    A.departTo(s, 1);
    expect(s.phase).toBe('planet');
    expect(s.inventory.trainFuel).toBe(2);
    const far = s.journey.nodes.length - 1;
    const needFar = legFuel(s.journey.nodes[far].pos);
    s.inventory.trainFuel = needFar;
    A.departTo(s, far);
    expect(s.phase).toBe('travel');
    expect(s.inventory.trainFuel).toBe(0);
    for (let i = 1; i < far; i++) expect(s.journey.nodes[i].status).toBe('skipped');
  });
});

describe('跨星球保留状态', () => {
  it('运输机、升级、贡献点、研究与制造订单跨星球保留；起始星球地图存回航线节点', () => {
    const s = started(11);
    for (let i = 0; i < 400; i++) step(s);
    s.inventory = { ...s.inventory, parts: 30, iron: 80, copper: 40, crystal: 30, ice: 10 };
    s.train.driveRepaired = true;
    s.shuttles[0].upgrades.push('drill');
    s.groups[0].points = 123;
    s.research.done.push('propellantRefine');
    A.captainOrderShuttle(s);
    // 等小组回来再离站
    while (A.outsideGroups(s).length) step(s);
    const before = JSON.stringify({ sh: s.shuttles.map((x) => [x.id, x.serial, x.upgrades]), q: s.queue.map((j) => [j.id, j.kind]), r: s.research.done });
    const ptsBefore = s.groups.map((g) => g.points);
    const p0 = s.planet!;
    const discovered = p0.deposits.filter((d) => d.discoveredBy != null).length;
    s.inventory.trainFuel = 40;
    A.departTo(s, 1);
    expect(s.planet).toBeNull();
    expect(s.journey.nodes[0].planet).toBe(p0);
    // 航行中制造继续推进，但不会重复生成
    while (s.phase === 'travel') step(s);
    expect(s.phase).toBe('planet');
    expect(s.planet!.name).toBe(s.journey.nodes[1].name);
    expect(s.journey.nodes[1].planet).toBeNull();
    expect(s.journey.nodes[0].planet!.deposits.filter((d) => d.discoveredBy != null).length).toBe(discovered);
    const after = JSON.parse(JSON.stringify({ sh: s.shuttles.map((x) => [x.id, x.serial, x.upgrades]), q: s.queue.map((j) => [j.id, j.kind]), r: s.research.done }));
    const b = JSON.parse(before);
    for (const [id, serial, ups] of b.sh) {
      const a = after.sh.find((x: [number, string, string[]]) => x[0] === id);
      expect(a[1]).toBe(serial);
      expect(a[2]).toEqual(expect.arrayContaining(ups)); // 升级保留（航行中小组可能再买新的）
    }
    expect(after.r).toEqual(expect.arrayContaining(b.r));
    expect(s.shuttles.length).toBeLessThanOrEqual(3);
    // 贡献点不清零（航行中小组可能自主消费，但不会凭空增加）
    s.groups.forEach((g, i) => expect(g.points).toBeLessThanOrEqual(ptsBefore[i] + 1e-9));
    expect(s.inventory.iron).toBeGreaterThanOrEqual(0);
  });

  it('在离站前、航行中与第二颗星球存读档，继续运行结果一致，不重复发奖励', () => {
    const o: BotOpts = { style: 'expert', buildShuttle: true };
    const checkpoints: ((s: GameState) => boolean)[] = [
      (s) => s.phase === 'planet' && s.journey.current === 0 && s.recallActive,
      (s) => s.phase === 'travel',
      (s) => s.phase === 'planet' && s.journey.current === 1 && s.time - s.journey.nodes[1].arrivedAt > 120,
    ];
    for (const cp of checkpoints) {
      const s = play(13, o, cp);
      expect(cp(s)).toBe(true);
      const raw = serialize(s);
      const a = deserialize(raw);
      const b = deserialize(raw);
      for (let i = 0; i < 500; i++) {
        if (a.time % 5 === 0) autoPlayer(a, o);
        if (b.time % 5 === 0) autoPlayer(b, o);
        a.paused = b.paused = false;
        step(a);
        step(b);
      }
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      const earned = a.groups.reduce((x, g) => x + g.pointsEarned, 0);
      expect(Math.abs(earned - a.pointsIssued)).toBeLessThan(1e-6);
    }
  });
});

describe('星球类型与原住民', () => {
  const findSeed = (pred: (P: PlanetState) => boolean): [number, number] => {
    for (let seed = 1; seed < 400; seed++) {
      const s = createInitialState(seed);
      const i = s.journey.nodes.findIndex((n, k) => k > 0 && n.planet && pred(n.planet));
      if (i > 0) return [seed, i];
    }
    throw new Error('找不到符合条件的种子');
  };

  it('无矿星：调查前显示「尚未发现矿点」，调查后显示「确认无可采矿产」；遗留燃料只发一次', () => {
    const [seed, idx] = findSeed((P) => P.resourceProfile === 'barren' && P.natives.kind === 'none');
    const s = started(seed);
    travelTo(s, idx);
    const P = s.planet!;
    A.startScan(s);
    s.paused = false;
    for (let i = 0; i < 25; i++) step(s);
    expect(mineralStatus(P)).toContain('尚未发现矿点');
    const cache = P.signs.reduce((a, x) => a + (x.loot.trainFuel ?? 0), 0);
    expect(cache).toBeGreaterThanOrEqual(legFuel(s.journey.nodes[idx + 1].pos - s.journey.nodes[idx].pos));
    const fuel0 = s.inventory.trainFuel;
    for (let i = 0; i < 900 && P.signs.some((x) => !x.explored); i++) step(s);
    while (A.outsideGroups(s).length) step(s);
    expect(mineralStatus(P)).toBe('调查后确认：无可采矿产');
    expect(s.inventory.trainFuel - fuel0).toBe(cache);
    for (let i = 0; i < 300; i++) step(s);
    expect(s.inventory.trainFuel - fuel0).toBe(cache);
  });

  it('敌对原住民：禁区内矿点与迹象从不被小组作为目标', () => {
    const [seed, idx] = findSeed((P) => P.natives.kind === 'hostile');
    const s = started(seed);
    travelTo(s, idx);
    const P = s.planet!;
    A.startScan(s);
    s.paused = false;
    for (const d of P.deposits) d.discoveredBy = s.groups[0].id; // 让小组知道禁区矿点
    const hostileDeps = new Set(P.deposits.filter((d) => d.zone === 'hostile').map((d) => d.id));
    const restricted = new Set(P.signs.filter((x) => x.restricted).map((x) => x.id));
    expect(hostileDeps.size).toBeGreaterThan(0);
    for (let i = 0; i < 600; i++) {
      step(s);
      for (const g of s.groups) {
        if (g.target?.depositId != null) expect(hostileDeps.has(g.target.depositId)).toBe(false);
        if (g.target?.signId != null) expect(restricted.has(g.target.signId)).toBe(false);
      }
    }
    expect(P.natives.detected).toBe(true);
  });

  it('可交流原住民：接触后可交易（扣对应物资）与协商采矿许可；许可前小组不进领地采矿', () => {
    const [seed, idx] = findSeed((P) => P.natives.kind === 'friendly');
    const s = started(seed);
    travelTo(s, idx);
    const P = s.planet!;
    expect(A.canTrade(s, 'fuel')).toContain('尚未与');
    A.startScan(s);
    s.paused = false;
    for (const d of P.deposits) d.discoveredBy = s.groups[0].id;
    const permitDeps = new Set(P.deposits.filter((d) => d.zone === 'permit').map((d) => d.id));
    for (let i = 0; i < 1200 && !P.natives.contacted; i++) {
      step(s);
      if (!P.natives.permits.length) for (const g of s.groups) if (g.target?.depositId != null) expect(permitDeps.has(g.target.depositId)).toBe(false);
    }
    expect(P.natives.contacted).toBe(true);
    s.inventory.food = 100;
    s.inventory.parts = 5;
    const f0 = s.inventory.trainFuel;
    const food0 = s.inventory.food;
    A.trade(s, 'fuel');
    expect(s.inventory.trainFuel).toBe(f0 + 3);
    expect(s.inventory.food).toBe(food0 - 15);
    // 存货用尽后无法继续
    A.trade(s, 'fuel');
    A.trade(s, 'fuel');
    expect(A.canTrade(s, 'fuel')).toContain('没有可交换');
    // 协商许可：需要翻译；库存不足不能支付；成功后只对指定矿点有效
    const dep = P.deposits.find((d) => d.zone === 'permit')!;
    dep.discoveredBy = s.groups[0].id;
    expect(A.canNegotiate(s, dep, 'pay')).toContain('翻译');
    s.research.done.push('translation');
    s.inventory.parts = 0;
    expect(A.canNegotiate(s, dep, 'pay')).toContain('不足');
    s.inventory.parts = 5;
    A.negotiate(s, dep.id, 'pay');
    expect(P.natives.permits.length).toBe(1);
    expect(s.inventory.parts).toBe(4);
    expect(A.canNegotiate(s, dep, 'pay')).toContain('已有有效许可');
  });
});

describe('预约换装', () => {
  it('小组出勤时可预约公共备用机，返航卸货后自动换装；预约期间他组不能取得该机', () => {
    const s = started(3);
    s.inventory = { ...s.inventory, parts: 20, iron: 60, copper: 30, crystal: 20 };
    s.train.driveRepaired = true;
    A.startScan(s);
    s.paused = false;
    A.captainOrderShuttle(s);
    for (let i = 0; i < 400 && !s.shuttles.some((x) => x.builtAt >= 0); i++) step(s);
    const sp = s.shuttles.find((x) => x.builtAt >= 0)!;
    let g = s.groups.find((x) => !['docked', 'resting', 'grounded'].includes(x.state));
    for (let i = 0; i < 200 && !g; i++) {
      step(s);
      g = s.groups.find((x) => !['docked', 'resting', 'grounded'].includes(x.state));
    }
    expect(g).toBeTruthy();
    expect(A.canSwap(s, g!, sp, 'captain')).not.toBe('');
    A.captainScheduleSwap(s, g!.id, sp.id);
    expect(g!.pendingSwap).toBe(sp.id);
    const other = s.groups.find((x) => x !== g)!;
    expect(A.canSwap(s, other, sp, 'captain')).toContain('已安排');
    expect(A.canAssignCaptain(s, sp.id)).toContain('已安排');
    for (let i = 0; i < 400 && g!.shuttleId !== sp.id; i++) step(s);
    expect(g!.shuttleId).toBe(sp.id);
    expect(g!.pendingSwap).toBeNull();
    expect(applyScheduledSwap(s, g!)).toBe(false);
  });
});

describe('旧存档迁移（v2 单星球 → v3）', () => {
  it('星球上的旧存档：灾变剩余时间不变，用 10 单位燃料即可前往交易站，完成旧阶段', () => {
    const s = started(2);
    for (let i = 0; i < 300; i++) step(s);
    const loaded = deserialize(toLegacy(s, 2, 960));
    expect(loaded.version).toBe(6);
    expect(loaded.journey.nodes.map((n) => n.kind)).toEqual(['planet', 'station']);
    expect(Math.abs(minutesUntil(loaded.catastrophe.front, loaded.time, 0) - (960 - s.time))).toBeLessThan(1);
    expect(loaded.inventory).toEqual(s.inventory); // 不重复发资源
    loaded.train.driveRepaired = true;
    loaded.inventory.trainFuel = 10;
    loaded.paused = false;
    while (A.outsideGroups(loaded).length) step(loaded);
    expect(A.canDepartTo(loaded, 1)).toBe('');
    A.departTo(loaded, 1);
    while (loaded.phase === 'travel') step(loaded);
    expect(loaded.phase).toBe('station');
  });

  it('航行中与交易站的旧存档可继续', () => {
    const s = started(2);
    s.train.driveRepaired = true;
    s.inventory.trainFuel = 40;
    while (A.outsideGroups(s).length) step(s);
    A.departTo(s, 1);
    for (let i = 0; i < 30; i++) step(s);
    const t = deserialize(toLegacy(s, 2));
    expect(t.phase).toBe('travel');
    expect(t.planet).toBeNull();
    expect(t.journey.nodes[0].planet).not.toBeNull();
    while (t.phase === 'travel') step(t);
    expect(t.phase).toBe('station');
  });
});

describe('脚本玩家（区分最优脚本与新手节奏）', () => {
  it('expert 与 novice 在 10 个种子下都能从起始星球走完航线并抵达交易站；起始星球停留时间充足', () => {
    for (const style of ['expert', 'novice'] as const) {
      for (let seed = 1; seed <= 10; seed++) {
        const s = play(seed, { style, buildShuttle: true });
        expect(A.stageComplete(s), `${style} seed ${seed}: ${s.failReason}`).toBe(true);
        const n0 = s.journey.nodes[0];
        expect(n0.departedAt - n0.arrivedAt, `${style} seed ${seed}`).toBeGreaterThan(1000);
        expect(s.stats.leftBehind).toBe(0);
      }
    }
  });
});
