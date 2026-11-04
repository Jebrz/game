// 小组编组：乘客按列车长规定的职业要求自行组队。
// 规则：一人只承担一个主要岗位；负责人不进入出勤小组；列车保留基本运营人员。

import { GROUPS, TRAIN_MIN_STAFF } from '../config/balance';
import { GROUP_NAMES, PROFESSION_INFO } from '../config/content';
import { COURSES, FIELD_MIN_AGE } from '../config/balance';
import { hasQual, inCourse, mentorLoad } from './training';

const COURSE_PROF: Record<string, Profession> = Object.fromEntries(COURSES.map((c) => [c.id, c.prof]));
import { log, person } from './core';
import type { GameState, Group, Passenger, Profession, Shuttle } from './types';

export function requirementTotal(req: Partial<Record<Profession, number>>): number {
  return Object.values(req).reduce((a, b) => a + (b ?? 0), 0);
}

/** 可加入出勤小组的人：非列车长、非负责人、在车上、健康与疲劳允许出勤、不在恢复期、不在其他小组。 */
function freeCandidates(s: GameState, exclude: Set<number>): Passenger[] {
  return s.passengers.filter(
    (p) =>
      !p.isCaptain &&
      !p.headRole &&
      !p.leftBehind &&
      p.aboard &&
      p.groupId == null &&
      !exclude.has(p.id) &&
      p.health >= GROUPS.minHealthToSortie &&
      p.fatigue <= GROUPS.restFatigue &&
      p.recoveringUntil <= s.time &&
      p.age >= FIELD_MIN_AGE &&
      !inCourse(s, p) &&
      mentorLoad(s, p) === 0,
  );
}

/** 计算列车必须保留的人员（按职业保留：负责人优先，其次技能最高者）。 */
export function reservedForTrain(s: GameState): Set<number> {
  const keep = new Set<number>();
  for (const [prof, n] of Object.entries(TRAIN_MIN_STAFF) as [Profession, number][]) {
    const pool = s.passengers
      .filter((p) => !p.isCaptain && !p.leftBehind && p.profession === prof && p.groupId == null)
      .sort((a, b) => (a.headRole ? -1 : 0) - (b.headRole ? -1 : 0) || skillOf(b) - skillOf(a));
    for (const p of pool.slice(0, n)) keep.add(p.id);
  }
  return keep;
}

function skillOf(p: Passenger): number {
  return Math.max(...Object.values(p.skills));
}

const PROF_SKILL: Partial<Record<Profession, keyof Passenger['skills']>> = {
  pilot: 'piloting',
  surveyor: 'survey',
  miner: 'mining',
  engineer: 'engineering',
  medic: 'medical',
  researcher: 'research',
  logistics: 'logistics',
};

function profSkill(p: Passenger, prof: Profession): number {
  const sk = PROF_SKILL[prof];
  return sk ? p.skills[sk] : 0;
}

function chooseLeader(s: GameState, g: Group): void {
  const ms = g.memberIds.map((id) => person(s, id));
  const leader = [...ms].sort((a, b) => b.skills.piloting + b.skills.survey * 0.5 - (a.skills.piloting + a.skills.survey * 0.5))[0];
  g.leaderId = leader?.id ?? null;
}

/**
 * 按列车长规定的职业要求调整在列车上的小组（出勤中的小组返回后再调整）。
 * 增量调整：保留现有成员，只释放超出要求的人、补充缺少的人；小组的贡献点、运输机、升级与历史不变。
 * 人员不足时保留现有成员并显示缺口，不解散、不与其他组抢人。
 */
export function reformGroups(s: GameState): void {
  const req = s.groupRequirement;
  const changes: string[] = [];
  for (const g of s.groups) {
    if (!isHome(g) || g.state === 'unloading') {
      g.pendingReform = true;
      continue;
    }
    g.pendingReform = false;
    const ms = g.memberIds.map((id) => person(s, id));
    // 1) 释放超出要求（或不在要求中的职业）的成员：保留技能最高者
    const released: string[] = [];
    const keep: Passenger[] = [];
    const byProf = new Map<Profession, Passenger[]>();
    for (const p of ms) {
      const role = g.memberRoles[p.id] ?? p.profession;
      byProf.set(role, [...(byProf.get(role) ?? []), p]);
    }
    for (const [prof, list] of byProf) {
      const n = req[prof] ?? 0;
      const sorted = list.sort((a, b) => profSkill(b, prof) - profSkill(a, prof));
      keep.push(...sorted.slice(0, n));
      for (const p of sorted.slice(n)) {
        p.groupId = null;
        delete g.memberRoles[p.id];
        released.push(p.name);
      }
    }
    g.memberIds = keep.map((p) => p.id);
    // 2) 补充缺少的成员（不占用列车必需岗位与其他组成员）
    const { added, missing } = fillGaps(s, g);
    g.missing = missing;
    chooseLeader(s, g);
    if (released.length || added.length) changes.push(`${g.name}${added.length ? ` 加入 ${added.join('、')}` : ''}${released.length ? ` 离组 ${released.join('、')}` : ''}`);
    if (missing.length) {
      setState(s, g, 'grounded', `编组不足：缺少 ${missing.join('、')}`);
      g.timer = 10;
    } else if (g.state === 'grounded' && g.status.startsWith('编组')) {
      setState(s, g, 'docked', '编组完成，待命');
      g.timer = 1;
    }
  }
  const summary = s.groups.map((g) => `${g.name}${g.missing.length ? `（缺 ${g.missing.join('、')}）` : `（${g.memberIds.length}人）`}`);
  const pending = s.groups.filter((g) => g.pendingReform).map((g) => g.name);
  log(s, 'group', `按职业要求调整编组：${changes.length ? changes.join('；') + '。' : '在列车上的小组人员无变动。'}${pending.length ? `${pending.join('、')}出勤中，返航后再调整。` : ''}现状：${summary.join('，')}`);
}

/** 按职业要求为小组补充缺少的成员（只从空闲合格人员中递补，不占用列车必需人员、学员、导师与其他组成员）。 */
function fillGaps(s: GameState, g: Group): { added: string[]; missing: string[] } {
  const req = s.groupRequirement;
  const reserved = reservedForTrain(s);
  const added: string[] = [];
  const missing: string[] = [];
  for (const [prof, need] of Object.entries(req) as [Profession, number][]) {
    if (!need) continue;
    const have = g.memberIds.filter((id) => (g.memberRoles[id] ?? person(s, id).profession) === prof).length;
    if (have >= need) continue;
    const pool = freeCandidates(s, reserved)
      .filter((p) => hasQual(p, prof))
      .sort((a, b) => profSkill(b, prof) - profSkill(a, prof));
    const got = pool.slice(0, need - have);
    for (const p of got) {
      p.groupId = g.id;
      g.memberIds.push(p.id);
      g.memberRoles[p.id] = prof;
      added.push(`${p.name}（${PROFESSION_INFO[prof].label}）`);
    }
    if (have + got.length < need) missing.push(`${PROFESSION_INFO[prof].label} ×${need - have - got.length}`);
  }
  return { added, missing };
}

/** 能否从空闲合格人员中为该职业递补一人（不改变状态） */
export function canRefill(s: GameState, prof: Profession): boolean {
  const reserved = reservedForTrain(s);
  return freeCandidates(s, reserved).some((p) => hasQual(p, prof));
}

/**
 * 成员离组（例如留车担任导师）：小组保留贡献点、运输机与历史，空缺由空闲合格人员递补；
 * 无人可递补时记录缺口（与编组不足相同的处理）。返回递补说明。
 */
export function releaseMember(s: GameState, g: Group, p: Passenger): { added: string[]; missing: string[] } {
  g.memberIds = g.memberIds.filter((id) => id !== p.id);
  delete g.memberRoles[p.id];
  p.groupId = null;
  const r = fillGaps(s, g);
  g.missing = r.missing;
  chooseLeader(s, g);
  return r;
}

/** 在列车上的小组有缺口时，尝试从空闲合格人员中递补（例如授课导师结束授课后）。 */
export function refillGroup(s: GameState, g: Group): void {
  if (!g.missing.length || !isHome(g) || g.state === 'unloading') return;
  const r = fillGaps(s, g);
  g.missing = r.missing;
  if (!r.added.length) return;
  chooseLeader(s, g);
  log(s, 'group', `${g.name}递补成员：${r.added.join('、')}${r.missing.length ? `；仍缺 ${r.missing.join('、')}` : '，编组已满'}。`);
  if (!r.missing.length && g.state === 'grounded' && g.status.startsWith('编组')) {
    setState(s, g, 'docked', '编组完成，待命');
    g.timer = 1;
  }
}

// ---------------- 动态新增小组 ----------------

export interface FormationCheck {
  ok: boolean;
  reasons: string[];
  spare: Shuttle | null;
  picked: Passenger[];
  roles: Map<number, Profession>; // 每人承担的名额
  available: Partial<Record<Profession, number>>; // 具备该资格的空闲可出勤人员（已扣除列车必需人手；一人多资格时分别计入）
  spares: number; // 可用于新组的公共备用机
}

/** 能否成立一个新小组（不改变状态） */
export function checkNewGroup(s: GameState): FormationCheck {
  const reasons: string[] = [];
  const reserved = reservedForTrain(s);
  const cands = freeCandidates(s, reserved);
  const available: Partial<Record<Profession, number>> = {};
  for (const p of cands) for (const q of p.quals) available[q] = (available[q] ?? 0) + 1;
  // 可用的公共备用机：未被配属、未被预约、不属于任何小组出资、停在机库
  const spares = s.shuttles.filter((x) => x.assignedTo === 'spare' && x.ownerGroupId == null && x.docked && !s.groups.some((g) => g.pendingSwap === x.id));
  if (s.phase === 'intro' || s.phase === 'failed') reasons.push('游戏未进行');
  if (!spares.length) reasons.push('缺运输机：没有可分配的公共备用机（列车长座机、小组私有备用机和已预约换装的运输机不会被占用）');
  const needy = s.groups.filter((g) => g.memberIds.length && g.shuttleId == null);
  if (spares.length && needy.length) reasons.push(`${needy.map((g) => g.name).join('、')}缺主运输机，公共备用机应先由列车长分配给它们`);
  const picked: Passenger[] = [];
  const roles = new Map<number, Profession>();
  for (const [prof, need] of Object.entries(s.groupRequirement) as [Profession, number][]) {
    if (!need) continue;
    // 一名多资格乘客只占一个名额：已被选中的人不再计入其他职业
    const pool = cands.filter((p) => hasQual(p, prof) && !picked.includes(p)).sort((a, b) => profSkill(b, prof) - profSkill(a, prof));
    for (const p of pool.slice(0, need)) {
      picked.push(p);
      roles.set(p.id, prof);
    }
    if (pool.length < need) {
      const minStaff = TRAIN_MIN_STAFF[prof] ?? 0;
      const tired = s.passengers.filter((p) => !p.isCaptain && !p.headRole && !p.leftBehind && p.groupId == null && hasQual(p, prof) && !cands.includes(p) && !reserved.has(p.id)).length;
      const inTraining = s.training.enrollments.filter((e) => COURSE_PROF[e.courseId] === prof).length;
      reasons.push(
        `缺${PROFESSION_INFO[prof].label} ×${need - pool.length}（空闲合格 ${pool.length}${minStaff ? `，需保留 ${minStaff} 名在列车运营` : ''}${tired ? `，另有 ${tired} 人因健康/疲劳/恢复/培训/授课暂不能出勤` : ''}${inTraining ? `，${inTraining} 人正在接受该职业培训` : ''}${['pilot', 'surveyor', 'miner', 'engineer'].includes(prof) ? '；可在「培训」面板安排课程' : ''}）`,
      );
    }
  }
  if (requirementTotal(s.groupRequirement) < 2) reasons.push('职业要求过少');
  return { ok: reasons.length === 0, reasons, spare: spares[0] ?? null, picked, roles, available, spares: spares.length };
}

const EXTRA_NAMES = ['赤鸢组', '青岚组', '玄鹭组', '白鲸组', '苍狼组', '金蜂组'];

function uniqueGroupName(s: GameState): string {
  const used = new Set(s.groups.map((g) => g.name));
  for (const n of [...GROUP_NAMES, ...EXTRA_NAMES]) if (!used.has(n)) return n;
  let i = s.groups.length + 1;
  while (used.has(`第${i}组`)) i++;
  return `第${i}组`;
}

/** 满足条件时自动成立新小组：乘客自行组队、推选组长、领取公共备用机。不发放任何贡献点、燃料或材料。 */
export function tryFormNewGroup(s: GameState): Group | null {
  const c = checkNewGroup(s);
  const text = c.ok ? '' : c.reasons.join('；');
  if (s.formationNote !== text) {
    // 原因变化时才记录，避免刷屏
    if (text && s.shuttles.some((x) => x.assignedTo === 'spare' && x.ownerGroupId == null)) log(s, 'group', `暂无法成立新小组：${text}`);
    s.formationNote = text;
  }
  if (!c.ok || !c.spare) return null;
  const g: Group = {
    id: s.nextId++,
    name: uniqueGroupName(s),
    leaderId: null,
    memberIds: c.picked.map((p) => p.id),
    memberRoles: Object.fromEntries(c.roles),
    shuttleId: c.spare.id,
    points: 0,
    pointsEarned: 0,
    pointsSpent: 0,
    state: 'docked',
    stateSince: s.time,
    timer: 2,
    target: null,
    status: '新组成立，待命',
    reason: '',
    decisions: [],
    missing: [],
    pendingReform: false,
    recalled: false,
    returnReason: '',
    lastCargoFullRatio: 0,
    trips: 0,
    purchases: [],
    loot: {},
    lootResearch: 0,
    pendingSwap: null,
    exploreStreak: 0,
  };
  for (const p of c.picked) p.groupId = g.id;
  c.spare.assignedTo = 'group';
  s.groups.push(g);
  chooseLeader(s, g);
  const leader = person(s, g.leaderId!);
  s.formationNote = '';
  log(s, 'group', `新小组成立：${g.name}（${c.picked.map((p) => `${p.name}·${PROFESSION_INFO[c.roles.get(p.id)!].label}${c.roles.get(p.id) !== p.profession ? `（背景${PROFESSION_INFO[p.profession].label}，培训取得资格）` : ''}`).join('、')}），组长 ${leader.name}（${leader.personality === 'bold' ? '进取' : '稳健'}），领取公共备用机 ${c.spare.name}。贡献点从 0 开始。`);
  s.toasts.push({ t: s.time, title: '新小组成立', text: `${g.name}领取 ${c.spare.name}，将自主出勤。` });
  return g;
}

export function isHome(g: Group): boolean {
  return g.state === 'docked' || g.state === 'resting' || g.state === 'grounded';
}

export function setState(s: GameState, g: Group, state: Group['state'], status: string, reason = ''): void {
  g.state = state;
  g.stateSince = s.time;
  g.status = status;
  if (reason) g.reason = reason;
}

export function decide(s: GameState, g: Group, text: string, logIt = true): void {
  g.reason = text;
  g.decisions.unshift({ time: s.time, text });
  if (g.decisions.length > GROUPS.decisionLogMax) g.decisions.length = GROUPS.decisionLogMax;
  if (logIt) log(s, 'group', `${g.name}：${text}`);
}

export function leaderPersonality(s: GameState, g: Group): 'steady' | 'bold' {
  return g.leaderId != null ? person(s, g.leaderId).personality : 'steady';
}
