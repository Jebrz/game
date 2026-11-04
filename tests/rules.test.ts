import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { step } from '../src/sim/step';
import { advance } from '../src/sim/clock';
import { tryClaim, reserveForDelivery, tickClaims, SLOT_RESERVE_MINUTES, heldSlot } from '../src/sim/claims';
import { settleCargo, unitPrice, groupConsiderPurchases, purchaseOptions } from '../src/sim/economy';
import { serialize, deserialize } from '../src/sim/save';
import * as A from '../src/sim/actions';
import { autoPlayer } from './autoplay';
import type { GameState } from '../src/sim/types';

function started(seed = 3): GameState {
  const s = createInitialState(seed);
  A.startGame(s);
  return s;
}

function checkInvariants(s: GameState) {
  for (const [k, v] of Object.entries(s.inventory)) expect(v, k).toBeGreaterThanOrEqual(0);
  expect(s.credits).toBeGreaterThanOrEqual(0);
  for (const g of s.groups) expect(g.points).toBeGreaterThanOrEqual(-1e-9);
  for (const d of s.planet?.deposits ?? []) {
    expect(d.reserve).toBeGreaterThanOrEqual(0);
    const holders = d.slots.filter((x) => x.holderGroupId != null).map((x) => x.holderGroupId);
    expect(new Set(holders).size).toBe(holders.length); // 一个小组在一个矿点最多一个位置
    for (const sl of d.slots) if (sl.status === 'free') expect(sl.holderGroupId).toBeNull();
  }
  // 一人不重复加入多个小组
  const ids = s.groups.flatMap((g) => g.memberIds);
  expect(new Set(ids).size).toBe(ids.length);
}

describe('时间：暂停与加速', () => {
  it('暂停时不推进任何模拟', () => {
    const s = started();
    s.paused = true;
    const before = JSON.stringify(s);
    const n = advance(s, { acc: 0 }, 5000);
    expect(n).toBe(0);
    expect(JSON.stringify(s)).toBe(before);
  });
  it('加速只增加固定步数，结果与逐步执行完全一致（不重复结算）', () => {
    const a = started(11);
    const b = started(11);
    a.speed = 8;
    const clock = { acc: 0 };
    let steps = 0;
    while (steps < 600) steps += advance(a, clock, 100); // 每帧 100ms, 8× → 1.6 步/帧
    for (let i = 0; i < steps; i++) step(b);
    a.speed = b.speed;
    expect(a.time).toBe(steps);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('1× 下 1 秒推进 2 游戏分钟，4× 下推进 8 分钟', () => {
    const s = started();
    expect(advance(s, { acc: 0 }, 250)).toBe(0); // 250ms → 0.5 分，不足一步
    const c = { acc: 0 };
    let n = 0;
    for (let i = 0; i < 4; i++) n += advance(s, c, 250);
    expect(n).toBe(2);
    s.speed = 4;
    n = 0;
    for (let i = 0; i < 4; i++) n += advance(s, c, 250);
    expect(n).toBe(8);
  });
});

describe('矿点作业位置', () => {
  it('先到先得：单位置矿点只能被一个小组取得，另一组需等待', () => {
    const s = started();
    const d = s.planet!.deposits.find((x) => x.slots.length === 1)!;
    const [g1, g2] = s.groups;
    expect(tryClaim(s, d, g1.id)).not.toBeNull();
    expect(tryClaim(s, d, g2.id)).toBeNull();
  });
  it('返航交货期间保留位置，按时归来可恢复；超时释放后他组可取得', () => {
    const s = started();
    const d = s.planet!.deposits.find((x) => x.slots.length === 1)!;
    const [g1, g2] = s.groups;
    tryClaim(s, d, g1.id);
    reserveForDelivery(s, d, g1.id);
    expect(d.slots[0].status).toBe('reserved');
    expect(tryClaim(s, d, g2.id)).toBeNull(); // 保留期内他组无法取得
    s.time += SLOT_RESERVE_MINUTES - 1;
    tickClaims(s);
    expect(tryClaim(s, d, g1.id)).not.toBeNull(); // 本组恢复作业
    reserveForDelivery(s, d, g1.id);
    s.time += SLOT_RESERVE_MINUTES;
    tickClaims(s);
    expect(d.slots[0].status).toBe('free');
    expect(heldSlot(d, g1.id)).toBeNull();
    expect(tryClaim(s, d, g2.id)).not.toBeNull();
  });
  it('采空的矿点不能再被占用', () => {
    const s = started();
    const d = s.planet!.deposits[0];
    d.reserve = 0;
    expect(tryClaim(s, d, s.groups[0].id)).toBeNull();
  });
});

describe('交付结算', () => {
  it('货物转入库存并按基础价＋需求奖励计贡献点，同一批次只结算一次', () => {
    const s = started();
    const g = s.groups[0];
    const sh = s.shuttles.find((x) => x.id === g.shuttleId)!;
    A.setDemandBonus(s, 'iron', 3);
    expect(unitPrice(s, 'iron')).toBe(5);
    sh.cargo.items = { iron: 20, ice: 10 };
    const batch = sh.cargo;
    const pts = settleCargo(s, g, sh);
    expect(pts).toBe(20 * 5 + 10 * 1);
    expect(s.inventory.iron).toBe(20);
    expect(s.inventory.ice).toBe(10);
    expect(g.points).toBe(110);
    expect(batch.settled).toBe(true);
    expect(Object.keys(sh.cargo.items).length).toBe(0);
    // 重复结算无效
    batch.items = { iron: 20 };
    expect(settleCargo(s, g, sh)).toBe(0);
    expect(s.inventory.iron).toBe(20);
    expect(g.points).toBe(110);
  });
});

describe('购买与库存', () => {
  it('贡献点或库存不足时不购买、不出现负值', () => {
    const s = started();
    const g = s.groups[0];
    g.points = 20;
    expect(groupConsiderPurchases(s, g)).toBe(false);
    g.points = 500;
    s.inventory.parts = 0;
    s.policies.reservePartsForDrive = false;
    const opts = purchaseOptions(s, g);
    expect(opts.filter((o) => o.kind === 'upgrade').every((o) => o.blocked.includes('维修零件'))).toBe(true);
    expect(groupConsiderPurchases(s, g)).toBe(false); // 基因也未研究
    expect(g.points).toBe(500);
  });
  it('原料不足时加工无法入队，并给出原因', () => {
    const s = started();
    expect(A.canEnqueue(s, 'parts')).toContain('原料不足');
    A.enqueue(s, 'parts');
    expect(s.queue.length).toBe(0);
    s.inventory.iron = 4;
    s.inventory.copper = 2;
    A.enqueue(s, 'parts');
    expect(s.queue.length).toBe(1);
    expect(s.inventory.iron).toBe(0);
    A.cancelJob(s, s.queue[0].id);
    expect(s.inventory.iron).toBe(4);
  });
  it('交易站资金不足时不能购买', () => {
    const s = started();
    s.station.docked = true;
    s.credits = 5;
    expect(A.canBuy(s, 'trainFuel', 1)).toContain('星币不足');
    A.buy(s, 'trainFuel', 1);
    expect(s.credits).toBe(5);
  });
  it('离站条件不足时说明原因', () => {
    const s = started();
    expect(A.canDepart(s)).toContain('主驱动未修复');
    expect(A.canDepart(s)).toContain('轨道燃料不足');
  });
});

describe('存档', () => {
  it('读档恢复小组行动与矿点占用，继续运行与未存档完全一致，不重复发奖励', () => {
    const s = started(5);
    let saved: string | null = null;
    for (let i = 0; i < 1200; i++) {
      if (s.time % 5 === 0) autoPlayer(s);
      step(s);
      checkInvariants(s);
      const holding = s.planet!.deposits.some((d) => d.slots.some((x) => x.status !== 'free'));
      const carrying = s.shuttles.some((sh) => Object.keys(sh.cargo.items).length > 0);
      if (!saved && holding && carrying && s.time > 200) {
        saved = serialize(s);
        break;
      }
    }
    expect(saved).not.toBeNull();
    const a = deserialize(saved!);
    const b = deserialize(saved!);
    const claimsBefore = JSON.stringify(a.planet!.deposits.map((d) => d.slots));
    expect(claimsBefore).toContain('"working"');
    for (let i = 0; i < 400; i++) {
      if (a.time % 5 === 0) autoPlayer(a);
      if (b.time % 5 === 0) autoPlayer(b);
      step(a);
      step(b);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // 发放的贡献点总数 = 各组获得之和（无重复结算）
    const earned = a.groups.reduce((x, g) => x + g.pointsEarned, 0);
    expect(Math.abs(earned - a.pointsIssued)).toBeLessThan(1e-6);
  });
  it('版本不符的存档被拒绝', () => {
    const s = started();
    const raw = JSON.parse(serialize(s));
    raw.version = 999;
    expect(() => deserialize(JSON.stringify(raw))).toThrow('不兼容');
  });
});

describe('自主小组', () => {
  it('两个小组都能自主探索、采矿、返航交付，且全程不违反占用与库存规则', () => {
    const s = started(9);
    const waited = new Set<number>();
    for (let i = 0; i < 700; i++) {
      if (s.time % 5 === 0) autoPlayer(s);
      step(s);
      checkInvariants(s);
      for (const g of s.groups) if (g.state === 'waitingSlot') waited.add(g.id);
    }
    for (const g of s.groups) {
      expect(g.pointsEarned, g.name).toBeGreaterThan(0);
      expect(g.trips, g.name).toBeGreaterThan(1);
      expect(g.decisions.length).toBeGreaterThan(0);
    }
    const explored = s.planet!.signs.filter((x) => x.explored).length;
    expect(explored).toBeGreaterThan(3);
  });
  it('竞争同一单位置矿点：后到者等待其他位置释放，且不会无限等待', () => {
    const s = started(4);
    const P = s.planet!;
    P.scanned = true;
    for (const sg of P.signs) {
      sg.revealed = true;
      sg.explored = true;
    }
    const target = P.deposits.find((d) => d.slots.length === 1 && d.resource === 'copper')!;
    for (const d of P.deposits) {
      d.discoveredBy = s.groups[0].id;
      if (d !== target) d.reserve = 0;
    }
    target.reserve = 2000;
    let maxWait = 0;
    let sawWait = false;
    for (let i = 0; i < 500; i++) {
      step(s);
      checkInvariants(s);
      for (const g of s.groups) {
        if (g.state === 'waitingSlot') {
          sawWait = true;
          expect(g.status).toContain('等待其他位置释放');
          maxWait = Math.max(maxWait, s.time - g.stateSince);
        }
      }
      expect(target.slots.filter((x) => x.status === 'working').length).toBeLessThanOrEqual(1);
    }
    expect(sawWait).toBe(true);
    expect(maxWait).toBeLessThanOrEqual(40);
  });
  it('情绪汇总每人权重相同；降低失望不会瞬间清除敌意', async () => {
    const { moodSummary, tickMoodHourly } = await import('../src/sim/survival');
    const s = started();
    for (const p of s.passengers) {
      p.disappointment = 90;
      p.hostility = 0;
    }
    s.policies.workload = 'overtime';
    s.policies.rations = 'lean';
    for (let h = 0; h < 10; h++) tickMoodHourly(s);
    const hostile = moodSummary(s).hostility;
    expect(hostile).toBeGreaterThan(5);
    s.policies.workload = 'light';
    s.policies.rations = 'rich';
    tickMoodHourly(s);
    expect(moodSummary(s).hostility).toBeGreaterThan(hostile * 0.9);
    const ps = s.passengers.filter((p) => !p.isCaptain);
    expect(moodSummary(s).morale).toBeCloseTo(ps.reduce((a, p) => a + p.morale, 0) / ps.length);
  });
  it('列车长配属运输机：原小组停飞、总数不变；释放后归还', () => {
    const s = started();
    const g = s.groups[0];
    const shId = g.shuttleId!;
    expect(A.canAssignCaptain(s, shId)).toBe('');
    A.assignCaptain(s, shId);
    expect(g.shuttleId).toBeNull();
    expect(s.shuttles.length).toBe(2);
    for (let i = 0; i < 30; i++) step(s);
    expect(g.state).toBe('grounded');
    expect(g.status).toContain('运输机');
    A.releaseShuttle(s, shId);
    expect(g.shuttleId).toBe(shId);
  });
});

describe('离站', () => {
  it('强行离站遗留未归人员，敌意上升；不会凭空保留其运输机', async () => {
    const { moodSummary } = await import('../src/sim/survival');
    const s = started(2);
    for (let i = 0; i < 120; i++) {
      if (s.time % 5 === 0) autoPlayer(s);
      step(s);
    }
    s.train.driveRepaired = true;
    s.inventory.trainFuel = 10;
    const out = A.outsideGroups(s);
    expect(out.length).toBeGreaterThan(0);
    expect(A.canDepart(s)).toContain('尚有小组未归');
    expect(A.canForceDepart(s)).toBe('');
    const before = moodSummary(s).hostility;
    A.depart(s, true);
    expect(s.phase).toBe('travel');
    expect(s.stats.leftBehind).toBeGreaterThan(0);
    expect(s.shuttles.length).toBe(2 - out.length);
    expect(moodSummary(s).hostility).toBeGreaterThan(before + 20);
    expect(s.inventory.trainFuel).toBe(0);
  });
});
