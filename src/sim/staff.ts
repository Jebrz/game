// 列车岗位：自动按职业/负责人分配，低技能可低效工作；医疗保留技能门槛。

import { SURVIVAL } from '../config/balance';
import { DEPT_INFO, HEAD_INFO, PROFESSION_INFO } from '../config/content';
import { clamp } from './core';
import type { GameState, Passenger, TrainDept } from './types';

export function deptOf(p: Passenger): TrainDept | null {
  if (p.isCaptain) return null;
  if (p.headRole) return HEAD_INFO[p.headRole].dept ?? 'logistics';
  return PROFESSION_INFO[p.profession].dept;
}

/** 当前在列车上工作的人（不含出勤小组成员、恢复中、遗留人员） */
export function isWorking(s: GameState, p: Passenger): boolean {
  if (p.isCaptain || p.leftBehind || !p.aboard) return false;
  if (p.groupId != null) return false; // 小组成员在车上时休整
  if (p.recoveringUntil > s.time) return false;
  return true;
}

export function personEff(p: Passenger, skill: number): number {
  const fat = p.fatigue > 80 ? 0.6 : p.fatigue > 60 ? 0.8 : 1;
  const hp = p.health < 40 ? 0.5 : p.health < 65 ? 0.8 : 1;
  const mor = 0.8 + p.morale / 250;
  return clamp(skill / 60, 0.3, 1.5) * fat * hp * mor;
}

export interface DeptStat {
  dept: TrainDept;
  workers: Passenger[];
  eff: number;
}

export function deptStats(s: GameState): Record<TrainDept, DeptStat> {
  const out = {} as Record<TrainDept, DeptStat>;
  for (const d of Object.keys(DEPT_INFO) as TrainDept[]) out[d] = { dept: d, workers: [], eff: 0 };
  const wl = SURVIVAL.workloadMult[s.policies.workload];
  for (const p of s.passengers) {
    if (!isWorking(s, p)) continue;
    const d = deptOf(p);
    if (!d) continue;
    const skill = p.skills[DEPT_INFO[d].skill];
    // 医疗岗位保留技能门槛：未达门槛者转入后勤
    if (d === 'medical' && skill < SURVIVAL.medicalSkillThreshold) {
      out.logistics.workers.push(p);
      out.logistics.eff += personEff(p, p.skills.logistics) * wl;
      continue;
    }
    out[d].workers.push(p);
    out[d].eff += personEff(p, skill) * (p.headRole ? 1.2 : 1) * wl;
  }
  return out;
}

/** 加工速度倍率（以 3 名标准工程人员为 1.0） */
export function processingSpeed(s: GameState): number {
  return clamp(deptStats(s).engineering.eff / 3, 0.2, 2.5);
}

export function hasQualifiedMedic(s: GameState): boolean {
  return deptStats(s).medical.workers.length > 0;
}
