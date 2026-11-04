// 基础生存：食物、氧气、能源、疲劳、健康；情绪（士气 / 失望 / 敌意）

import { GENE, MOOD, ROBOTS, SURVIVAL } from '../config/balance';
import { clamp, log, onBoardPeople } from './core';
import { stage } from './catastrophe';
import { deptStats } from './staff';
import type { GameState, MoodFactor, Passenger } from './types';

/** 每分钟：资源流 */
export function tickResources(s: GameState): void {
  const inv = s.inventory;
  const people = onBoardPeople(s).length;
  const ds = deptStats(s);
  const medActive = ds.medical.workers.length > 0 && s.passengers.some((p) => !p.leftBehind && p.health < 100);
  // 能源
  let energy = SURVIVAL.reactorEnergyHour - SURVIVAL.baseEnergyHour - SURVIVAL.lifeSupportEnergyHour;
  if (medActive) energy -= SURVIVAL.medicalEnergyHour;
  energy -= s.robots.count * (SURVIVAL.robotEnergyHour + (s.policies.security === 'patrol' ? SURVIVAL.robotPatrolExtra : 0));
  inv.energy = clamp(inv.energy + energy / 60, 0, SURVIVAL.energyCap);
  // 氧气
  const ls = inv.energy > 0 ? SURVIVAL.lifeSupportOxygenHour * s.train.lifeSupport : 0;
  inv.oxygen = clamp(inv.oxygen + (ls - people * SURVIVAL.oxygenPerPersonHour) / 60, 0, SURVIVAL.oxygenCap);
  // 食物（后勤车水培）
  const foodProd = ds.logistics.eff * SURVIVAL.foodPerLogisticsEffHour;
  const foodUse = people * SURVIVAL.foodPerPersonHour * SURVIVAL.rationMult[s.policies.rations];
  inv.food = Math.max(0, inv.food + (foodProd - foodUse) / 60);
}

/** 资源每小时净变化（UI 展示） */
export function resourceRates(s: GameState): { food: number; oxygen: number; energy: number } {
  const people = onBoardPeople(s).length;
  const ds = deptStats(s);
  let energy = SURVIVAL.reactorEnergyHour - SURVIVAL.baseEnergyHour - SURVIVAL.lifeSupportEnergyHour;
  energy -= s.robots.count * (SURVIVAL.robotEnergyHour + (s.policies.security === 'patrol' ? SURVIVAL.robotPatrolExtra : 0));
  if (s.queue.length) energy -= SURVIVAL.processingEnergyHour;
  if (s.research.current) energy -= SURVIVAL.researchEnergyHour;
  return {
    food: ds.logistics.eff * SURVIVAL.foodPerLogisticsEffHour - people * SURVIVAL.foodPerPersonHour * SURVIVAL.rationMult[s.policies.rations],
    oxygen: SURVIVAL.lifeSupportOxygenHour * s.train.lifeSupport - people * SURVIVAL.oxygenPerPersonHour,
    energy,
  };
}

/** 每小时：疲劳、健康 */
export function tickPeopleHourly(s: GameState): void {
  const ds = deptStats(s);
  const medEff = ds.medical.eff;
  const working = new Set(Object.values(ds).flatMap((d) => d.workers.map((p) => p.id)));
  for (const p of s.passengers) {
    if (p.leftBehind) continue;
    const geneFat = p.genes.includes(GENE.id) ? 0.8 : 1;
    if (!p.aboard) p.fatigue += SURVIVAL.fieldFatigueHour * geneFat;
    else if (working.has(p.id)) p.fatigue += SURVIVAL.fatigueHour[s.policies.workload] * (SURVIVAL.fatigueHour[s.policies.workload] > 0 ? geneFat : 1);
    else p.fatigue += SURVIVAL.restFatigueHour;
    p.fatigue = clamp(p.fatigue, 0, 100);
    let dh = 0;
    if (s.inventory.food <= 0) dh += SURVIVAL.starvingHealthHour;
    if (s.inventory.oxygen <= 0) dh += SURVIVAL.suffocatingHealthHour;
    if (p.fatigue > 85) dh += SURVIVAL.exhaustedHealthHour;
    if (p.aboard && medEff > 0 && s.inventory.energy > 0 && dh >= 0) dh += SURVIVAL.healHour * Math.min(1, medEff / 1.5);
    p.health = clamp(p.health + dh, SURVIVAL.healthFloor, 100);
    if (p.recoveringUntil >= 0 && p.recoveringUntil <= s.time) {
      p.recoveringUntil = -1;
      log(s, 'research', `${p.name}完成基因强化恢复。`);
    }
  }
}

/** 当前影响情绪的因素（全体） */
export function moodFactors(s: GameState): MoodFactor[] {
  const f: MoodFactor[] = [];
  const pol = s.policies;
  if (pol.rations === 'lean') f.push({ label: '配给节约', morale: -8, disappointment: 8 });
  if (pol.rations === 'rich') f.push({ label: '配给充足', morale: 6, disappointment: -5 });
  if (pol.workload === 'overtime') f.push({ label: '加班工作', morale: -6, disappointment: 9 });
  if (pol.workload === 'light') f.push({ label: '轻松工作', morale: 4, disappointment: -3 });
  if (pol.security === 'patrol') f.push({ label: '机器人车厢巡逻（被监视感）', morale: -3, disappointment: 5 });
  if (s.inventory.food <= 0) f.push({ label: '食物断绝', morale: -20, disappointment: 22 });
  else if (s.inventory.food < 15) f.push({ label: '食物紧张', morale: -6, disappointment: 6 });
  if (s.inventory.oxygen < 100) f.push({ label: '氧气告急', morale: -15, disappointment: 15 });
  const st = stage(s);
  if (st === 'warn' || st === 'edge') f.push({ label: '灾变逼近的焦虑', morale: -5, disappointment: 0 });
  if (st === 'impact') f.push({ label: '灾变冲击', morale: -12, disappointment: 8 });
  for (const b of s.boosts) if (b.until > s.time) f.push({ label: b.label, morale: b.morale, disappointment: b.morale < 0 ? -b.morale : -b.morale / 2 });
  return f;
}

/** 每小时：个人情绪向目标移动；敌意由持续高失望累积，降低失望不会瞬间清除敌意 */
export function tickMoodHourly(s: GameState): void {
  const f = moodFactors(s);
  s.moodFactors = f;
  s.boosts = s.boosts.filter((b) => b.until > s.time);
  const tm = f.reduce((a, x) => a + x.morale, 0);
  const td = f.reduce((a, x) => a + x.disappointment, 0);
  for (const p of moodPeople(s)) {
    let pm = tm;
    if (p.fatigue > 70) pm -= 8;
    if (p.health < 50) pm -= 8;
    const targetM = clamp(MOOD.baseMorale + pm * p.sensitivity, 0, 100);
    const targetD = clamp(MOOD.baseDisappointment + td * p.sensitivity + (p.fatigue > 80 ? 5 : 0), 0, 100);
    p.morale += clamp(targetM - p.morale, -MOOD.moveRate, MOOD.moveRate);
    p.disappointment += clamp(targetD - p.disappointment, -MOOD.moveRate, MOOD.moveRate);
    if (p.disappointment > MOOD.hostilityThreshold) p.hostility += (p.disappointment - MOOD.hostilityThreshold) * MOOD.hostilityFromDisappointment;
    else if (p.disappointment < MOOD.hostilityDecayBelow) p.hostility -= MOOD.hostilityDecayHour;
    p.hostility = clamp(p.hostility, 0, 100);
  }
}

/** 参与情绪统计的人：每人权重相同，不含列车长与遗留人员 */
export function moodPeople(s: GameState): Passenger[] {
  return s.passengers.filter((p) => !p.isCaptain && !p.leftBehind);
}

export function moodSummary(s: GameState): { morale: number; disappointment: number; hostility: number } {
  const ps = moodPeople(s);
  const n = Math.max(1, ps.length);
  return {
    morale: ps.reduce((a, p) => a + p.morale, 0) / n,
    disappointment: ps.reduce((a, p) => a + p.disappointment, 0) / n,
    hostility: ps.reduce((a, p) => a + p.hostility, 0) / n,
  };
}

export function deterrence(s: GameState): number {
  return Math.round(s.robots.count * ROBOTS.deterrencePer * (s.robots.condition / 100) * (s.policies.security === 'patrol' ? 1.5 : 1));
}
