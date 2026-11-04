import { describe, expect, it } from 'vitest';
import { COURSES, QUAL_THRESHOLD, TRAINING } from '../src/config/balance';
import * as A from '../src/sim/actions';
import { advance } from '../src/sim/clock';
import { checkNewGroup, reservedForTrain } from '../src/sim/groups';
import { deserialize, serialize } from '../src/sim/save';
import { deptStats } from '../src/sim/staff';
import { createInitialState } from '../src/sim/state';
import { step } from '../src/sim/step';
import { canEnroll, enrollmentOf, hasQual, isMentoring, mentorsFor, skillOfCourse } from '../src/sim/training';
import type { GameState, Passenger } from '../src/sim/types';
import { toLegacy } from './legacy';

const mining = COURSES.find((c) => c.id === 'miningBasic')!;

function started(seed = 3): GameState {
  const s = createInitialState(seed);
  A.startGame(s);
  s.inventory = { ...s.inventory, parts: 30, iron: 100, copper: 40, crystal: 30 };
  return s;
}

/** 可报名采掘基础的人（按界面列出的顺序：技能高者优先） */
function miningCandidates(s: GameState): Passenger[] {
  return s.passengers.filter((p) => !canEnroll(s, p, 'miningBasic').length).sort((a, b) => skillOfCourse(b, mining) - skillOfCourse(a, mining));
}

function runCourse(s: GameState, p: Passenger, courseId: string, max = 1500): void {
  for (let i = 0; i < max && !p.coursesDone.includes(courseId); i++) step(s);
}

describe('职业资格', () => {
  it('开局资格按技能门槛取得：背景职业者都合格；后勤等背景不自动具备采掘资格', () => {
    const s = started();
    for (const p of s.passengers.filter((x) => ['pilot', 'surveyor', 'miner', 'engineer'].includes(x.profession))) expect(hasQual(p, p.profession)).toBe(true);
    const logi = s.passengers.filter((p) => p.profession === 'logistics' && !p.headRole);
    expect(logi.every((p) => !hasQual(p, 'miner'))).toBe(true);
    // 小组成员名额按资格记录
    for (const g of s.groups) for (const id of g.memberIds) expect(g.memberRoles[id]).toBeTruthy();
  });

  it('默认配置下新组缺采掘工，并提示可安排培训', () => {
    const s = started();
    const c = checkNewGroup(s);
    expect(c.reasons.join()).toContain('缺采掘工 ×1');
    expect(c.reasons.join()).toContain('培训');
  });
});

describe('脱产培训', () => {
  it('报名扣材料；学员与导师不提供原岗位产能；完成后达到门槛并取得资格', () => {
    const s = started();
    const cands = miningCandidates(s);
    expect(cands.length).toBeGreaterThan(0);
    const p = cands.find((x) => x.profession === 'logistics' || x.profession === 'engineer') ?? cands[0];
    const before = deptStats(s);
    const dept = before.logistics.workers.includes(p) ? 'logistics' : before.engineering.workers.includes(p) ? 'engineering' : before.research.workers.includes(p) ? 'research' : null;
    const iron0 = s.inventory.iron;
    const e0 = s.inventory.energy;
    A.enroll(s, p.id, 'miningBasic');
    const en = enrollmentOf(s, p)!;
    expect(en).toBeTruthy();
    expect(s.inventory.iron).toBe(iron0 - mining.cost.iron!);
    expect(s.inventory.energy).toBe(e0 - mining.cost.energy!);
    const mentor = s.passengers.find((x) => x.id === en.mentorId)!;
    expect(isMentoring(s, mentor)).toBe(true);
    const after = deptStats(s);
    if (dept) expect(after[dept].workers.includes(p)).toBe(false);
    for (const d of Object.values(after)) expect(d.workers.includes(mentor)).toBe(false);
    const start = skillOfCourse(p, mining);
    runCourse(s, p, 'miningBasic');
    expect(p.coursesDone).toContain('miningBasic');
    expect(skillOfCourse(p, mining)).toBeCloseTo(start + mining.gain, 5);
    expect(skillOfCourse(p, mining)).toBeGreaterThanOrEqual(QUAL_THRESHOLD.miner);
    expect(hasQual(p, 'miner')).toBe(true);
    expect(enrollmentOf(s, p)).toBeNull();
    expect(isMentoring(s, mentor)).toBe(false);
    expect(s.log.some((l) => l.text.includes(`${p.name}完成「采掘基础」`) && l.text.includes('取得「采掘工」资格'))).toBe(true);
  });

  it('培训位与导师带教上限限制并行人数；同一人不能重复报名；未成年与列车必需人员被拒绝', () => {
    const s = started();
    const cands = miningCandidates(s);
    A.enroll(s, cands[0].id, 'miningBasic');
    A.enroll(s, cands[1].id, 'miningBasic');
    expect(s.training.enrollments.length).toBe(2);
    expect(canEnroll(s, cands[0], 'miningBasic').join()).toContain('已在其他课程中');
    expect(canEnroll(s, cands[2], 'miningBasic').join()).toContain('培训位已满');
    // 导师带教上限
    for (const m of mentorsFor(s, mining).all) expect(s.training.enrollments.filter((e) => e.mentorId === m.id).length).toBeLessThanOrEqual(TRAINING.perMentor);
    // 未成年
    cands[3].age = 16;
    expect(canEnroll(s, cands[3], 'miningBasic').join()).toContain('未满 18 岁');
    // 列车最低运营人员
    const reserved = s.passengers.find((p) => reservedForTrain(s).has(p.id) && !p.headRole)!;
    expect(canEnroll(s, reserved, 'miningBasic').join()).toContain('最低运营人员');
    // 材料不足
    const s2 = started(4);
    s2.inventory.iron = 0;
    const c2 = s2.passengers.find((p) => canEnroll(s2, p, 'miningBasic').length === 1)!;
    expect(canEnroll(s2, c2, 'miningBasic').join()).toContain('材料不足');
    A.enroll(s2, c2.id, 'miningBasic');
    expect(s2.training.enrollments.length).toBe(0);
  });

  it('取消：无进度时退还；有进度时保留已得技能、材料不退；重报从原进度继续且不再收费，总提升不超过课程上限', () => {
    const s = started();
    const p = miningCandidates(s)[0];
    const iron0 = s.inventory.iron;
    A.enroll(s, p.id, 'miningBasic');
    A.cancelEnrollment(s, enrollmentOf(s, p)!.id);
    expect(s.inventory.iron).toBe(iron0);
    const start = skillOfCourse(p, mining);
    A.enroll(s, p.id, 'miningBasic');
    for (let i = 0; i < 100; i++) step(s);
    const mid = skillOfCourse(p, mining);
    expect(mid).toBeGreaterThan(start);
    A.cancelEnrollment(s, enrollmentOf(s, p)!.id);
    expect(skillOfCourse(p, mining)).toBe(mid);
    expect(s.inventory.iron).toBe(iron0 - mining.cost.iron!);
    const ironBefore = s.inventory.iron;
    A.enroll(s, p.id, 'miningBasic');
    expect(s.inventory.iron).toBe(ironBefore); // 不再收费
    runCourse(s, p, 'miningBasic');
    expect(skillOfCourse(p, mining)).toBeCloseTo(start + mining.gain, 5);
    expect(canEnroll(s, p, 'miningBasic').join()).toMatch(/已具备|已完成/);
  });

  it('自动暂停与恢复：疲劳过高时停止推进；手动暂停时学员回到原岗位、导师释放', () => {
    const s = started();
    const p = miningCandidates(s)[0];
    A.enroll(s, p.id, 'miningBasic');
    const en = enrollmentOf(s, p)!;
    p.fatigue = 95;
    const prog0 = p.courseProgress.miningBasic ?? 0;
    step(s);
    expect(en.pauseReason).toContain('疲劳');
    expect(p.courseProgress.miningBasic ?? 0).toBe(prog0);
    p.fatigue = 30;
    step(s);
    expect(en.pauseReason).toBe('');
    A.pauseEnrollment(s, en.id, true);
    expect(en.mentorId).toBeNull();
    const pr = p.courseProgress.miningBasic;
    for (let i = 0; i < 30; i++) step(s);
    expect(p.courseProgress.miningBasic).toBe(pr);
    expect(Object.values(deptStats(s)).some((d) => d.workers.includes(p)) || p.groupId != null || p.recoveringUntil > s.time).toBe(true);
    A.pauseEnrollment(s, en.id, false);
    step(s);
    expect(en.mentorId).not.toBeNull();
  });

  it('暂停游戏不推进；不同速度累计结果一致；培训中存读档一致；航行中继续', () => {
    const a = started(6);
    const b = started(6);
    const pa = miningCandidates(a)[0];
    const pb = b.passengers.find((x) => x.id === pa.id)!;
    A.enroll(a, pa.id, 'miningBasic');
    A.enroll(b, pb.id, 'miningBasic');
    a.paused = true;
    const pr0 = pa.courseProgress.miningBasic ?? 0;
    advance(a, { acc: 0 }, 5000);
    expect(pa.courseProgress.miningBasic ?? 0).toBe(pr0);
    a.paused = false;
    a.speed = 8;
    const clock = { acc: 0 };
    let n = 0;
    while (n < 120) n += advance(a, clock, 100);
    for (let i = 0; i < n; i++) step(b);
    b.speed = 8;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const raw = serialize(a);
    const x = deserialize(raw);
    const y = deserialize(raw);
    for (let i = 0; i < 200; i++) {
      step(x);
      step(y);
    }
    expect(JSON.stringify(x)).toBe(JSON.stringify(y));
    // 航行中继续（新开局：报名后立即离站）
    const t = started(8);
    const pt = miningCandidates(t)[0];
    A.enroll(t, pt.id, 'miningBasic');
    t.train.driveRepaired = true;
    t.inventory.trainFuel = 60;
    A.departTo(t, 1);
    expect(t.phase).toBe('travel');
    const before = pt.courseProgress.miningBasic ?? 0;
    for (let i = 0; i < 60; i++) step(t);
    expect(t.phase).toBe('travel');
    expect(pt.courseProgress.miningBasic).toBeGreaterThan(before);
  });
});

describe('培训 → 新组 → 出勤交付（不降低职业要求）', () => {
  it('公共备用机 + 培训出的采掘工 → 第三组成立（该成员按资格占采掘工名额）→ 出勤、交付、得贡献点', () => {
    const s = started(3);
    A.startScan(s);
    s.train.driveRepaired = true;
    A.captainOrderShuttle(s);
    const req = JSON.stringify(s.groupRequirement);
    const p = miningCandidates(s).find((x) => x.profession !== 'miner')!;
    A.enroll(s, p.id, 'miningBasic');
    runCourse(s, p, 'miningBasic', 2000);
    expect(hasQual(p, 'miner')).toBe(true);
    for (let i = 0; i < 400 && s.groups.length < 3; i++) step(s);
    expect(JSON.stringify(s.groupRequirement)).toBe(req); // 未降低要求
    expect(s.groups.length).toBe(3);
    const g3 = s.groups[2];
    expect(g3.memberIds).toContain(p.id);
    expect(g3.memberRoles[p.id]).toBe('miner');
    expect(p.profession).not.toBe('miner');
    // 一人一名额
    expect(new Set(Object.keys(g3.memberRoles)).size).toBe(g3.memberIds.length);
    s.inventory.propellant = 200;
    for (let i = 0; i < 1200 && g3.pointsEarned === 0; i++) step(s);
    expect(g3.trips).toBeGreaterThan(0);
    expect(g3.pointsEarned).toBeGreaterThan(0);
    const ids = s.groups.flatMap((g) => g.memberIds);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('在岗学习', () => {
  it('只在实际采矿时提升已具备资格的技能；在列车待命不提升；未具备资格的技能不提升', () => {
    const s = started(3);
    A.startScan(s);
    const g = s.groups[0];
    const miner = s.passengers.find((p) => g.memberRoles[p.id] === 'miner')!;
    const pilot = s.passengers.find((p) => g.memberRoles[p.id] === 'pilot')!;
    const m0 = miner.skills.mining;
    const pilotMining0 = pilot.skills.mining;
    let minedMinutes = 0;
    let prev = miner.skills.mining;
    for (let i = 0; i < 600; i++) {
      const wasMining = g.state === 'mining';
      step(s);
      if (miner.skills.mining > prev) {
        expect(wasMining || g.state === 'mining').toBe(true);
        minedMinutes++;
      }
      prev = miner.skills.mining;
    }
    expect(minedMinutes).toBeGreaterThan(0);
    expect(miner.skills.mining).toBeGreaterThan(m0);
    expect(miner.skills.mining - m0).toBeLessThan(5); // 缓慢
    expect(pilot.skills.mining).toBe(pilotMining0); // 驾驶员没有采掘资格，不会因随组采矿获得采掘技能
  });
});

describe('存档迁移 v5 → v6', () => {
  it('保留原技能、小组与资产；资格按技能计算；组内名额按原背景', () => {
    const s = started(5);
    for (let i = 0; i < 200; i++) step(s);
    const loaded = deserialize(toLegacy(s, 5));
    expect(loaded.version).toBe(6);
    expect(loaded.training.seats).toBe(TRAINING.baseSeats);
    for (const g of loaded.groups) for (const id of g.memberIds) expect(g.memberRoles[id]).toBe(loaded.passengers.find((p) => p.id === id)!.profession);
    expect(loaded.passengers.map((p) => p.skills)).toEqual(s.passengers.map((p) => p.skills));
    for (let i = 0; i < 200; i++) step(loaded);
  });
});
