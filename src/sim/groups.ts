// 小组编组：乘客按列车长规定的职业要求自行组队。
// 规则：一人只承担一个主要岗位；负责人不进入出勤小组；列车保留基本运营人员。

import { GROUPS, TRAIN_MIN_STAFF } from '../config/balance';
import { PROFESSION_INFO } from '../config/content';
import { log, person } from './core';
import type { GameState, Group, Passenger, Profession } from './types';

export function requirementTotal(req: Partial<Record<Profession, number>>): number {
  return Object.values(req).reduce((a, b) => a + (b ?? 0), 0);
}

/** 可加入出勤小组的人：非列车长、非负责人、在车上、健康达标、不在恢复期、不在其他小组。 */
function freeCandidates(s: GameState, exclude: Set<number>): Passenger[] {
  return s.passengers.filter(
    (p) =>
      !p.isCaptain &&
      !p.headRole &&
      !p.leftBehind &&
      p.aboard &&
      p.groupId == null &&
      !exclude.has(p.id) &&
      p.health >= GROUPS.minHealthToSortie,
  );
}

/** 计算列车必须保留的人员（按职业保留技能最高者）。 */
export function reservedForTrain(s: GameState): Set<number> {
  const keep = new Set<number>();
  for (const [prof, n] of Object.entries(TRAIN_MIN_STAFF) as [Profession, number][]) {
    // 负责人本身也算岗位人员
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

/**
 * 重新编组所有在列车上待命的小组（出勤中的小组标记为返回后重组）。
 * 乘客自行组队：按职业技能择优，组长取驾驶或综合能力最高者。
 */
export function reformGroups(s: GameState): void {
  const reserved = reservedForTrain(s);
  for (const g of s.groups) {
    if (!isHome(g)) {
      g.pendingReform = true;
      continue;
    }
    disband(s, g);
  }
  for (const g of s.groups) {
    if (!isHome(g) || g.memberIds.length) continue;
    const missing: string[] = [];
    const picked: Passenger[] = [];
    for (const [prof, need] of Object.entries(s.groupRequirement) as [Profession, number][]) {
      if (!need) continue;
      const sk = PROF_SKILL[prof];
      const pool = freeCandidates(s, reserved)
        .filter((p) => p.profession === prof && !picked.includes(p))
        .sort((a, b) => (sk ? b.skills[sk] - a.skills[sk] : 0));
      const got = pool.slice(0, need);
      picked.push(...got);
      if (got.length < need) missing.push(`${PROFESSION_INFO[prof].label} ×${need - got.length}`);
    }
    g.missing = missing;
    if (missing.length) {
      // 不满足要求时不出勤，也不占用人员
      g.memberIds = [];
      g.leaderId = null;
      setState(s, g, 'grounded', `编组不足：缺少 ${missing.join('、')}`);
      continue;
    }
    for (const p of picked) p.groupId = g.id;
    g.memberIds = picked.map((p) => p.id);
    const leader = [...picked].sort(
      (a, b) => b.skills.piloting + b.skills.survey * 0.5 - (a.skills.piloting + a.skills.survey * 0.5),
    )[0];
    g.leaderId = leader.id;
    g.pendingReform = false;
    setState(s, g, 'docked', '编组完成，待命');
  }
  const names = s.groups.map((g) => `${g.name}${g.missing.length ? `（缺 ${g.missing.join('、')}）` : `（${g.memberIds.length}人）`}`);
  log(s, 'group', `乘客自行编组：${names.join('，')}`);
}

export function isHome(g: Group): boolean {
  return g.state === 'docked' || g.state === 'resting' || g.state === 'grounded';
}

function disband(s: GameState, g: Group): void {
  for (const id of g.memberIds) person(s, id).groupId = null;
  g.memberIds = [];
  g.leaderId = null;
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
