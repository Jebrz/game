import { describe, expect, it } from 'vitest';
import { HANGAR, SHUTTLE_BUILD } from '../src/config/balance';
import * as A from '../src/sim/actions';
import { advance } from '../src/sim/clock';
import {
  canOrderShuttle,
  canSwap,
  cancelOrder,
  groupConsiderShuttle,
  hangarUsage,
  orderShuttle,
  swapShuttle,
} from '../src/sim/hangar';
import { deserialize, serialize } from '../src/sim/save';
import { createInitialState } from '../src/sim/state';
import { step } from '../src/sim/step';
import type { GameState } from '../src/sim/types';
import { toLegacy } from './legacy';

/** 已开局、库存足够造两架运输机的状态 */
function rich(seed = 3): GameState {
  const s = createInitialState(seed);
  A.startGame(s);
  s.inventory.parts = 20;
  s.inventory.iron = 100;
  s.inventory.copper = 50;
  s.inventory.crystal = 30;
  s.train.driveRepaired = true; // 不受零件保护政策影响（单独测试政策）
  return s;
}

function runUntil(s: GameState, cond: () => boolean, max = 2000): void {
  for (let i = 0; i < max && !cond(); i++) step(s);
}

const snapshot = (s: GameState) => JSON.stringify({ inv: s.inventory, q: s.queue, pts: s.groups.map((g) => g.points), sh: s.shuttles.length });

describe('列车长公共制造', () => {
  it('下单扣除公共库存、预留泊位；完工生成一架独立新机（无燃料、空货舱、唯一编号）', () => {
    const s = rich();
    const before = { ...s.inventory };
    expect(canOrderShuttle(s, null)).toEqual([]);
    A.captainOrderShuttle(s);
    for (const [k, v] of Object.entries(SHUTTLE_BUILD.items)) expect(s.inventory[k as keyof typeof before]).toBe(before[k as keyof typeof before] - (v ?? 0));
    expect(hangarUsage(s).building).toBe(1);
    expect(hangarUsage(s).used).toBe(3);
    // 重复点击：不会产生第二个订单或再次扣费
    const snap = snapshot(s);
    A.captainOrderShuttle(s);
    A.captainOrderShuttle(s);
    expect(snapshot(s)).toBe(snap);
    runUntil(s, () => s.shuttles.length === 3);
    expect(s.shuttles.length).toBe(3);
    const ns = s.shuttles[2];
    expect(ns.assignedTo).toBe('spare');
    expect(ns.ownerGroupId).toBeNull();
    expect(ns.fuel).toBe(0);
    expect(Object.keys(ns.cargo.items).length).toBe(0);
    expect(new Set(s.shuttles.map((x) => x.serial)).size).toBe(3);
    expect(new Set(s.shuttles.map((x) => x.cargo.id)).size).toBe(3);
    expect(hangarUsage(s).building).toBe(0);
    // 再多跑也不会重复生成
    for (let i = 0; i < 300; i++) step(s);
    expect(s.shuttles.length).toBe(3);
  });

  it('暂停时制造不推进；加速与逐步结果一致', () => {
    const a = rich(5);
    const b = rich(5);
    A.captainOrderShuttle(a);
    A.captainOrderShuttle(b);
    a.paused = true;
    const before = a.queue[0].remaining;
    advance(a, { acc: 0 }, 5000);
    expect(a.queue[0].remaining).toBe(before);
    a.paused = false;
    a.speed = 8;
    const clock = { acc: 0 };
    let n = 0;
    while (n < 400) n += advance(a, clock, 100);
    for (let i = 0; i < n; i++) step(b);
    b.speed = 8;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('与其他加工共用产能：制造在队首时，排在后面的配方不推进', () => {
    const s = rich();
    s.inventory.ice = 30;
    A.captainOrderShuttle(s);
    A.enqueue(s, 'propellant', 1);
    const job = s.queue[1];
    const r0 = job.remaining;
    for (let i = 0; i < 30; i++) step(s);
    expect(s.queue[1].remaining).toBe(r0);
    expect(s.queue[0].kind).toBe('shuttle');
  });

  it('缺材料、零件保护政策、机库满时拒绝下单并说明原因，库存不变', () => {
    const s = rich();
    s.inventory.copper = 2;
    let snap = snapshot(s);
    expect(canOrderShuttle(s, null).join()).toContain('铜矿缺');
    A.captainOrderShuttle(s);
    expect(snapshot(s)).toBe(snap);

    const p = rich();
    p.train.driveRepaired = false;
    p.inventory.parts = 10; // 需保留 8，制造要 6
    snap = snapshot(p);
    expect(canOrderShuttle(p, null).join()).toContain('优先保障主驱动');
    A.captainOrderShuttle(p);
    expect(snapshot(p)).toBe(snap);

    const f = rich();
    f.hangar.capacity = 2; // 两架现有运输机已占满
    snap = snapshot(f);
    expect(canOrderShuttle(f, null).join()).toContain('机库已满');
    A.captainOrderShuttle(f);
    expect(snapshot(f)).toBe(snap);
  });

  it('出勤中的运输机仍占泊位，不能借此超容量下单', () => {
    const s = rich();
    s.hangar.capacity = 3;
    s.shuttles[0].docked = false;
    s.shuttles[1].docked = false;
    A.captainOrderShuttle(s);
    expect(hangarUsage(s).free).toBe(0);
    const g = s.groups[0];
    g.points = 999;
    expect(canOrderShuttle(s, g).join()).toContain('机库已满');
  });
});

describe('队列优先', () => {
  it('列车长可把公共订单提前，被挤下的订单保留进度；不能调整小组订单', () => {
    const s = rich();
    s.inventory.crystal = 30;
    s.inventory.ice = 10;
    s.hangar.capacity = 5;
    A.captainOrderShuttle(s);
    for (let i = 0; i < 20; i++) step(s);
    const progressed = s.queue[0].remaining;
    A.enqueue(s, 'trainFuel', 1);
    const fuelId = s.queue[1].id;
    A.moveToFront(s, fuelId);
    expect(s.queue[0].id).toBe(fuelId);
    expect(s.queue[1].remaining).toBe(progressed);
    const g = s.groups[0];
    g.points = 500;
    orderShuttle(s, g, '测试');
    const gid = s.queue[s.queue.length - 1].id;
    expect(A.canMoveToFront(s, gid)).toContain('小组订单');
    A.moveToFront(s, gid);
    expect(s.queue[s.queue.length - 1].id).toBe(gid);
  });
});

describe('取消订单', () => {
  it('原样返还材料，部分完成后取消也不会多返；不能重复取消', () => {
    const s = rich();
    const before = { ...s.inventory };
    A.captainOrderShuttle(s);
    const id = s.queue[0].id;
    for (let i = 0; i < 40; i++) step(s);
    const energyAfterWork = s.inventory.energy;
    A.cancelJob(s, id);
    for (const k of Object.keys(SHUTTLE_BUILD.items)) expect(s.inventory[k as keyof typeof before]).toBe(before[k as keyof typeof before]);
    expect(s.inventory.energy).toBe(energyAfterWork); // 已耗能源不退
    const snap = snapshot(s);
    A.cancelJob(s, id);
    expect(snapshot(s)).toBe(snap);
    expect(hangarUsage(s).building).toBe(0);
  });

  it('小组订单退还贡献点；列车长不能取消小组出资的订单', () => {
    const s = rich();
    const g = s.groups[0];
    g.points = 300;
    orderShuttle(s, g, '测试');
    expect(g.points).toBe(300 - SHUTTLE_BUILD.groupPoints);
    const id = s.queue[0].id;
    A.cancelJob(s, id);
    expect(s.queue.length).toBe(1); // 列车长取消无效
    expect(cancelOrder(s, id, g.id)).toBe('');
    expect(g.points).toBe(300);
    expect(s.queue.length).toBe(0);
  });
});

describe('小组自主订购', () => {
  it('没有明确需求时不订购；有需求但贡献点不足时不订购；贡献点不能替代材料', () => {
    const s = rich();
    const g = s.groups[0];
    g.points = 999;
    expect(groupConsiderShuttle(s, g)).toBe(false); // 主运输机正常，无需求
    expect(s.queue.length).toBe(0);
    A.assignCaptain(s, g.shuttleId!); // 列车长配属后该组无运输机
    g.points = 50;
    expect(groupConsiderShuttle(s, g)).toBe(false);
    g.points = 999;
    s.inventory.parts = 0;
    expect(groupConsiderShuttle(s, g)).toBe(false);
    expect(g.points).toBe(999);
    expect(s.queue.length).toBe(0);
  });

  it('有需求、预算、材料与泊位时自主下单（记录理由），不会重复下单；完工归该组并由该组领取', () => {
    const s = rich();
    const g = s.groups[0];
    const other = s.groups[1];
    const oldId = g.shuttleId!;
    s.hangar.capacity = 5;
    A.assignCaptain(s, oldId);
    g.points = 500;
    expect(groupConsiderShuttle(s, g)).toBe(true);
    expect(g.decisions[0].text).toContain('自主订购');
    expect(g.decisions[0].text).toContain('理由');
    expect(g.points).toBe(500 - SHUTTLE_BUILD.groupPoints);
    expect(groupConsiderShuttle(s, g)).toBe(false); // 不重复下单
    expect(s.queue.filter((j) => j.kind === 'shuttle').length).toBe(1);
    // 列车长订单插队到小组订单之前
    A.captainOrderShuttle(s);
    expect(s.queue[0].orderedBy).toBeNull();
    expect(s.queue[1].orderedBy).toBe(g.id);
    runUntil(s, () => s.shuttles.length === 4, 3000);
    const mine = s.shuttles.find((x) => x.ownerGroupId === g.id);
    expect(mine).toBeTruthy();
    // 列车长不能征用或分配小组出资的新机
    expect(A.canAssignCaptain(s, mine!.id)).toContain('无权征用');
    expect(canSwap(s, other, mine!, 'captain')).toContain('只能由该组领取');
    // 小组在车上时领取
    runUntil(s, () => g.shuttleId === mine!.id, 50);
    expect(g.shuttleId).toBe(mine!.id);
    expect(mine!.assignedTo).toBe('group');
    expect(s.shuttles.find((x) => x.id === oldId)!.assignedTo).toBe('captain'); // 原机仍是列车长座机，不受影响
  });
});

describe('换机与配属', () => {
  it('小组未返航或货舱未卸空时不能换机；换机后旧机转备用，保留升级与耐久，人员不重复', () => {
    const s = rich();
    A.captainOrderShuttle(s);
    runUntil(s, () => s.shuttles.length === 3);
    const spare = s.shuttles[2];
    const g = s.groups[0];
    const old = s.shuttles.find((x) => x.id === g.shuttleId)!;
    old.upgrades.push('cargoBay');
    const oldDur = old.durability;
    // 出勤中
    g.state = 'mining';
    expect(canSwap(s, g, spare, 'captain')).toContain('尚未返航');
    g.state = 'unloading';
    expect(canSwap(s, g, spare, 'captain')).toContain('卸货');
    g.state = 'docked';
    old.cargo.items = { iron: 5 };
    expect(canSwap(s, g, spare, 'captain')).toContain('卸空');
    old.cargo.items = {};
    expect(canSwap(s, g, spare, 'captain')).toBe('');
    A.captainSwap(s, g.id, spare.id);
    expect(g.shuttleId).toBe(spare.id);
    expect(old.assignedTo).toBe('spare');
    expect(old.upgrades).toContain('cargoBay');
    expect(old.durability).toBe(oldDur);
    expect(s.shuttles.length).toBe(3);
    // 一个运输机只属于一个小组
    const mains = s.groups.map((x) => x.shuttleId).filter((x) => x != null);
    expect(new Set(mains).size).toBe(mains.length);
    // 换下来的公共旧机可以再分配或配属列车长
    expect(A.canAssignCaptain(s, old.id)).toBe('');
  });

  it('新机领取后能正常出勤并返航（推进剂由列车补给）', () => {
    const s = rich(7);
    s.inventory.propellant = 200;
    A.startScan(s);
    A.captainOrderShuttle(s);
    runUntil(s, () => s.shuttles.length === 3);
    const g = s.groups[0];
    const spare = s.shuttles[2];
    runUntil(s, () => canSwap(s, g, spare, 'captain') === '', 500);
    expect(swapShuttle(s, g, spare, 'captain', '')).toBe(true);
    let left = false;
    runUntil(s, () => {
      if (!spare.docked) left = true;
      return left && spare.docked && g.state === 'docked';
    }, 1500);
    expect(left).toBe(true);
    expect(spare.docked).toBe(true);
    expect(g.trips).toBeGreaterThan(0);
  });
});

describe('机库扩建', () => {
  it('扩建消耗材料与工时，完工后容量 +1；同时只能有一个扩建工程', () => {
    const s = rich();
    const cap = s.hangar.capacity;
    A.expandHangar(s);
    const snap = snapshot(s);
    A.expandHangar(s);
    expect(snapshot(s)).toBe(snap);
    runUntil(s, () => s.hangar.capacity > cap);
    expect(s.hangar.capacity).toBe(cap + HANGAR.expansions[0].add);
    expect(s.hangar.level).toBe(1);
  });
});

describe('存档', () => {
  it('制造中存读档：保留进度、预留与归属，继续运行结果一致，只生成一架新机', () => {
    const s = rich(9);
    s.hangar.capacity = 5;
    const g = s.groups[0];
    A.assignCaptain(s, g.shuttleId!);
    g.points = 500;
    groupConsiderShuttle(s, g);
    A.captainOrderShuttle(s);
    for (let i = 0; i < 60; i++) step(s);
    const raw = serialize(s);
    const a = deserialize(raw);
    const b = deserialize(raw);
    expect(a.queue.map((j) => [j.kind, j.orderedBy, j.remaining, j.pointsPaid])).toEqual(s.queue.map((j) => [j.kind, j.orderedBy, j.remaining, j.pointsPaid]));
    for (let i = 0; i < 600; i++) {
      step(a);
      step(b);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.shuttles.length).toBe(4);
    expect(a.shuttles.filter((x) => x.ownerGroupId === a.groups[0].id).length).toBe(1);
    expect(a.shuttles.filter((x) => x.ownerGroupId === null && x.builtAt >= 0).length).toBe(1);
    expect(a.queue.filter((j) => j.kind === 'shuttle').length).toBe(0);
  });

  it('v1 旧存档自动升级：保留运输机、小组与资源，机库至少容纳已有运输机', () => {
    const s = createInitialState(4);
    A.startGame(s);
    for (let i = 0; i < 200; i++) step(s);
    s.inventory.ice = 6;
    A.enqueue(s, 'propellant', 2);
    const loaded = deserialize(toLegacy(s, 1));
    expect(loaded.version).toBe(3);
    expect(loaded.hangar.capacity).toBeGreaterThanOrEqual(loaded.shuttles.length);
    expect(loaded.shuttles.map((x) => x.serial)).toEqual(['TJ-01', 'TJ-02']);
    expect(loaded.shuttles.every((x) => x.ownerGroupId === null)).toBe(true);
    expect(loaded.queue.every((j) => j.kind === 'recipe' && j.reserved.ice === 3)).toBe(true);
    expect(loaded.inventory).toEqual(s.inventory);
    expect(loaded.groups.map((g) => [g.state, g.points, g.shuttleId])).toEqual(s.groups.map((g) => [g.state, g.points, g.shuttleId]));
    // 取消旧队列订单只返还原配方材料
    const ice = loaded.inventory.ice;
    A.cancelJob(loaded, loaded.queue[1].id);
    expect(loaded.inventory.ice).toBe(ice + 3);
    // 继续运行正常
    for (let i = 0; i < 300; i++) step(loaded);
    expect(loaded.time).toBe(s.time + 300);
    // 升级后的新运输机编号从 TJ-03 起
    loaded.inventory = { ...loaded.inventory, parts: 20, iron: 50, copper: 50, crystal: 20 };
    loaded.train.driveRepaired = true;
    loaded.paused = false;
    A.captainOrderShuttle(loaded);
    runUntil(loaded, () => loaded.shuttles.length === 3);
    expect(loaded.shuttles[2].serial).toBe('TJ-03');
  });
});
