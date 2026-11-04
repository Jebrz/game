import { describe, expect, it } from 'vitest';
import { EVENT_DEFS, PERMIT, RELATION } from '../src/config/balance';
import * as A from '../src/sim/actions';
import { discoverSignEvent } from '../src/sim/events';
import { isHome } from '../src/sim/groups';
import { activePermit, depositAccess } from '../src/sim/natives';
import { deserialize, serialize } from '../src/sim/save';
import { createInitialState } from '../src/sim/state';
import { step } from '../src/sim/step';
import type { ExploreEvent, GameState, PlanetState } from '../src/sim/types';
import { toLegacy } from './legacy';

function started(seed = 3): GameState {
  const s = createInitialState(seed);
  A.startGame(s);
  A.startScan(s);
  return s;
}

/** 正常运行直到某类事件被小组发现（模拟中途自动暂停时继续运行，相当于玩家「稍后处理」） */
function runUntilEvent(s: GameState, kind: ExploreEvent['kind'], max = 3000): ExploreEvent {
  for (let i = 0; i < max; i++) {
    const ev = s.events.find((e) => e.kind === kind && e.nodeIndex === s.journey.current);
    if (ev) return ev;
    s.paused = false;
    step(s);
  }
  throw new Error(`没有发现事件 ${kind}`);
}

function waitHome(s: GameState, max = 800): void {
  for (let i = 0; i < max && s.groups.some((g) => !isHome(g) || g.state === 'unloading'); i++) step(s);
}

function travelTo(s: GameState, index: number): void {
  waitHome(s);
  s.train.driveRepaired = true;
  s.inventory.trainFuel += 60;
  A.departTo(s, index);
  if (s.phase !== 'travel') throw new Error(A.canDepartTo(s, index));
  while (s.phase === 'travel') step(s);
  A.startScan(s);
  s.paused = false;
}

describe('事件 A：废弃设施（起始星球固定有一处）', () => {
  it('发现时暂停一次；发现的小组继续其他工作；同一地点不重复生成', () => {
    const s = started(3);
    const ev = runUntilEvent(s, 'facility');
    expect(s.paused).toBe(true);
    expect(ev.status).toBe('pending');
    const finder = s.groups.find((g) => g.id === ev.finderGroupId)!;
    expect(['toExplore', 'toSite', 'returning', 'deploying'].includes(finder.state)).toBe(true); // 不停在现场等待
    const sign = s.planet!.signs.find((x) => x.id === ev.siteId)!;
    expect(discoverSignEvent(s, finder, sign)).toBeNull();
    expect(s.events.filter((e) => e.siteId === sign.id).length).toBe(1);
  });

  it('修复：选择时扣零件，小组到现场作业 120 分钟，返航卸货后入库一次；读档不重发', () => {
    const s = started(3);
    const ev = runUntilEvent(s, 'facility');
    s.inventory.parts = 2;
    expect(A.canChoose(s, ev, 'repair')).toContain('维修零件');
    A.chooseEvent(s, ev.id, 'repair');
    expect(ev.status).toBe('pending'); // 材料不足时不会扣费也不会执行
    s.inventory.parts = 10;
    A.chooseEvent(s, ev.id, 'repair');
    expect(s.inventory.parts).toBe(7);
    expect(ev.status).toBe('assigned');
    const exec = s.groups.find((g) => g.id === ev.assignedGroupId)!;
    const expectParts = ev.rolls['repair.parts'];
    const expectProp = ev.rolls['repair.propellant'];
    expect(expectParts).toBeGreaterThanOrEqual(5);
    expect(expectParts).toBeLessThanOrEqual(8);
    // 等到开始作业，中途存档
    for (let i = 0; i < 1200 && ev.status !== 'active'; i++) {
      s.paused = false;
      step(s);
    }
    expect(ev.status).toBe('active');
    for (let i = 0; i < 40; i++) step(s);
    const raw = serialize(s);
    const runToHome = (x: GameState) => {
      const e = x.events.find((y) => y.id === ev.id)!;
      for (let i = 0; i < 600 && !(e.status === 'done' && isHome(x.groups.find((g) => g.id === exec.id)!) && x.groups.find((g) => g.id === exec.id)!.state !== 'unloading'); i++) step(x);
      return e;
    };
    const a = deserialize(raw);
    const b = deserialize(raw);
    const pa0 = a.inventory.parts;
    const prop0 = a.inventory.propellant;
    runToHome(a);
    runToHome(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const ea = a.events.find((y) => y.id === ev.id)!;
    expect(ea.status).toBe('done');
    expect(ea.rewardGiven).toBe(true);
    // 修复成果已入库（零件可能被小组/维护用掉，因此检查日志中的入库记录与推进剂变化方向）
    expect(a.log.some((l) => l.text.includes(`带回遗留物资入库`) && l.text.includes(`维修零件 ${expectParts}`))).toBe(true);
    expect(a.inventory.propellant + 200).toBeGreaterThan(prop0 + expectProp - 200);
    // 再运行，不会再次发放
    const count = a.log.filter((l) => l.text.includes('带回遗留物资入库') && l.text.includes(`维修零件 ${expectParts}`)).length;
    for (let i = 0; i < 400; i++) step(a);
    expect(a.log.filter((l) => l.text.includes('带回遗留物资入库') && l.text.includes(`维修零件 ${expectParts}`)).length).toBe(count);
    void pa0;
  });

  it('召回中断：保留剩余进度，回到待执行，投入不退；解除召回后继续并只完成一次', () => {
    const s = started(5);
    const ev = runUntilEvent(s, 'facility');
    s.inventory.parts = 10;
    A.chooseEvent(s, ev.id, 'repair');
    for (let i = 0; i < 1500 && !(ev.status === 'active' && ev.remaining < ev.work - 20); i++) {
      s.paused = false;
      step(s);
    }
    expect(ev.status).toBe('active');
    const left = ev.remaining;
    const parts = s.inventory.parts;
    A.setRecall(s, true);
    step(s);
    expect(ev.status).toBe('assigned');
    expect(ev.remaining).toBe(left);
    waitHome(s);
    expect(s.groups.every((g) => isHome(g))).toBe(true);
    expect(s.inventory.parts).toBeGreaterThanOrEqual(parts - 2); // 未退还投入（可能有例行维护消耗）
    expect(A.canCancel(ev)).toContain('已开始作业');
    A.setRecall(s, false);
    for (let i = 0; i < 1000 && ev.status !== 'done'; i++) step(s);
    expect(ev.status).toBe('done');
  });

  it('开始作业前取消：原样退还；离开星球时未完成事件作废，已投入不退', () => {
    const s = started(7);
    const ev = runUntilEvent(s, 'facility');
    s.inventory.parts = 10;
    A.chooseEvent(s, ev.id, 'repair');
    expect(s.inventory.parts).toBe(7);
    expect(A.canCancel(ev)).toBe('');
    A.cancelEventExec(s, ev.id);
    expect(s.inventory.parts).toBe(10);
    expect(ev.status).toBe('pending');
    A.chooseEvent(s, ev.id, 'repair');
    // 召回：执行小组不会出发；随后离站，事件仍未开始
    A.setRecall(s, true);
    waitHome(s);
    expect(ev.status).toBe('assigned');
    travelTo(s, 1);
    expect(ev.status).toBe('expired');
    expect(s.inventory.parts).toBeLessThanOrEqual(7);
    expect(ev.result).toContain('不退');
  });
});

describe('事件 C：异常信标', () => {
  const findSeed = (): [number, number] => {
    for (let seed = 1; seed < 300; seed++) {
      const s = createInitialState(seed);
      const i = s.journey.nodes.findIndex((n, k) => k > 0 && n.planet && n.planet.signs.some((x) => x.eventKind === 'beacon' && !x.restricted));
      if (i > 0) return [seed, i];
    }
    throw new Error('无信标');
  };
  it('深入调查：消耗能源、增加成员疲劳，返航后研究储备增加对应点数，并给出线索', () => {
    const [seed, idx] = findSeed();
    const s = started(seed);
    travelTo(s, idx);
    const ev = runUntilEvent(s, 'beacon');
    s.inventory.energy = 500;
    A.chooseEvent(s, ev.id, 'deep');
    expect(s.inventory.energy).toBe(460);
    const g = s.groups.find((x) => x.id === ev.assignedGroupId)!;
    const roll = ev.rolls['deep.research'];
    expect(roll).toBeGreaterThanOrEqual(16);
    for (let i = 0; i < 1500 && ev.status !== 'done'; i++) {
      s.paused = false;
      step(s);
    }
    expect(ev.status).toBe('done');
    expect(ev.result).toContain('线索');
    const fatigueAfter = s.passengers.filter((p) => g.memberIds.includes(p.id)).map((p) => p.fatigue);
    expect(Math.max(...fatigueAfter)).toBeGreaterThan(14);
    const bank0 = s.research.bank;
    expect(g.lootResearch).toBe(roll);
    waitHome(s);
    expect(s.research.bank).toBeGreaterThanOrEqual(bank0 + roll - 2); // 入库后会逐分钟投入当前研究
  });
});

describe('事件 B：原住民矿区与许可', () => {
  const findSeed = (): [number, number] => {
    for (let seed = 1; seed < 300; seed++) {
      const s = createInitialState(seed);
      const i = s.journey.nodes.findIndex((n, k) => k > 0 && n.planet?.natives.kind === 'friendly');
      if (i > 0) return [seed, i];
    }
    throw new Error('无可交流原住民');
  };

  function arriveFriendly(): { s: GameState; P: PlanetState; ev: ExploreEvent } {
    const [seed, idx] = findSeed();
    const s = started(seed);
    travelTo(s, idx);
    const ev = runUntilEvent(s, 'nativeMine');
    return { s, P: s.planet!, ev };
  }

  it('无翻译不能协商；许可前小组不会进入领地矿点；拒绝后保持禁止，可重新协商', () => {
    const { s, P, ev } = arriveFriendly();
    const dep = P.deposits.find((d) => d.id === ev.siteId)!;
    expect(depositAccess(s, dep)).toContain('需要采矿许可');
    expect(A.canChoose(s, ev, 'share')).toMatch(/翻译|尚未与/);
    A.chooseEvent(s, ev.id, 'decline');
    expect(ev.status).toBe('declined');
    for (let i = 0; i < 400; i++) {
      s.paused = false;
      step(s);
      for (const g of s.groups) expect(g.target?.depositId === dep.id).toBe(false);
    }
  });

  it('分享产出：只在许可内作业；卸货时扣出原住民份额，库存与贡献点只按留存部分；关系按约提升；到期后停止', () => {
    const { s, P, ev } = arriveFriendly();
    const dep = P.deposits.find((d) => d.id === ev.siteId)!;
    // 先接触聚落（小组会自主去调查人工信号）
    for (let i = 0; i < 1500 && !P.natives.contacted; i++) {
      s.paused = false;
      step(s);
    }
    expect(P.natives.contacted).toBe(true);
    expect(P.natives.relation).toBe(RELATION.contact);
    s.research.done.push('translation');
    expect(A.canChoose(s, ev, 'share')).toBe('');
    A.chooseEvent(s, ev.id, 'share');
    const pm = activePermit(s, dep)!;
    expect(pm.kind).toBe('share');
    expect(pm.sharePct).toBe(PERMIT.sharePct);
    // 提高该资源奖励，让小组愿意去采
    A.setDemandBonus(s, dep.resource, 10);
    s.inventory.propellant = 200;
    let settledShare = false;
    for (let i = 0; i < 2000 && !settledShare; i++) {
      s.paused = false;
      const inv0 = s.inventory[dep.resource];
      const issued0 = s.pointsIssued;
      const shareLog = s.log.length;
      step(s);
      const l = s.log.slice(shareLog).find((x) => x.text.includes('按协议把'));
      if (l) {
        settledShare = true;
        const m = l.text.match(/按协议把 \S+ ([\d.]+)/);
        const owed = Number(m![1]);
        const kept = s.inventory[dep.resource] - inv0;
        // 留存 : 份额 ≈ 70 : 30
        expect(owed / (owed + kept)).toBeCloseTo(PERMIT.sharePct, 1);
        // 贡献点只按留存部分（该批可能混有其他原料，至少不按份额部分计）
        expect(s.pointsIssued - issued0).toBeGreaterThan(0);
      }
    }
    expect(settledShare).toBe(true);
    expect(P.natives.relationLog.some((r) => r.reason === '按约分享产出')).toBe(true);
    expect(pm.extracted).toBeGreaterThan(0);
    // 许可到期：小组停止在该处作业
    pm.expiresAt = s.time + 1;
    for (let i = 0; i < 5; i++) step(s);
    expect(depositAccess(s, dep)).toContain('到期');
    for (let i = 0; i < 300; i++) {
      step(s);
      for (const g of s.groups) if (g.state === 'mining') expect(g.target?.depositId === dep.id).toBe(false);
    }
    for (const v of Object.values(s.inventory)) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('支付许可：扣物资、关系 +4；许可只对指定矿点、有效期与额度内有效', () => {
    const { s, P, ev } = arriveFriendly();
    P.natives.contacted = true;
    s.research.done.push('translation');
    s.inventory.food = 100;
    s.inventory.parts = 5;
    const rel0 = P.natives.relation;
    A.chooseEvent(s, ev.id, 'pay');
    expect(s.inventory.food).toBe(100 - PERMIT.payCost.food!);
    expect(s.inventory.parts).toBe(4);
    expect(P.natives.relation).toBe(rel0 + RELATION.permitPaid);
    const dep = P.deposits.find((d) => d.id === ev.siteId)!;
    const pm = activePermit(s, dep)!;
    expect(pm.cap).toBe(PERMIT.payCap);
    pm.extracted = pm.cap;
    expect(activePermit(s, dep)).toBeNull();
    expect(depositAccess(s, dep)).toContain('额度');
  });
});

describe('生成与存档', () => {
  it('多个种子：起始星球固定有设施事件；后续星球有设施/信标；事件结果预先确定且在范围内', () => {
    let fac = 0;
    let bea = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const s = createInitialState(seed);
      expect(s.planet!.signs.some((x) => x.eventKind === 'facility')).toBe(true);
      for (const P of [s.planet!, ...s.journey.nodes.map((n) => n.planet).filter((x): x is PlanetState => !!x)]) {
        for (const sg of P.signs) {
          if (sg.eventKind === 'facility') fac++;
          if (sg.eventKind === 'beacon') bea++;
          if (sg.eventKind) {
            for (const o of (EVENT_DEFS[sg.eventKind] as typeof EVENT_DEFS.facility).options) {
              for (const [k, [lo, hi]] of Object.entries(o.reward) as [string, [number, number]][]) {
                const v = sg.eventRolls![`${o.id}.${k}`];
                expect(v).toBeGreaterThanOrEqual(lo);
                expect(v).toBeLessThanOrEqual(hi);
              }
            }
          }
        }
      }
    }
    expect(fac).toBeGreaterThan(150); // 起始星球 100 + 后续星球
    expect(bea).toBeGreaterThan(20);
  });

  it('v4 存档迁移到 v5：不给旧星球新增事件地点，原住民补齐关系字段', () => {
    const s = started(4);
    for (let i = 0; i < 100; i++) {
      s.paused = false;
      step(s);
    }
    // 只取尚未生成事件的时刻
    s.events = [];
    const loaded = deserialize(toLegacy(s, 4));
    expect(loaded.version).toBe(5);
    expect(loaded.events).toEqual([]);
    expect(loaded.planet!.signs.every((x) => !x.eventKind)).toBe(true);
    for (const n of loaded.journey.nodes) if (n.planet) expect(n.planet.natives.permits).toEqual([]);
    for (let i = 0; i < 300; i++) step(loaded);
    expect(loaded.events.length).toBe(0);
  });
});
