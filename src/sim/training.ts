// 乘客培训与职业资格
//
// 规则摘要（界面同步显示）：
// - 背景职业不变；职业资格 = 对应技能达到门槛。组队按资格，一人在组内只占一个名额。
// - 脱产培训：需要培训位与合格导师（技能 ≥ 55，每人最多同时带 2 人）。学员与授课中的导师都不提供原岗位产能、不能出勤。
// - 材料每人每课程只付一次；技能逐分钟获得，取消后保留已得部分，重报从原进度继续，不会重复领取。尚无进度时取消可原样退还。
// - 自动暂停：学员疲劳过高/健康过低、能源不足。条件恢复后自动继续。手动暂停：学员回到原岗位，导师释放，名额保留。
// - 等待导师：合格导师都在出勤或带教已满时也可报名（材料照付、占培训位），学员先回原岗位工作；
//   出勤小组中的合格导师回到列车（未在卸货）时离组留车授课，小组空缺由空闲合格人员递补，无人递补则显示缺口。
//   导师不是凭空生成的，授课期间不提供原岗位产能也不出勤；授课结束后成为空闲人员，可递补或加入新组。
// - 在岗学习：只提升已具备资格的技能，且只在实际执行对应工作时；不会获得新资格。
// - 未成年人、负责人、列车长不参加出勤课程；不能抽走列车最低运营人员。

import { COURSES, FIELD_MIN_AGE, QUAL_SKILL, QUAL_THRESHOLD, TRAINING, type CourseDef } from '../config/balance';
import { PROFESSION_INFO } from '../config/content';
import { add, consume, costText, fmt, log, missingItems, newId } from './core';
import { canRefill, checkNewGroup, isHome, releaseMember, reservedForTrain, type FormationCheck } from './groups';
import { insertJob, materialBlocks, QUEUE_MAX } from './hangar';
import type { Enrollment, GameState, Passenger, Profession } from './types';

export function hasQual(p: Passenger, prof: Profession): boolean {
  return p.quals.includes(prof);
}

/** 按当前技能计算资格（开局与迁移时使用；之后只有课程完成能新增资格） */
export function initialQuals(p: Passenger): Profession[] {
  const out: Profession[] = [];
  for (const [prof, sk] of Object.entries(QUAL_SKILL) as [Profession, keyof Passenger['skills']][]) {
    if (p.skills[sk] >= QUAL_THRESHOLD[prof as keyof typeof QUAL_THRESHOLD]) out.push(prof);
  }
  return out;
}

export function course(id: string): CourseDef {
  return COURSES.find((c) => c.id === id)!;
}

export function skillOfCourse(p: Passenger, c: CourseDef): number {
  return p.skills[QUAL_SKILL[c.prof]];
}

export function enrollmentOf(s: GameState, p: Passenger): Enrollment | null {
  return s.training.enrollments.find((e) => e.traineeId === p.id) ?? null;
}

/** 等待导师状态（旧存档的「没有可用导师」暂停原因也视为等待导师） */
export const MENTOR_WAIT = '等待导师：合格导师出勤中或带教已满，导师回到列车后留车授课';
export function waitingMentor(e: Enrollment): boolean {
  return !e.manualPause && (e.pauseReason === MENTOR_WAIT || e.pauseReason.startsWith('没有可用导师'));
}

/** 已报名且未手动暂停（含等待导师）：不加入出勤小组 */
export function inCourse(s: GameState, p: Passenger): boolean {
  const e = enrollmentOf(s, p);
  return !!e && !e.manualPause;
}

/** 学员脱产中（未手动暂停、不在等待导师）：不工作、不出勤。等待导师期间学员在原岗位工作。 */
export function isTraining(s: GameState, p: Passenger): boolean {
  const e = enrollmentOf(s, p);
  return !!e && !e.manualPause && !waitingMentor(e);
}

/** 导师正在授课：不工作、不出勤 */
export function isMentoring(s: GameState, p: Passenger): boolean {
  return s.training.enrollments.some((e) => e.mentorId === p.id && !e.manualPause && !e.pauseReason);
}

export function mentorLoad(s: GameState, p: Passenger): number {
  return s.training.enrollments.filter((e) => e.mentorId === p.id).length;
}

/** 可作为该课程导师的人：技能达标、在列车上、不在出勤途中、自己不在培训、未超带教上限 */
export function mentorsFor(s: GameState, c: CourseDef, exclude?: number): { available: Passenger[]; busy: Passenger[]; all: Passenger[] } {
  const all = s.passengers.filter((p) => !p.isCaptain && !p.leftBehind && skillOfCourse(p, c) >= TRAINING.mentorMin && p.id !== exclude);
  const ok = (p: Passenger) => {
    if (!p.aboard || p.recoveringUntil > s.time) return false;
    if (enrollmentOf(s, p)) return false;
    if (p.groupId != null) {
      const g = s.groups.find((x) => x.id === p.groupId);
      if (g && (!isHome(g) || g.state === 'unloading')) return false;
    }
    return mentorLoad(s, p) < TRAINING.perMentor;
  };
  const available = all.filter(ok).sort((a, b) => (a.groupId == null ? 0 : 1) - (b.groupId == null ? 0 : 1) || mentorLoad(s, a) - mentorLoad(s, b));
  return { available, busy: all.filter((p) => !ok(p)), all };
}

/** 合格导师中，出勤在外或正在卸货、之后可留车授课的人（不含带教已满者） */
export function mentorsAway(s: GameState, c: CourseDef, exclude?: number): Passenger[] {
  const { available, all } = mentorsFor(s, c, exclude);
  return all.filter((p) => !available.includes(p) && p.groupId != null && !enrollmentOf(s, p) && mentorLoad(s, p) < TRAINING.perMentor);
}

/**
 * 为课程挑选导师：优先列车上的非小组人员；其次在列车上的小组成员（优先其空缺能被递补的），
 * 小组成员担任导师时离组留车授课，空缺按编组规则递补。
 */
function assignMentor(s: GameState, e: Enrollment, c: CourseDef): Passenger | null {
  const avail = mentorsFor(s, c, e.traineeId).available;
  if (!avail.length) return null;
  const score = (p: Passenger) => {
    if (p.groupId == null) return 0;
    const g = s.groups.find((x) => x.id === p.groupId);
    const role = g?.memberRoles[p.id] ?? p.profession;
    return canRefill(s, role) ? 1 : 2;
  };
  const m = [...avail].sort((a, b) => score(a) - score(b) || mentorLoad(s, a) - mentorLoad(s, b))[0];
  e.mentorId = m.id;
  const g = m.groupId != null ? s.groups.find((x) => x.id === m.groupId) : undefined;
  if (g) {
    const role = PROFESSION_INFO[g.memberRoles[m.id] ?? m.profession].label;
    const r = releaseMember(s, g, m);
    const t = s.passengers.find((x) => x.id === e.traineeId)!;
    log(s, 'group', `${m.name}离开${g.name}，留车担任${t.name}「${c.label}」的导师（授课结束后成为空闲人员）。${r.added.length ? `${g.name}由 ${r.added.join('、')} 递补${role}名额。` : `${g.name}暂缺${r.missing.join('、') || role}，无人可递补；可降低职业要求或待人员空闲后递补。`}`);
  }
  return m;
}

export function seatsUsed(s: GameState): number {
  return s.training.enrollments.length;
}

/** 报名条件（返回所有不满足的原因） */
export function canEnroll(s: GameState, p: Passenger, courseId: string): string[] {
  const c = course(courseId);
  const r: string[] = [];
  if (s.phase === 'intro' || s.phase === 'failed') r.push('游戏未进行');
  if (p.isCaptain) r.push('列车长不参加');
  if (p.headRole) r.push('负责人承担主要岗位，不参加出勤课程');
  if (p.leftBehind) r.push('已不在列车上');
  if (p.age < FIELD_MIN_AGE) r.push(`未满 ${FIELD_MIN_AGE} 岁，不承担出勤岗位`);
  if (hasQual(p, c.prof)) r.push(`已具备${PROFESSION_INFO[c.prof].label}资格`);
  if (p.coursesDone.includes(c.id)) r.push('已完成该课程');
  if (enrollmentOf(s, p)) r.push('已在其他课程中');
  if (isMentoring(s, p) || mentorLoad(s, p) > 0) r.push('正在担任导师');
  const remain = c.gain * (1 - (p.courseProgress[c.id] ?? 0));
  if (skillOfCourse(p, c) + remain < QUAL_THRESHOLD[c.prof]) r.push(`当前${fmt(skillOfCourse(p, c))}，一期课程最多 +${fmt(remain)}，达不到门槛 ${QUAL_THRESHOLD[c.prof]}`);
  if (!p.aboard) r.push('不在列车上（出勤中）');
  if (p.groupId != null) {
    const g = s.groups.find((x) => x.id === p.groupId);
    if (g && (!isHome(g) || g.state === 'unloading')) r.push(`${g.name}尚未返航`);
  }
  if (p.health < TRAINING.minHealth) r.push(`健康 ${fmt(p.health)} 低于 ${TRAINING.minHealth}`);
  if (p.fatigue > TRAINING.maxFatigue) r.push(`疲劳 ${fmt(p.fatigue)} 高于 ${TRAINING.maxFatigue}`);
  if (p.recoveringUntil > s.time) r.push('基因强化恢复中');
  if (reservedForTrain(s).has(p.id)) r.push(`需保留为列车最低运营人员（${PROFESSION_INFO[p.profession].label}）`);
  if (seatsUsed(s) >= s.training.seats) r.push(`培训位已满（${seatsUsed(s)}/${s.training.seats}）`);
  const ms = mentorsFor(s, c, p.id);
  if (!ms.available.length && !mentorsAway(s, c, p.id).length) r.push(ms.all.length ? `没有可用导师（合格导师均在培训或带教已满）` : `没有合格导师（需${PROFESSION_INFO[c.prof].label}技能 ≥ ${TRAINING.mentorMin}）`);
  if (!p.coursePaid[c.id]) {
    const miss = materialBlocks(s, c.cost);
    if (miss.length) r.push(`材料不足：${miss.join('、')}`);
  }
  return r;
}

/**
 * 名额提示：一人只占一个名额。已在小组担任其他职业的人、或已被新组计入其他名额的人，
 * 培训后不会增加新组人手（返回提示文字；空字符串 = 无此问题）。
 */
export function slotNote(s: GameState, p: Passenger, courseId: string, fc: FormationCheck = checkNewGroup(s)): string {
  const c = course(courseId);
  if (p.groupId != null) {
    const g = s.groups.find((x) => x.id === p.groupId);
    const role = g?.memberRoles[p.id] ?? p.profession;
    if (g && role !== c.prof) return `已是${g.name}${PROFESSION_INFO[role].label}；一人只占一个名额，培训后不增加新组人手`;
  }
  const r = fc.roles.get(p.id);
  if (r && r !== c.prof) return `新组已计入其为${PROFESSION_INFO[r].label}；一人只占一个名额，培训后不增加新组人手`;
  return '';
}

/** 可报名者，按界面顺序：没有名额问题的排前，其次技能高者 */
export function enrollOrder(s: GameState, courseId: string): { p: Passenger; note: string }[] {
  const c = course(courseId);
  const fc = checkNewGroup(s);
  return s.passengers
    .filter((p) => !p.isCaptain && !p.leftBehind && !canEnroll(s, p, courseId).length)
    .map((p) => ({ p, note: slotNote(s, p, courseId, fc) }))
    .sort((a, b) => (a.note ? 1 : 0) - (b.note ? 1 : 0) || skillOfCourse(b.p, c) - skillOfCourse(a.p, c));
}

export function enroll(s: GameState, p: Passenger, courseId: string): Enrollment | null {
  if (canEnroll(s, p, courseId).length) return null;
  const c = course(courseId);
  const paidNow = !p.coursePaid[c.id];
  if (paidNow) {
    consume(s.inventory, c.cost);
    p.coursePaid[c.id] = true;
  }
  const e: Enrollment = { id: newId(s), courseId, traineeId: p.id, mentorId: null, startedAt: s.time, manualPause: false, pauseReason: '', skillStart: skillOfCourse(p, c) };
  s.training.enrollments.push(e);
  const mentor = assignMentor(s, e, c);
  if (!mentor) e.pauseReason = MENTOR_WAIT;
  const away = mentor ? [] : mentorsAway(s, c, p.id).map((m) => m.name);
  log(
    s,
    'research',
    `${p.name}报名「${c.label}」${mentor ? `，开始脱产培训（导师 ${mentor.name}）` : `，等待导师（${away.join('、') || '合格导师'}回到列车后留车授课；等待期间学员在原岗位工作）`}${paidNow ? `，消耗 ${costText(c.cost)}` : '，从上次进度继续，不再收费'}。当前${PROFESSION_INFO[c.prof].label}技能 ${fmt(skillOfCourse(p, c))} / 门槛 ${QUAL_THRESHOLD[c.prof]}。`,
  );
  return e;
}

export function pauseEnrollment(s: GameState, id: number, on: boolean): void {
  const e = s.training.enrollments.find((x) => x.id === id);
  if (!e || e.manualPause === on) return;
  e.manualPause = on;
  if (on) e.mentorId = null;
  const p = s.passengers.find((x) => x.id === e.traineeId)!;
  log(s, 'research', `${p.name}的「${course(e.courseId).label}」${on ? '手动暂停：学员回到原岗位，导师释放，培训位保留' : '恢复'}。`);
}

/** 取消规则：已得技能保留；尚无进度时退还材料，否则材料不退（重报不再收费） */
export function cancelText(s: GameState, e: Enrollment): string {
  const p = s.passengers.find((x) => x.id === e.traineeId)!;
  const prog = p.courseProgress[e.courseId] ?? 0;
  return prog <= 0 ? `退还 ${costText(course(e.courseId).cost)}` : `保留已得技能与 ${fmt(prog * 100)}% 进度；材料已消耗不退（重报不再收费）`;
}

export function cancelEnrollment(s: GameState, id: number): void {
  const i = s.training.enrollments.findIndex((x) => x.id === id);
  if (i < 0) return;
  const e = s.training.enrollments[i];
  const p = s.passengers.find((x) => x.id === e.traineeId)!;
  const c = course(e.courseId);
  const text = cancelText(s, e);
  if ((p.courseProgress[c.id] ?? 0) <= 0 && p.coursePaid[c.id]) {
    add(s.inventory, c.cost);
    p.coursePaid[c.id] = false;
  }
  s.training.enrollments.splice(i, 1);
  log(s, 'research', `取消${p.name}的「${c.label}」：${text}。`);
}

/** 每分钟推进（暂停游戏时不调用） */
export function tickTraining(s: GameState): void {
  const done: Enrollment[] = [];
  for (const e of s.training.enrollments) {
    if (e.manualPause) continue;
    const p = s.passengers.find((x) => x.id === e.traineeId)!;
    const c = course(e.courseId);
    let reason = '';
    if (p.leftBehind || !p.aboard) reason = '学员不在列车上';
    else if (p.fatigue > TRAINING.pauseFatigue) reason = `学员疲劳 ${fmt(p.fatigue)} 过高，休息中`;
    else if (p.health < TRAINING.pauseHealth) reason = `学员健康 ${fmt(p.health)} 过低，治疗中`;
    else if (s.inventory.energy < TRAINING.energyHour / 60) reason = '能源不足';
    if (!reason) {
      const m = s.passengers.find((x) => x.id === e.mentorId);
      const mentorOk = m && m.aboard && !m.leftBehind && !enrollmentOf(s, m) && !(m.groupId != null && !isHome(s.groups.find((g) => g.id === m.groupId)!));
      if (!mentorOk) {
        e.mentorId = null;
        if (!assignMentor(s, e, c)) reason = MENTOR_WAIT;
      }
    }
    if (reason) {
      if (e.pauseReason !== reason) log(s, 'research', reason === MENTOR_WAIT ? `${p.name}的「${c.label}」${MENTOR_WAIT}；学员暂回原岗位工作。` : `${p.name}的「${c.label}」自动暂停：${reason}。条件恢复后自动继续。`);
      e.pauseReason = reason;
      if (reason !== MENTOR_WAIT) e.mentorId = null;
      continue;
    }
    if (e.pauseReason === MENTOR_WAIT || waitingMentor(e)) {
      const m = s.passengers.find((x) => x.id === e.mentorId);
      log(s, 'research', `导师 ${m?.name ?? ''}到位，${p.name}的「${c.label}」开始脱产授课。`);
    } else if (e.pauseReason) log(s, 'research', `${p.name}的「${c.label}」恢复进行。`);
    e.pauseReason = '';
    s.inventory.energy -= TRAINING.energyHour / 60;
    const step = Math.min(1 / c.time, 1 - (p.courseProgress[c.id] ?? 0));
    p.courseProgress[c.id] = (p.courseProgress[c.id] ?? 0) + step;
    p.skills[QUAL_SKILL[c.prof]] += c.gain * step;
    if (p.courseProgress[c.id] >= 1 - 1e-9) done.push(e);
  }
  for (const e of done) {
    const p = s.passengers.find((x) => x.id === e.traineeId)!;
    const c = course(e.courseId);
    s.training.enrollments = s.training.enrollments.filter((x) => x.id !== e.id);
    p.coursesDone.push(c.id);
    const sk = skillOfCourse(p, c);
    const ok = sk >= QUAL_THRESHOLD[c.prof] - 1e-6;
    if (ok && !hasQual(p, c.prof)) p.quals.push(c.prof);
    log(s, 'research', `${p.name}完成「${c.label}」：${PROFESSION_INFO[c.prof].label}技能 ${fmt(e.skillStart)} → ${fmt(sk)}${ok ? `，取得「${PROFESSION_INFO[c.prof].label}」资格（${c.unlock}）` : `，仍未达到门槛 ${QUAL_THRESHOLD[c.prof]}`}。`);
    s.toasts.push({ t: s.time, title: '培训完成', text: `${p.name}${ok ? `取得${PROFESSION_INFO[c.prof].label}资格` : '完成课程'}` });
  }
}

/** 在岗学习：只提升已具备资格的技能，且只在实际执行对应工作时调用 */
export function onJob(p: Passenger, prof: keyof typeof TRAINING.onJob): void {
  if (!hasQual(p, prof)) return;
  const sk = QUAL_SKILL[prof];
  const v = p.skills[sk];
  if (v >= TRAINING.onJobCap) return;
  p.skills[sk] = Math.min(TRAINING.onJobCap, v + TRAINING.onJob[prof] * (1 - v / 100));
}

// ---------------- 培训位扩建（走生产队列） ----------------

export function nextTrainingExpansion(s: GameState) {
  return TRAINING.expansions[s.training.level] ?? null;
}

export function canExpandTraining(s: GameState): string[] {
  const x = nextTrainingExpansion(s);
  if (!x) return ['本阶段培训位已扩建到上限'];
  const r: string[] = [];
  if (s.queue.some((j) => j.kind === 'training')) r.push('已有扩建工程在队列中');
  if (s.queue.length >= QUEUE_MAX) r.push('生产队列已满');
  const miss = missingItems(s.inventory, x.items);
  if (miss.length) r.push(`材料不足：${miss.join('、')}`);
  return r;
}

export function expandTraining(s: GameState): void {
  const x = nextTrainingExpansion(s);
  if (!x || canExpandTraining(s).length) return;
  consume(s.inventory, x.items);
  insertJob(s, { id: newId(s), kind: 'training', recipeId: String(s.training.level), remaining: x.time, total: x.time, started: false, orderedBy: null, reserved: { ...x.items }, pointsPaid: 0, orderedAt: s.time });
  log(s, 'economy', `列车长下单${x.label}：消耗 ${costText(x.items)}，标准工时 ${x.time} 分，完工后培训位 +${x.add}。`);
}

export function completeTrainingExpansion(s: GameState, level: number): void {
  const x = TRAINING.expansions[level];
  s.training.seats += x.add;
  s.training.level += 1;
  log(s, 'economy', `${x.label}完工：培训位 → ${s.training.seats}。`);
}
