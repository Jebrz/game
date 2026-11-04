// 第一阶段目标清单（引导用，从状态推导，不额外存储）

import { TRAIN } from '../config/balance';
import { fmt } from './core';
import { stageComplete } from './actions';
import { ITEM_INFO, RECIPES } from '../config/content';
import type { GameState, RawId } from './types';

export interface Objective {
  id: string;
  label: string;
  done: boolean;
  detail: string;
}

export function objectives(s: GameState): Objective[] {
  const P = s.planet;
  const left = s.phase !== 'planet' && s.phase !== 'intro';
  const found = P?.deposits.filter((d) => d.discoveredBy != null).length ?? 0;
  const outside = s.groups.filter((g) => !['docked', 'resting', 'grounded'].includes(g.state)).length;
  return [
    { id: 'scan', label: '启动列车扫描', done: !!P?.scanned || left, detail: P?.scanProgress! >= 0 && !P?.scanned ? `扫描中 ${P!.scanProgress}/${TRAIN.scanTime} 分` : '车头 → 扫描（或地图面板按钮）' },
    { id: 'explore', label: '小组确认矿点', done: found > 0 || left, detail: `已确认矿点 ${found} 处` },
    { id: 'deliver', label: '收到首批原料', done: s.stats.deliveries > 0, detail: `交付 ${s.stats.deliveries} 次` },
    { id: 'repair', label: '加工维修零件并修复主驱动', done: s.train.driveRepaired, detail: s.train.driveRepairTimer > 0 ? '维修中' : `零件 ${fmt(s.inventory.parts)}/${TRAIN.driveRepairParts - s.train.driveRepair}${shortText(s, rawShortfall(s).parts)}` },
    { id: 'fuel', label: '制造轨道燃料', done: s.inventory.trainFuel >= TRAIN.fuelForDeparture || left, detail: `${fmt(s.inventory.trainFuel)}/${TRAIN.fuelForDeparture}${shortText(s, rawShortfall(s).fuel)}` },
    { id: 'growth', label: '小组完成升级或基因强化', done: s.stats.upgrades + s.stats.genes > 0, detail: `升级 ${s.stats.upgrades} · 强化 ${s.stats.genes}` },
    { id: 'recall', label: '灾变逼近：召回人员与运输机', done: left || (s.recallActive && outside === 0), detail: s.recallActive ? `未归小组 ${outside}` : '灾变面板 → 紧急召回' },
    { id: 'depart', label: '离站航行', done: left, detail: s.phase === 'travel' ? `航行 ${s.travel!.progress}/${s.travel!.duration} 分` : '' },
    { id: 'station', label: '抵达交易站并补给或维修', done: stageComplete(s), detail: s.station.docked ? '交易站面板' : '' },
  ];
}

/** 计算修复主驱动与制造轨道燃料还缺多少原料（已扣除库存与队列中的产出） */
export function rawShortfall(s: GameState): { parts: Partial<Record<RawId, number>>; fuel: Partial<Record<RawId, number>> } {
  const queued = (id: string) => s.queue.filter((j) => j.recipeId === id).length;
  const partsNeed = s.train.driveRepaired ? 0 : Math.max(0, TRAIN.driveRepairParts - s.train.driveRepair - s.inventory.parts - queued('parts'));
  const fuelNeed = Math.max(0, TRAIN.fuelForDeparture - s.inventory.trainFuel - queued('trainFuel'));
  const pi = RECIPES.find((r) => r.id === 'parts')!.inputs;
  const fi = RECIPES.find((r) => r.id === 'trainFuel')!.inputs;
  const iron = Math.max(0, partsNeed * (pi.iron ?? 0) - s.inventory.iron);
  const copper = Math.max(0, partsNeed * (pi.copper ?? 0) - s.inventory.copper);
  const crystal = Math.max(0, fuelNeed * (fi.crystal ?? 0) - s.inventory.crystal);
  const ice = Math.max(0, fuelNeed * (fi.ice ?? 0) - s.inventory.ice);
  const parts: Partial<Record<RawId, number>> = {};
  const fuel: Partial<Record<RawId, number>> = {};
  if (iron > 0) parts.iron = iron;
  if (copper > 0) parts.copper = copper;
  if (crystal > 0) fuel.crystal = crystal;
  if (ice > 0) fuel.ice = ice;
  return { parts, fuel };
}

function shortText(_s: GameState, m: Partial<Record<RawId, number>>): string {
  const e = Object.entries(m);
  return e.length ? ` · 还缺 ${e.map(([k, v]) => `${ITEM_INFO[k as RawId].label} ${fmt(v ?? 0)}`).join('、')}` : '';
}
