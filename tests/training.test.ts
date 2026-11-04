import { describe, expect, it } from 'vitest';
import { COURSES, QUAL_THRESHOLD, TRAINING } from '../src/config/balance';
import * as A from '../src/sim/actions';
import { advance } from '../src/sim/clock';
import { checkNewGroup, reservedForTrain } from '../src/sim/groups';
import { deserialize, serialize } from '../src/sim/save';
import { deptStats, isWorking } from '../src/sim/staff';
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
    const e0 = s.inventory.energy;
    A.enroll(s, p.id, 'miningBasic');
    const en = enrollmentOf(s, p)!;
    expect(en).toBeTruthy();
    expect(mining.cost.iron).toBeUndefined(); // 开局铁矿为 0：采掘课程不再消耗铁矿
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
    s2.inventory.energy = 10;
    const c2 = s2.passengers.find((p) => canEnroll(s2, p, 'miningBasic').length === 1)!;
    expect(canEnroll(s2, c2, 'miningBasic').join()).toContain('材料不足');
    A.enroll(s2, c2.id, 'miningBasic');
    expect(s2.training.enrollments.length).toBe(0);
  });

  it('取消：无进度时退还；有进度时保留已得技能、材料不退；重报从原进度继续且不再收费，总提升不超过课程上限', () => {
    const s = started();
    const p = miningCandidates(s)[0];
    const e0 = s.inventory.energy;
    A.enroll(s, p.id, 'miningBasic');
    expect(s.inventory.energy).toBe(e0 - mining.cost.energy!);
    A.cancelEnrollment(s, enrollmentOf(s, p)!.id);
    expect(s.inventory.energy).toBe(e0);
    const start = skillOfCourse(p, mining);
    A.enroll(s, p.id, 'miningBasic');
    for (let i = 0; i < 100; i++) step(s);
    const mid = skillOfCourse(p, mining);
    expect(mid).toBeGreaterThan(start);
    A.cancelEnrollment(s, enrollmentOf(s, p)!.id);
    expect(skillOfCourse(p, mining)).toBe(mid);
    expect(p.coursePaid.miningBasic).toBe(true); // 有进度后取消：材料不退
    const eBefore = s.inventory.energy;
    A.enroll(s, p.id, 'miningBasic');
    expect(s.inventory.energy).toBe(eBefore); // 不再收费
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

describe('正常游玩：导师都在出勤小组时的培训（种子 79，不注入材料）', () => {
  /** 正常开局：扫描后两组出勤；不改职业要求、不给材料 */
  function normalStart(): GameState {
    const s = createInitialState(79);
    A.startGame(s);
    A.startScan(s);
    for (let i = 0; i < 400 && !s.groups.every((g) => g.memberIds.every((id) => !s.passengers.find((p) => p.id === id)!.aboard)); i++) step(s);
    return s;
  }
  const minerMentors = (s: GameState) => mentorsFor(s, mining).all.map((p) => p.id).sort();

  it('导师全部出勤时可报名等待；学员先回原岗位；导师返航后离组留车授课、空缺由空闲合格者递补；完成后学员加入第三组出勤交付', () => {
    const s = normalStart();
    const req0 = JSON.stringify(s.groupRequirement);
    const mentors0 = minerMentors(s);
    expect(mentors0.length).toBeGreaterThan(0);
    expect(mentorsFor(s, mining).available.length).toBe(0); // 导师都在出勤
    expect(s.inventory.iron).toBe(0); // 开局缺铁不再阻塞采掘课程
    const p = s.passengers.find((x) => x.profession === 'logistics' && !canEnroll(s, x, 'miningBasic').length)!;
    expect(p).toBeTruthy();
    const e0 = s.inventory.energy;
    A.enroll(s, p.id, 'miningBasic');
    const en = enrollmentOf(s, p)!;
    expect(en.mentorId).toBeNull();
    expect(en.pauseReason).toContain('等待导师');
    expect(s.inventory.energy).toBe(e0 - mining.cost.energy!);
    expect(isWorking(s, p)).toBe(true); // 等待期间在原岗位工作
    expect(p.groupId).toBeNull();
    // 推进到导师到位
    let t = 0;
    while (en.mentorId == null && t++ < 600) {
      step(s);
      if (en.mentorId == null) expect(p.courseProgress.miningBasic ?? 0).toBe(0); // 没有导师不推进
    }
    const mentor = s.passengers.find((x) => x.id === en.mentorId)!;
    expect(mentors0).toContain(mentor.id); // 导师是原有合格人员，不是凭空生成
    expect(mentor.aboard).toBe(true);
    expect(mentor.groupId).toBeNull(); // 离组留车
    expect(s.log.some((l) => l.text.includes(`${mentor.name}离开`) && l.text.includes('递补'))).toBe(true);
    // 原小组仍满足职业要求（由空闲合格采掘工递补），职业要求未被降低
    for (const g of s.groups) expect(g.memberIds.filter((id) => g.memberRoles[id] === 'miner').length).toBe(2);
    expect(JSON.stringify(s.groupRequirement)).toBe(req0);
    step(s);
    expect(isMentoring(s, mentor)).toBe(true);
    expect(isWorking(s, mentor)).toBe(false);
    expect(isWorking(s, p)).toBe(false);
    runCourse(s, p, 'miningBasic');
    expect(hasQual(p, 'miner')).toBe(true);
    expect(minerMentors(s)).toEqual(mentors0);
    // 新组只差运输机：缺口不再是采掘工
    const c = checkNewGroup(s);
    expect(c.reasons.join()).not.toContain('缺采掘工');
    expect(c.reasons.join()).toContain('缺运输机');
    // 列车长制造公共备用机（此脚本不管理采集与推进剂，补材料只为验证成立与出勤规则；界面验证走真实采集）
    s.inventory = { ...s.inventory, parts: s.inventory.parts + 13, iron: s.inventory.iron + 10, copper: s.inventory.copper + 6, crystal: s.inventory.crystal + 4, propellant: s.inventory.propellant + 120 };
    A.captainOrderShuttle(s);
    let g3 = undefined as GameState['groups'][number] | undefined;
    for (let i = 0; i < 600 && !g3; i++) {
      step(s);
      g3 = s.groups[2];
    }
    expect(g3).toBeTruthy();
    expect(g3!.memberIds).toContain(p.id);
    expect(g3!.memberRoles[p.id]).toBe('miner');
    expect(g3!.points).toBe(0);
    expect(JSON.stringify(s.groupRequirement)).toBe(req0);
    for (let i = 0; i < 900 && g3!.pointsEarned <= 0; i++) step(s);
    expect(g3!.trips).toBeGreaterThan(0);
    expect(g3!.pointsEarned).toBeGreaterThan(0);
  });

  it('勘探课程同样可以等待出勤中的导师', () => {
    const s = normalStart();
    expect(mentorsFor(s, COURSES.find((c) => c.id === 'surveyBasic')!).available.length).toBe(0);
    const p = s.passengers.find((x) => !canEnroll(s, x, 'surveyBasic').length)!;
    expect(p).toBeTruthy();
    A.enroll(s, p.id, 'surveyBasic');
    const en = enrollmentOf(s, p)!;
    expect(en.pauseReason).toContain('等待导师');
    for (let i = 0; i < 600 && en.mentorId == null; i++) step(s);
    expect(en.mentorId).not.toBeNull();
    for (let i = 0; i < 400 && !p.coursesDone.includes('surveyBasic'); i++) step(s);
    expect(hasQual(p, 'surveyor')).toBe(true);
  });

  it('等待中的学员不会被编入小组；等待中存读档一致；等待中取消原样退还；没有任何合格导师时拒绝报名', () => {
    const s = normalStart();
    const p = s.passengers.find((x) => x.profession === 'logistics' && !canEnroll(s, x, 'miningBasic').length)!;
    const e0 = s.inventory.energy;
    A.enroll(s, p.id, 'miningBasic');
    const s2 = deserialize(serialize(s))!;
    const p2 = s2.passengers.find((x) => x.id === p.id)!;
    expect(enrollmentOf(s2, p2)!.pauseReason).toContain('等待导师');
    for (let i = 0; i < 30; i++) {
      step(s);
      step(s2);
    }
    expect(JSON.stringify(s2.training)).toBe(JSON.stringify(s.training));
    expect(p.groupId).toBeNull();
    A.cancelEnrollment(s, enrollmentOf(s, p)!.id);
    expect(p.coursePaid.miningBasic).toBe(false);
    expect(s.inventory.energy).toBeGreaterThan(e0 - 5); // 退还课程能源（只差 30 分钟正常消耗）
    // 没有合格导师：不能报名（不凭空生成导师）
    const s3 = normalStart();
    for (const q of s3.passengers) q.skills.mining = Math.min(q.skills.mining, 50);
    const q = s3.passengers.find((x) => x.profession === 'logistics' && !x.headRole && !reservedForTrain(s3).has(x.id))!;
    expect(canEnroll(s3, q, 'miningBasic').join()).toContain('没有合格导师');
  });

  it('列车上有空闲导师时优先使用，不拆小组；小组成员任导师且无人递补时记录缺口', () => {
    const s = started(79);
    // 开局时小组都在列车上：导师从小组借调，优先其空缺可递补者
    const p = s.passengers.find((x) => x.profession === 'logistics' && !canEnroll(s, x, 'miningBasic').length)!;
    A.enroll(s, p.id, 'miningBasic');
    const m = s.passengers.find((x) => x.id === enrollmentOf(s, p)!.mentorId)!;
    expect(m.groupId).toBeNull();
    for (const g of s.groups) expect(g.missing).toEqual([]);
    // 第二名学员：现有导师还能带 1 人，优先使用列车上的空闲导师，不再拆组
    const q = s.passengers.find((x) => x.id !== p.id && x.profession === 'logistics' && !canEnroll(s, x, 'miningBasic').length)!;
    const before = s.groups.map((g) => g.memberIds.join());
    A.enroll(s, q.id, 'miningBasic');
    expect(enrollmentOf(s, q)!.mentorId).toBe(m.id);
    expect(s.groups.map((g) => g.memberIds.join())).toEqual(before);
  });
});

describe('导师离组后的缺口', () => {
  it('无人可递补时记录缺口（不降低要求、不凭空补人）；之后有空闲合格者时自动递补', () => {
    const s = started(79);
    const req0 = JSON.stringify(s.groupRequirement);
    const spare = s.passengers.find((p) => p.name === '孙岩')!;
    spare.fatigue = 95; // 唯一的空闲合格采掘工暂不能出勤
    const p = s.passengers.find((x) => x.profession === 'logistics' && !canEnroll(s, x, 'miningBasic').length)!;
    A.enroll(s, p.id, 'miningBasic');
    const m = s.passengers.find((x) => x.id === enrollmentOf(s, p)!.mentorId)!;
    const g = s.groups.find((x) => x.missing.length)!;
    expect(g).toBeTruthy();
    expect(g.missing.join()).toContain('采掘工 ×1');
    expect(g.memberIds).not.toContain(m.id);
    expect(s.log.some((l) => l.text.includes('无人可递补'))).toBe(true);
    expect(JSON.stringify(s.groupRequirement)).toBe(req0);
    spare.fatigue = 10;
    for (let i = 0; i < 20 && g.missing.length; i++) step(s);
    expect(g.missing).toEqual([]);
    expect(g.memberIds).toContain(spare.id);
    expect(g.memberRoles[spare.id]).toBe('miner');
    expect(s.log.some((l) => l.text.includes(`${g.name}递补成员：孙岩`))).toBe(true);
  });
});
