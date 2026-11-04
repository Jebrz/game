// 玩家（列车长）操作。每个操作配一个 canX 返回禁用原因（空字符串表示可用）。

import { DEMAND_BONUS, GROUPS, MOOD, RAW_BASE_PRICE, STATION, TRAIN, TIME, SURVIVAL } from '../config/balance';
import { ITEM_INFO, PROFESSION_INFO, RECIPES, RESEARCH } from '../config/content';
import { add, consume, fmt, groupShuttle, log, members, missingItems, newId } from './core';
import { isHome, reformGroups, setState } from './groups';
import { releaseAllOf } from './claims';
import { cargoUsed } from './shuttles';
import type { GameState, ItemId, Policies, Profession, RawId } from './types';

export function startGame(s: GameState): void {
  if (s.phase !== 'intro') return;
  s.phase = 'planet';
  s.paused = false;
  log(s, 'system', '列车长就位。主驱动受损、燃料耗尽——在灰烬潮到来前，必须修好列车并离开。');
}

export function setPaused(s: GameState, v: boolean): void {
  if (s.phase === 'intro' || s.phase === 'failed') return;
  s.paused = v;
}

export function setSpeed(s: GameState, v: number): void {
  if (TIME.speeds.includes(v)) s.speed = v;
}

// ---------- 扫描 ----------
export function canScan(s: GameState): string {
  if (s.phase !== 'planet' || !s.planet) return '不在星球停靠中';
  if (s.planet.scanned) return '已完成扫描';
  if (s.planet.scanProgress >= 0) return '扫描进行中';
  if (s.inventory.energy < TRAIN.scanEnergy) return `能源不足（需 ${TRAIN.scanEnergy} kWh）`;
  return '';
}
export function startScan(s: GameState): void {
  if (canScan(s)) return;
  s.inventory.energy -= TRAIN.scanEnergy;
  s.planet!.scanProgress = 0;
  log(s, 'system', `启动列车探测仪扫描（消耗能源 ${TRAIN.scanEnergy} kWh，约 ${TRAIN.scanTime} 分钟）。`);
}

// ---------- 加工 ----------
export function canEnqueue(s: GameState, recipeId: string, n = 1): string {
  const r = RECIPES.find((x) => x.id === recipeId);
  if (!r) return '无此配方';
  if (s.phase === 'failed') return '游戏已结束';
  if (s.queue.length + n > 12) return '队列已满（最多 12 项）';
  const miss = missingItems(s.inventory, r.inputs, n);
  return miss.length ? `原料不足：${miss.join('、')}` : '';
}
/** 入队时立即扣除原料（预留），取消时退还，杜绝负库存 */
export function enqueue(s: GameState, recipeId: string, n = 1): void {
  if (canEnqueue(s, recipeId, n)) return;
  const r = RECIPES.find((x) => x.id === recipeId)!;
  for (let i = 0; i < n; i++) {
    consume(s.inventory, r.inputs);
    s.queue.push({ id: newId(s), recipeId, remaining: r.time, total: r.time, started: false });
  }
}
export function cancelJob(s: GameState, jobId: number): void {
  const i = s.queue.findIndex((j) => j.id === jobId);
  if (i < 0) return;
  const j = s.queue[i];
  s.queue.splice(i, 1);
  add(s.inventory, RECIPES.find((x) => x.id === j.recipeId)!.inputs);
}

// ---------- 主驱动 ----------
export function canRepairDrive(s: GameState): string {
  const t = s.train;
  if (t.driveRepaired) return '主驱动已修复';
  if (t.driveRepairTimer > 0) return '维修进行中';
  const need = TRAIN.driveRepairParts - t.driveRepair;
  if (s.inventory.parts < need) return `维修零件不足（需 ${need} 件，库存 ${fmt(s.inventory.parts)}）`;
  return '';
}
export function repairDrive(s: GameState): void {
  if (canRepairDrive(s)) return;
  const need = TRAIN.driveRepairParts - s.train.driveRepair;
  s.inventory.parts -= need;
  s.train.driveRepair += need;
  s.train.driveRepairTimer = TRAIN.driveRepairTime;
  log(s, 'system', `工程车厢开始维修主驱动（投入维修零件 ${need} 件）。`);
}

// ---------- 研究 ----------
export function canResearch(s: GameState, id: string): string {
  const p = RESEARCH.find((x) => x.id === id);
  if (!p) return '无此研究';
  if (s.research.done.includes(id)) return '已完成';
  if (s.research.current) return '已有研究进行中';
  const miss = missingItems(s.inventory, p.items);
  return miss.length ? `材料不足：${miss.join('、')}` : '';
}
export function startResearch(s: GameState, id: string): void {
  if (canResearch(s, id)) return;
  const p = RESEARCH.find((x) => x.id === id)!;
  consume(s.inventory, p.items);
  s.research.current = id;
  s.research.progress = 0;
  log(s, 'research', `科研车开始研究：${p.label}（消耗 ${Object.entries(p.items).map(([k, v]) => `${ITEM_INFO[k as ItemId].label} ${v}`).join('、')}）。`);
}

// ---------- 需求奖励 / 政策 / 编组 ----------
export function setDemandBonus(s: GameState, r: RawId, v: number): void {
  const nv = Math.max(DEMAND_BONUS.min, Math.min(DEMAND_BONUS.max, Math.round(v)));
  if (nv === s.demandBonus[r]) return;
  s.demandBonus[r] = nv;
  log(s, 'economy', `需求奖励调整：${ITEM_INFO[r].label} 奖励 +${nv}，新收购价 ${nv + basePriceOf(r)} 点/单位。`);
}
function basePriceOf(r: RawId): number {
  return RAW_BASE_PRICE[r];
}

export function setPolicy<K extends keyof Policies>(s: GameState, k: K, v: Policies[K]): void {
  if (s.policies[k] === v) return;
  s.policies[k] = v;
  log(s, 'system', `列车政策调整：${policyText(k, v)}`);
}
function policyText(k: keyof Policies, v: unknown): string {
  const map: Record<string, string> = {
    lean: '节约',
    normal: '标准',
    rich: '充足',
    light: '轻松',
    overtime: '加班',
    standby: '舱内待机',
    patrol: '车厢巡逻',
  };
  const names: Record<keyof Policies, string> = {
    rations: '配给标准',
    workload: '工作强度',
    reservePartsForDrive: '零件优先保障主驱动',
    basicRadius: '基本任务半径',
    security: '安保机器人部署',
  };
  const val = typeof v === 'boolean' ? (v ? '开' : '关') : typeof v === 'number' ? `${v} km` : map[String(v)] ?? String(v);
  return `${names[k]} → ${val}`;
}

export function setRequirement(s: GameState, prof: Profession, n: number): void {
  const v = Math.max(0, Math.min(GROUPS.maxRequirementPerProfession, n));
  const next = { ...s.groupRequirement, [prof]: v };
  if (Object.values(next).reduce((a, b) => a + (b ?? 0), 0) < 2) return;
  s.groupRequirement = next;
  log(s, 'group', `列车长调整出勤小组职业要求：${PROFESSION_INFO[prof].label} ${v} 人。`);
  reformGroups(s);
}

// ---------- 运输机配属 ----------
export function canAssignCaptain(s: GameState, shId: number): string {
  const sh = s.shuttles.find((x) => x.id === shId);
  if (!sh) return '无此运输机';
  if (sh.assignedTo === 'captain') return '已配属列车长';
  const g = s.groups.find((x) => x.shuttleId === shId);
  if (g && !isHome(g)) return `${g.name}正在使用（出勤中）`;
  return '';
}
export function assignCaptain(s: GameState, shId: number): void {
  if (canAssignCaptain(s, shId)) return;
  const sh = s.shuttles.find((x) => x.id === shId)!;
  const g = s.groups.find((x) => x.shuttleId === shId);
  if (g) {
    g.shuttleId = null;
    setState(s, g, 'grounded', '运输机已被列车长配属，无运输机可用');
    g.timer = 1;
  }
  sh.assignedTo = 'captain';
  log(s, 'system', `列车长将${sh.name}配属为座机${g ? `（${g.name}因此暂停出勤）` : ''}。亲自探索玩法为后续内容。`);
}
export function releaseShuttle(s: GameState, shId: number): void {
  const sh = s.shuttles.find((x) => x.id === shId);
  if (!sh || sh.assignedTo !== 'captain') return;
  sh.assignedTo = 'group';
  const g = s.groups.find((x) => x.shuttleId == null);
  if (g) {
    g.shuttleId = sh.id;
    g.timer = 1;
  }
  log(s, 'system', `列车长释放${sh.name}，交给${g ? g.name : '小组'}使用。`);
}

// ---------- 召回 / 离站 ----------
export function setRecall(s: GameState, on: boolean): void {
  if (s.phase !== 'planet' || s.recallActive === on) return;
  s.recallActive = on;
  log(s, on ? 'danger' : 'system', on ? '列车长发出紧急召回令：所有小组立即返航。' : '列车长解除召回令，小组恢复自主行动。');
}

export function outsideGroups(s: GameState) {
  return s.groups.filter((g) => !isHome(g));
}

export function canDepart(s: GameState): string {
  if (s.phase !== 'planet') return '不在星球停靠中';
  const r: string[] = [];
  if (!s.train.driveRepaired) r.push(s.train.driveRepairTimer > 0 ? '主驱动维修中' : '主驱动未修复');
  if (s.inventory.trainFuel < TRAIN.fuelForDeparture) r.push(`轨道燃料不足（需 ${TRAIN.fuelForDeparture}，有 ${fmt(s.inventory.trainFuel)}）`);
  const out = outsideGroups(s);
  if (out.length) r.push(`尚有小组未归：${out.map((g) => `${g.name}（${g.status}）`).join('、')}`);
  return r.join('；');
}
/** 强行离站：仅在机械条件满足、但有人员未归时可用，属于严重行为 */
export function canForceDepart(s: GameState): string {
  if (s.phase !== 'planet') return '不在星球停靠中';
  if (!s.train.driveRepaired) return '主驱动未修复';
  if (s.inventory.trainFuel < TRAIN.fuelForDeparture) return '轨道燃料不足';
  if (!outsideGroups(s).length) return '所有人员已归队，无需强行离站';
  return '';
}

export function depart(s: GameState, force = false): void {
  if (force ? canForceDepart(s) : canDepart(s)) return;
  s.inventory.trainFuel -= TRAIN.fuelForDeparture;
  const left: string[] = [];
  for (const g of outsideGroups(s)) {
    for (const p of members(s, g)) {
      p.leftBehind = true;
      p.groupId = null;
      left.push(p.name);
    }
    const sh = groupShuttle(s, g);
    if (sh) s.shuttles = s.shuttles.filter((x) => x.id !== sh.id);
    g.memberIds = [];
    g.shuttleId = null;
    g.target = null;
    setState(s, g, 'grounded', '成员被遗留在星球上');
  }
  if (left.length) {
    s.stats.leftBehind += left.length;
    for (const p of s.passengers) if (!p.leftBehind && !p.isCaptain) p.hostility = Math.min(100, p.hostility + MOOD.leftBehindHostility);
    s.boosts.push({ label: '同伴被遗弃', until: s.time + 2880, morale: -12 });
    log(s, 'danger', `列车强行离站，遗留 ${left.length} 人：${left.join('、')}。乘客敌意急剧上升。`);
  }
  for (const g of s.groups) {
    releaseAllOf(s, g.id);
    if (g.memberIds.length) setState(s, g, 'docked', '列车航行中，随车待命');
  }
  s.recallActive = false;
  s.phase = 'travel';
  s.travel = { progress: 0, duration: TRAIN.travelDuration };
  s.stats.departedAt = s.time;
  log(s, 'system', `列车离开${s.planet!.name}，沿古老轨道驶向${STATION.name}（预计 ${TRAIN.travelDuration / 60} 小时）。`);
  s.toasts.push({ t: s.time, title: '离站', text: `列车驶向${STATION.name}。` });
}

// ---------- 交易站 ----------
export function canBuy(s: GameState, item: ItemId, qty: number): string {
  if (!s.station.docked) return '未停靠交易站';
  const price = STATION.buy[item];
  if (price == null) return '交易站不出售此物';
  const cost = price * qty;
  if (s.credits + 1e-9 < cost) return `星币不足（需 ${fmt(cost, 1)}，有 ${fmt(s.credits, 1)}）`;
  if (item === 'oxygen' && s.inventory.oxygen + qty > SURVIVAL.oxygenCap) return '氧气舱容量不足';
  return '';
}
export function buy(s: GameState, item: ItemId, qty: number): void {
  if (canBuy(s, item, qty)) return;
  const cost = STATION.buy[item]! * qty;
  s.credits -= cost;
  s.inventory[item] += qty;
  s.station.trades++;
  log(s, 'station', `购入 ${ITEM_INFO[item].label} ${qty}，花费 ${fmt(cost, 1)} 星币。`);
}
export function canSell(s: GameState, item: ItemId, qty: number): string {
  if (!s.station.docked) return '未停靠交易站';
  if (STATION.sell[item] == null) return '交易站不收购此物';
  if (s.inventory[item] + 1e-9 < qty) return `库存不足（有 ${fmt(s.inventory[item])}）`;
  return '';
}
export function sell(s: GameState, item: ItemId, qty: number): void {
  if (canSell(s, item, qty)) return;
  const gain = STATION.sell[item]! * qty;
  s.inventory[item] -= qty;
  s.credits += gain;
  s.station.trades++;
  log(s, 'station', `售出 ${ITEM_INFO[item].label} ${qty}，获得 ${fmt(gain, 1)} 星币。`);
}
export function hullRepairCost(s: GameState, pts: number): number {
  return Math.min(pts, 100 - s.train.hull) * STATION.hullRepairPrice;
}
export function canRepairHull(s: GameState, pts: number): string {
  if (!s.station.docked) return '未停靠交易站';
  if (s.train.hull >= 100) return '车体完好';
  const c = hullRepairCost(s, pts);
  if (s.credits + 1e-9 < c) return `星币不足（需 ${fmt(c, 1)}）`;
  return '';
}
export function repairHull(s: GameState, pts: number): void {
  if (canRepairHull(s, pts)) return;
  const real = Math.min(pts, 100 - s.train.hull);
  const c = hullRepairCost(s, pts);
  s.credits -= c;
  s.train.hull += real;
  s.station.repairs++;
  log(s, 'station', `船坞维修车体 +${fmt(real)}，花费 ${fmt(c, 1)} 星币。车体 ${fmt(s.train.hull)}%。`);
}
export function canRepairShuttle(s: GameState, shId: number): string {
  if (!s.station.docked) return '未停靠交易站';
  const sh = s.shuttles.find((x) => x.id === shId);
  if (!sh) return '无此运输机';
  if (sh.durability >= 100) return '耐久已满';
  const c = (100 - sh.durability) * STATION.shuttleRepairPrice;
  if (s.credits + 1e-9 < c) return `星币不足（需 ${fmt(c, 1)}）`;
  return '';
}
export function repairShuttle(s: GameState, shId: number): void {
  if (canRepairShuttle(s, shId)) return;
  const sh = s.shuttles.find((x) => x.id === shId)!;
  const c = (100 - sh.durability) * STATION.shuttleRepairPrice;
  s.credits -= c;
  sh.durability = 100;
  s.station.repairs++;
  log(s, 'station', `船坞维修${sh.name}至满耐久，花费 ${fmt(c, 1)} 星币。`);
}

export function stageComplete(s: GameState): boolean {
  return s.station.docked && (s.station.trades > 0 || s.station.repairs > 0);
}

export function cargoTotal(s: GameState): number {
  return s.shuttles.reduce((a, sh) => a + cargoUsed(sh), 0);
}

