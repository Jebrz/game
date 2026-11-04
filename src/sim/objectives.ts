// 目标清单（引导用，从状态推导，不额外存储）：当前星球目标 + 整段旅程目标

import { TRAIN } from '../config/balance';
import { fmt } from './core';
import { stageComplete } from './actions';
import { ITEM_INFO, RECIPES } from '../config/content';
import type { GameState, PlanetState, RawId } from './types';
import { legFuel } from './world';

export interface Objective {
  id: string;
  label: string;
  done: boolean;
  detail: string;
  optional?: boolean;
}

/** 下一站（相邻节点）的燃料需求；不在星球时为 0 */
export function nextLegFuel(s: GameState): number {
  const j = s.journey;
  if (s.phase !== 'planet' || j.current + 1 >= j.nodes.length) return 0;
  return legFuel(j.nodes[j.current + 1].pos - j.nodes[j.current].pos);
}

/** 当前星球的矿产调查状态：区分「尚未发现矿点」与「调查后确认无可采矿产」 */
export function mineralStatus(P: PlanetState): string {
  if (!P.scanned) return '尚未扫描';
  const found = P.deposits.filter((d) => d.discoveredBy != null);
  const resSigns = P.signs.filter((x) => x.kind !== 'natives');
  const unexplored = resSigns.filter((x) => !x.explored);
  if (found.length) return `已确认矿点 ${found.length} 处${unexplored.length ? `，另有 ${unexplored.length} 处迹象未调查` : ''}`;
  if (unexplored.length) return `尚未发现矿点（${unexplored.length} 处迹象待调查${unexplored.some((x) => x.restricted) ? '，部分位于禁区' : ''}）`;
  return '调查后确认：无可采矿产';
}

/** 当前星球目标 */
export function planetObjectives(s: GameState): Objective[] {
  const P = s.planet;
  if (s.phase !== 'planet' || !P) return [];
  const first = s.journey.current === 0;
  const explored = P.signs.filter((x) => x.explored).length;
  const outside = s.groups.filter((g) => !['docked', 'resting', 'grounded'].includes(g.state)).length;
  const need = nextLegFuel(s);
  const out: Objective[] = [
    { id: 'scan', label: `扫描${P.name}`, done: P.scanned, detail: P.scanProgress >= 0 && !P.scanned ? `扫描中 ${P.scanProgress}/${TRAIN.scanTime} 分` : '「列车」面板 → 启动扫描' },
    { id: 'explore', label: '小组调查迹象', done: P.scanned && explored > 0, detail: `${mineralStatus(P)}；已调查 ${explored}/${P.signs.length}` },
  ];
  if (first) {
    out.push(
      { id: 'deliver', label: '收到首批原料', done: P.deliveries > 0, detail: `本星交付 ${P.deliveries} 次（只计实际返航结算）` },
      { id: 'repair', label: '加工维修零件并修复主驱动', done: s.train.driveRepaired, detail: s.train.driveRepairTimer > 0 ? '维修中' : `零件 ${fmt(s.inventory.parts)}/${TRAIN.driveRepairParts - s.train.driveRepair}${shortText(s, rawShortfall(s).parts)}` },
    );
  }
  if (!first && P.deposits.some((d) => d.discoveredBy != null && d.zone !== 'hostile')) {
    out.push({ id: 'deliver', label: '本星首批原料交付', done: P.deliveries > 0, detail: `本星交付 ${P.deliveries} 次`, optional: true });
  }
  if (P.natives.kind === 'friendly' && P.natives.detected) out.push({ id: 'natives', label: `与${P.natives.name}建立联系`, done: P.natives.contacted, detail: '小组调查「人工信号」后可交易、协商采矿许可（「航线」面板）', optional: true });
  if (P.natives.kind === 'hostile' && P.natives.detected) out.push({ id: 'hostile', label: '避开敌对禁区', done: true, detail: `${P.natives.name}拒绝接近，禁区内矿点不可作业`, optional: true });
  if (first) out.push({ id: 'build', label: '尝试制造一架运输机', done: s.shuttles.some((x) => x.builtAt >= 0), detail: '「运输机」面板：公共下单，完工后分配给小组换机', optional: true });
  out.push(
    { id: 'fuel', label: '备足前往下一站的轨道燃料', done: s.inventory.trainFuel >= need, detail: `${fmt(s.inventory.trainFuel)}/${need}${shortText(s, rawShortfall(s).fuel)}（跳站需要更多，见「航线」）` },
    { id: 'leave', label: '灾变逼近前召回并离站', done: false, detail: s.recallActive ? `召回中，未归小组 ${outside}` : '「航线」面板选择下一站' },
  );
  return out;
}

/** 整段旅程目标 */
export function journeyObjectives(s: GameState): Objective[] {
  const nodes = s.journey.nodes;
  const planets = nodes.filter((n) => n.kind === 'planet');
  const passed = planets.filter((n) => n.status === 'visited' || n.status === 'skipped').length;
  return [
    { id: 'drive', label: '修复主驱动（一次性）', done: s.train.driveRepaired, detail: '' },
    { id: 'deliveries', label: '全程原料交付', done: s.stats.deliveries > 0, detail: `全程 ${s.stats.deliveries} 次，各星：${nodes.filter((n) => n.kind === 'planet').map((n) => `${n.name.slice(0, 2)} ${(n.planet ?? (n.status === 'current' ? s.planet : null))?.deliveries ?? 0}`).join('、')}` },
    { id: 'growth', label: '小组完成升级或基因强化', done: s.stats.upgrades + s.stats.genes > 0, detail: `升级 ${s.stats.upgrades} · 强化 ${s.stats.genes}` },
    { id: 'route', label: `沿航线经过 ${planets.length} 颗星球（可跳过）`, done: passed >= planets.length, detail: `${nodes.map((n) => `${n.name}${n.status === 'current' ? '◀' : n.status === 'visited' ? '✔' : n.status === 'skipped' ? '↷' : ''}`).join(' → ')}` },
    { id: 'station', label: '抵达交易站并补给或维修', done: stageComplete(s), detail: s.station.docked ? '「交易站」面板' : s.phase === 'travel' && s.travel ? `航行 ${s.travel.progress}/${s.travel.duration} 分` : '' },
  ];
}

/** 兼容：合并列表 */
export function objectives(s: GameState): Objective[] {
  return [...planetObjectives(s), ...journeyObjectives(s)];
}

/** 计算修复主驱动与制造轨道燃料还缺多少原料（已扣除库存与队列中的产出） */
export function rawShortfall(s: GameState): { parts: Partial<Record<RawId, number>>; fuel: Partial<Record<RawId, number>> } {
  const queued = (id: string) => s.queue.filter((j) => j.recipeId === id).length;
  const partsNeed = s.train.driveRepaired ? 0 : Math.max(0, TRAIN.driveRepairParts - s.train.driveRepair - s.inventory.parts - queued('parts'));
  const fuelNeed = Math.max(0, nextLegFuel(s) - s.inventory.trainFuel - queued('trainFuel'));
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
