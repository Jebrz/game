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

// ---------------- 召回前后的离站燃料判断（只读推导，不改变状态） ----------------

export interface CargoInbound {
  groupId: number;
  group: string;
  crystal: number; // 扣除分享产出后、预计入库的辉晶（含遗留物资）
  ice: number;
  fuel: number; // 遗留物资中的轨道燃料（回车即入库）
  eta: number; // 现在召回时预计回到列车并卸完货的分钟数（与召回面板同一算法）
  state: string;
  returning: boolean; // 已在返航（不会再继续开采）
}

export interface FuelPlan {
  dest: string;
  need: number;
  have: number; // 已入库的轨道燃料
  queued: number; // 生产队列中尚未完成的轨道燃料（原料已扣）
  queuedDoneIn: number; // 队列中最后一份轨道燃料完成的预计分钟数
  stock: { crystal: number; ice: number }; // 已入库原料
  makeable: number; // 用已入库原料还能加工的单位数（不超过缺口）
  makeMinutes: number; // 把这些加入队列后全部完成的预计分钟数
  inbound: CargoInbound[]; // 外出小组已装上运输机、预计带回的原料
  fromCargo: number; // 加上预计带回的货之后能多做的燃料单位
  short: number; // 车上 + 预计带回仍不够的单位数
  shortRaw: { crystal: number; ice: number }; // 对应还需开采的原料
  readyIn: number | null; // 燃料凑齐的预计分钟数（null = 凑不齐）
  verdict: 'enough' | 'processing' | 'process' | 'cargo' | 'short';
}

/** 下一站燃料：已有 / 队列中 / 车上原料可加工 / 外出小组预计带回 / 仍缺（按当前加工速度与召回耗时估计） */
export function fuelPlan(s: GameState, groupEta: (g: GameState['groups'][number]) => number, speed: number): FuelPlan | null {
  const j = s.journey;
  if (s.phase !== 'planet' || j.current + 1 >= j.nodes.length) return null;
  const need = nextLegFuel(s);
  const recipe = RECIPES.find((r) => r.id === 'trainFuel')!;
  const perC = recipe.inputs.crystal ?? 3;
  const perI = recipe.inputs.ice ?? 1;
  const unitTime = recipe.time;
  const sp = Math.max(0.05, speed);
  const have = s.inventory.trainFuel;
  // 队列：公共订单在前；轨道燃料完成时刻 = 它之前（含）所有工时之和
  let acc = 0;
  let queued = 0;
  let queuedDoneIn = 0;
  let publicWork = 0;
  for (const job of s.queue) {
    acc += job.remaining;
    if (job.orderedBy == null) publicWork = acc;
    if (job.kind === 'recipe' && job.recipeId === 'trainFuel') {
      queued += 1;
      queuedDoneIn = acc / sp;
    }
  }
  const gap0 = Math.max(0, need - have - queued);
  const crystal = s.inventory.crystal;
  const ice = s.inventory.ice;
  const canMake = Math.floor(Math.min(crystal / perC, ice / perI));
  const makeable = Math.min(gap0, canMake);
  const makeMinutes = makeable > 0 ? (publicWork + makeable * unitTime) / sp : 0;
  const inbound: CargoInbound[] = [];
  for (const g of s.groups) {
    if (g.state === 'docked' || g.state === 'resting' || g.state === 'grounded') continue;
    const sh = s.shuttles.find((x) => x.id === g.shuttleId);
    if (!sh) continue;
    const owed = sh.cargo.owed ?? {};
    const c = Math.max(0, (sh.cargo.items.crystal ?? 0) - (owed.crystal ?? 0)) + (g.loot.crystal ?? 0);
    const i = Math.max(0, (sh.cargo.items.ice ?? 0) - (owed.ice ?? 0)) + (g.loot.ice ?? 0);
    const f = g.loot.trainFuel ?? 0;
    if (c <= 0 && i <= 0 && f <= 0) continue;
    inbound.push({ groupId: g.id, group: g.name, crystal: c, ice: i, fuel: f, eta: groupEta(g), state: g.status, returning: g.state === 'returning' || g.state === 'unloading' });
  }
  inbound.sort((a, b) => a.eta - b.eta);
  // 逐个加入预计带回的货，看何时凑齐
  const gap1 = gap0 - makeable;
  let fromCargo = 0;
  let cc = crystal - makeable * perC;
  let ii = ice - makeable * perI;
  let readyIn: number | null = null;
  let lastEta = 0;
  let direct = 0; // 遗留燃料（无需加工）
  for (const b of inbound) {
    if (fromCargo >= gap1) break;
    cc += b.crystal;
    ii += b.ice;
    direct += b.fuel;
    lastEta = b.eta;
    fromCargo = Math.min(gap1, direct + Math.floor(Math.min(cc / perC, ii / perI)));
  }
  const short = Math.max(0, gap1 - fromCargo);
  const made = Math.max(0, fromCargo - direct); // 由带回原料加工的单位
  const shortRaw = { crystal: Math.max(0, Math.ceil(short * perC - Math.max(0, cc - made * perC))), ice: Math.max(0, Math.ceil(short * perI - Math.max(0, ii - made * perI))) };
  let verdict: FuelPlan['verdict'];
  if (have >= need) {
    verdict = 'enough';
    readyIn = 0;
  } else if (gap0 === 0) {
    verdict = 'processing';
    readyIn = queuedDoneIn;
  } else if (gap1 === 0) {
    verdict = 'process';
    readyIn = makeMinutes;
  } else if (short === 0) {
    verdict = 'cargo';
    readyIn = Math.max(lastEta, (publicWork + makeable * unitTime) / sp) + (Math.max(0, fromCargo - direct) * unitTime) / sp;
  } else verdict = 'short';
  return { dest: j.nodes[j.current + 1].name, need, have, queued, queuedDoneIn, stock: { crystal, ice }, makeable, makeMinutes, inbound, fromCargo, short, shortRaw, readyIn, verdict };
}
