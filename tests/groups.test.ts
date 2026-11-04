import { describe, expect, it } from 'vitest';
import { TRAIN_MIN_STAFF } from '../src/config/balance';
import * as A from '../src/sim/actions';
import { checkNewGroup, isHome, reformGroups } from '../src/sim/groups';
import { planetObjectives } from '../src/sim/objectives';
import { deserialize, serialize } from '../src/sim/save';
import { createInitialState } from '../src/sim/state';
import { step } from '../src/sim/step';
import type { GameState, Profession } from '../src/sim/types';
import { toLegacy } from './legacy';

/** 开局并造好一架公共备用机（使用正常的制造订单） */
function withSpare(seed = 3): GameState {
  const s = createInitialState(seed);
  A.startGame(s);
  s.inventory = { ...s.inventory, parts: 30, iron: 80, copper: 40, crystal: 30 };
  s.train.driveRepaired = true;
  A.captainOrderShuttle(s);
  for (let i = 0; i < 400 && !s.shuttles.some((x) => x.builtAt >= 0); i++) step(s);
  return s;
}

function waitHome(s: GameState): void {
  for (let i = 0; i < 600 && s.groups.some((g) => !isHome(g) || g.state === 'unloading'); i++) step(s);
}

function invariants(s: GameState): void {
  const ids = s.groups.flatMap((g) => g.memberIds);
  expect(new Set(ids).size).toBe(ids.length); // 一人不属于多个小组
  for (const g of s.groups) for (const id of g.memberIds) expect(s.passengers.find((p) => p.id === id)!.groupId).toBe(g.id);
  const mains = s.groups.map((g) => g.shuttleId).filter((x) => x != null);
  expect(new Set(mains).size).toBe(mains.length); // 一架运输机只做一个组的主运输机
  for (const id of mains) expect(s.shuttles.find((x) => x.id === id)!.assignedTo).toBe('group');
  expect(new Set(s.groups.map((g) => g.name)).size).toBe(s.groups.length);
  expect(new Set(s.groups.map((g) => g.id)).size).toBe(s.groups.length);
  expect(new Set(s.shuttles.map((x) => x.id)).size).toBe(s.shuttles.length);
  // 列车最低运营人手
  for (const [prof, n] of Object.entries(TRAIN_MIN_STAFF) as [Profession, number][]) {
    const onTrain = s.passengers.filter((p) => !p.isCaptain && !p.leftBehind && p.profession === prof && p.groupId == null).length;
    const total = s.passengers.filter((p) => !p.isCaptain && !p.leftBehind && p.profession === prof).length;
    expect(onTrain).toBeGreaterThanOrEqual(Math.min(n, total));
  }
  for (const v of Object.values(s.inventory)) expect(v).toBeGreaterThanOrEqual(0);
}

describe('动态新增小组', () => {
  it('默认 30 人配置：第三组缺 1 名采掘工，界面给出原因；原因不变时不重复刷日志，也不反复尝试改动状态', () => {
    const s = withSpare();
    const c = checkNewGroup(s);
    expect(c.ok).toBe(false);
    expect(c.spares).toBe(1);
    expect(c.reasons.join()).toContain('缺采掘工 ×1');
    const groups0 = JSON.stringify(s.groups.map((g) => [g.id, g.memberIds]));
    const logs0 = s.log.filter((l) => l.text.startsWith('暂无法成立新小组')).length;
    for (let i = 0; i < 300; i++) step(s);
    expect(s.groups.length).toBe(2);
    expect(JSON.stringify(s.groups.map((g) => [g.id, g.memberIds]))).toBe(groups0);
    expect(s.log.filter((l) => l.text.startsWith('暂无法成立新小组')).length - logs0).toBeLessThanOrEqual(1);
    invariants(s);
  });

  it('列车长把每组采掘工要求降为 1：原有两组保留贡献点、运输机与历史，第三组自动成立并领取公共备用机', () => {
    const s = withSpare();
    waitHome(s);
    const [g1, g2] = s.groups;
    g1.points = 77;
    g1.purchases.push('测试记录');
    const sh1 = g1.shuttleId;
    const sh2 = g2.shuttleId;
    const keepPilot = g1.memberIds.find((id) => s.passengers.find((p) => p.id === id)!.profession === 'pilot');
    A.setRequirement(s, 'miner', 1);
    expect(g1.points).toBe(77);
    expect(g1.purchases).toContain('测试记录');
    expect(g1.shuttleId).toBe(sh1);
    expect(g2.shuttleId).toBe(sh2);
    expect(g1.memberIds).toContain(keepPilot); // 增量调整，不打散原有成员
    for (let i = 0; i < 20 && s.groups.length < 3; i++) step(s);
    expect(s.groups.length).toBe(3);
    const g3 = s.groups[2];
    const spare = s.shuttles.find((x) => x.builtAt >= 0)!;
    expect(g3.shuttleId).toBe(spare.id);
    expect(spare.assignedTo).toBe('group');
    expect(spare.ownerGroupId).toBeNull(); // 仍是列车公共资产
    expect(g3.points).toBe(0);
    expect(g3.memberIds.length).toBe(3);
    expect(g3.leaderId).not.toBeNull();
    expect(s.log.some((l) => l.text.startsWith(`新小组成立：${g3.name}`))).toBe(true);
    invariants(s);
  });

  it('新组完整接入：自主出勤、采矿交付、获得贡献点；召回后归队；跨星球后继续存在；存读档结果一致', () => {
    const s = withSpare(5);
    A.startScan(s);
    waitHome(s);
    A.setRequirement(s, 'miner', 1);
    for (let i = 0; i < 20 && s.groups.length < 3; i++) step(s);
    const g3 = s.groups[2];
    s.inventory.propellant = 200;
    for (let i = 0; i < 900 && g3.pointsEarned === 0; i++) {
      step(s);
      invariants(s);
    }
    expect(g3.trips).toBeGreaterThan(0);
    expect(g3.pointsEarned).toBeGreaterThan(0);
    expect(s.pointsIssued).toBeCloseTo(s.groups.reduce((a, g) => a + g.pointsEarned, 0));
    // 存读档
    const raw = serialize(s);
    const a = deserialize(raw);
    const b = deserialize(raw);
    for (let i = 0; i < 300; i++) {
      step(a);
      step(b);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // 召回与跨星球
    A.setRecall(s, true);
    waitHome(s);
    expect(s.groups.every((g) => isHome(g))).toBe(true);
    s.inventory.trainFuel += 40;
    A.departTo(s, 1);
    expect(s.phase).toBe('travel');
    while (s.phase === 'travel') step(s);
    expect(s.groups.length).toBe(3);
    A.startScan(s);
    s.paused = false;
    const t0 = g3.trips;
    for (let i = 0; i < 600 && g3.trips === t0; i++) step(s);
    expect(g3.trips).toBeGreaterThan(t0); // 在第二颗星球继续活动
    invariants(s);
  });

  it('不占用列车长座机、小组私有备用机或已预约换装的运输机', () => {
    const s = withSpare(7);
    waitHome(s);
    const spare = s.shuttles.find((x) => x.builtAt >= 0)!;
    A.setRequirement(s, 'miner', 1);
    // 1) 已预约换装：不会被新组领取
    const g1 = s.groups[0];
    g1.state = 'mining'; // 让预约成立（出勤中）
    A.captainScheduleSwap(s, g1.id, spare.id);
    g1.state = 'docked';
    expect(g1.pendingSwap).toBe(spare.id);
    expect(checkNewGroup(s).reasons.join()).toContain('缺运输机');
    A.captainCancelSwap(s, g1.id);
    // 2) 列车长座机：不会被领取
    A.assignCaptain(s, spare.id);
    expect(checkNewGroup(s).reasons.join()).toContain('缺运输机');
    A.releaseShuttle(s, spare.id);
    // 3) 小组私有备用机：不会被领取
    spare.ownerGroupId = s.groups[1].id;
    spare.assignedTo = 'spare';
    expect(checkNewGroup(s).reasons.join()).toContain('缺运输机');
    for (let i = 0; i < 60; i++) step(s);
    expect(s.groups.filter((g) => g.shuttleId === spare.id).every((g) => g.id === s.groups[1].id)).toBe(true);
    expect(s.groups.length).toBe(2);
    invariants(s);
  });

  it('疲劳或健康不允许出勤的乘客不会被编入新组', () => {
    const s = withSpare(8);
    waitHome(s);
    A.setRequirement(s, 'miner', 1);
    // 先阻止成立，检查候选
    const free = s.passengers.filter((p) => !p.isCaptain && !p.headRole && p.groupId == null && p.profession === 'pilot');
    for (const p of free) p.fatigue = 95;
    const c = checkNewGroup(s);
    expect(c.ok).toBe(false);
    expect(c.reasons.join()).toContain('健康/疲劳/恢复');
    invariants(s);
  });

  it('人员不足时保留成员并显示缺口，不会反复解散重建或在小组间抢人', () => {
    const s = createInitialState(9);
    A.startGame(s);
    const before = s.groups.map((g) => [...g.memberIds]);
    A.setRequirement(s, 'miner', 3); // 采掘工只有 5 人，两组需要 6 人
    const missing = s.groups.filter((g) => g.missing.length);
    expect(missing.length).toBe(1);
    expect(missing[0].missing.join()).toContain('采掘工');
    // 原有成员保留
    s.groups.forEach((g, i) => expect(g.memberIds).toEqual(expect.arrayContaining(before[i])));
    const snap = JSON.stringify(s.groups.map((g) => g.memberIds));
    for (let i = 0; i < 300; i++) step(s);
    // 在列车上的成员不会被来回调动（出勤中的组成员不变）
    expect(JSON.stringify(s.groups.map((g) => g.memberIds))).toBe(snap);
    reformGroups(s);
    expect(JSON.stringify(s.groups.map((g) => g.memberIds))).toBe(snap);
    invariants(s);
  });

  it('v3 存档迁移到 v4：补齐字段，按星球交付计数不凭空增加', () => {
    const s = createInitialState(4);
    A.startGame(s);
    A.startScan(s);
    for (let i = 0; i < 400; i++) step(s);
    const loaded = deserialize(toLegacy(s, 3));
    expect(loaded.version).toBe(6);
    expect(loaded.groups.every((g) => g.exploreStreak === 0)).toBe(true);
    expect(loaded.planet!.deliveries).toBe(s.stats.deliveries);
    for (let i = 0; i < 200; i++) step(loaded);
    invariants(loaded);
  });
});

describe('目标判定', () => {
  it('「收到首批原料」只按真实结算判定：开局、扫描后、运输机载货未卸都不算', () => {
    const s = createInitialState(1);
    A.startGame(s);
    const deliver = () => planetObjectives(s).find((o) => o.id === 'deliver')!;
    expect(deliver().done).toBe(false);
    A.startScan(s);
    for (let i = 0; i < 25; i++) step(s);
    expect(deliver().done).toBe(false);
    // 有载货但尚未返航结算
    let carrying = false;
    for (let i = 0; i < 600 && s.stats.deliveries === 0; i++) {
      step(s);
      if (s.stats.deliveries === 0 && s.shuttles.some((x) => Object.values(x.cargo.items).some((v) => (v ?? 0) > 0))) {
        carrying = true;
        expect(deliver().done).toBe(false);
      }
    }
    expect(carrying).toBe(true);
    expect(s.stats.deliveries).toBeGreaterThan(0);
    expect(deliver().done).toBe(true);
    expect(s.planet!.deliveries).toBe(s.stats.deliveries);
  });
});

describe('推进剂与冰晶同时耗尽', () => {
  it('小组停飞时有可行出路：用能源应急合成推进剂后能再次出勤采冰（不是免费资源）', () => {
    const s = createInitialState(2);
    A.startGame(s);
    A.startScan(s);
    for (let i = 0; i < 300; i++) step(s);
    waitHome(s);
    s.inventory.propellant = 0;
    s.inventory.ice = 0;
    for (const sh of s.shuttles) sh.fuel = 0;
    for (let i = 0; i < 60; i++) step(s);
    const stuck = s.groups.filter((g) => g.state === 'grounded' && g.status.includes('推进剂不足'));
    expect(stuck.length).toBeGreaterThan(0); // 其余小组可能在休整
    expect(stuck[0].status).toContain('应急合成');
    expect(A.canEnqueue(s, 'propellantEmergency', 1)).toBe('');
    const e0 = s.inventory.energy;
    A.enqueue(s, 'propellantEmergency', 2);
    expect(s.inventory.energy).toBe(e0 - 180);
    let flew = false;
    for (let i = 0; i < 400 && !flew; i++) {
      step(s);
      flew = s.shuttles.some((x) => !x.docked);
    }
    expect(flew).toBe(true);
  });
});
