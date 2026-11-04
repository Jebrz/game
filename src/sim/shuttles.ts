// 运输机性能计算

import { SHUTTLE_MAINT, SHUTTLE_MODELS, SHUTTLE_UPGRADES } from '../config/balance';
import { RESOURCE_MINE_MULT } from '../config/content';
import { clamp, members } from './core';
import type { GameState, Group, RawId, Shuttle } from './types';

export function cargoCap(sh: Shuttle): number {
  let c = SHUTTLE_MODELS[sh.model].cargo;
  for (const u of sh.upgrades) c += SHUTTLE_UPGRADES.find((x) => x.id === u)?.cargoBonus ?? 0;
  return c;
}

export function cargoUsed(sh: Shuttle): number {
  return Object.values(sh.cargo.items).reduce((a, b) => a + (b ?? 0), 0);
}

export function speed(sh: Shuttle): number {
  const base = SHUTTLE_MODELS[sh.model].speed;
  return sh.durability < SHUTTLE_MAINT.slowBelow ? base * 0.85 : base;
}

export function fuelPerKm(sh: Shuttle): number {
  return SHUTTLE_MODELS[sh.model].fuelPerKm;
}

export function tank(sh: Shuttle): number {
  return SHUTTLE_MODELS[sh.model].tank;
}

/** 小组采矿效率乘数：成员采掘技能、疲劳、健康 */
export function crewMiningFactor(s: GameState, g: Group): number {
  const ms = members(s, g);
  if (!ms.length) return 0;
  let sum = 0;
  for (const p of ms) {
    const fat = p.fatigue > 70 ? 0.7 : p.fatigue > 45 ? 0.88 : 1;
    const hp = p.health < 50 ? 0.75 : 1;
    sum += clamp(p.skills.mining / 50, 0.35, 1.8) * fat * hp;
  }
  return clamp(sum / ms.length, 0.3, 1.8);
}

export function mineRate(s: GameState, g: Group, sh: Shuttle, res: RawId): number {
  let r = SHUTTLE_MODELS[sh.model].mineRate;
  for (const u of sh.upgrades) r *= SHUTTLE_UPGRADES.find((x) => x.id === u)?.mineRateMult ?? 1;
  return r * crewMiningFactor(s, g) * RESOURCE_MINE_MULT[res];
}

export function exploreTime(s: GameState, g: Group, sh: Shuttle): number {
  const ms = members(s, g);
  const best = Math.max(10, ...ms.map((p) => p.skills.survey));
  return Math.round(SHUTTLE_MODELS[sh.model].exploreTime * clamp(60 / best, 0.6, 1.8));
}
