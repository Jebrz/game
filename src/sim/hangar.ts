// 运输机制造、机库泊位、换机与配属
//
// 规则摘要：
// - 制造订单与加工配方共用同一条生产队列（s.queue）、同一工程产能与能耗；暂停时不推进。
// - 队列顺序：列车长（公共）订单在前，小组订单在后；各自按下单先后。被插队的小组订单保留已完成工时。
// - 材料在下单时从公共库存扣除并记在订单上（reserved）；取消时原样返还材料与贡献点，已耗能源与工时不退。
// - 泊位占用 = 全部现存运输机（含出勤、备用、列车长座机）+ 队列中的建造订单。
// - 新机完工后为备用：列车长订单 → 公共备用，待列车长分配；小组订单 → 归该组所有，只由该组领取。

import { GROUP_ORDER, HANGAR, SHUTTLE_BUILD, SHUTTLE_MODELS, TRAIN } from '../config/balance';
import { ITEM_INFO, RECIPES } from '../config/content';
import { stage } from './catastrophe';
import { add, consume, costText, fmt, log, missingItems, newId } from './core';
import { decide, isHome, setState } from './groups';
import { cargoCap, cargoUsed } from './shuttles';
import { makeShuttle } from './state';
import type { GameState, Group, ItemId, ProcessJob, Shuttle } from './types';

// ---------------- 查询 ----------------

export interface HangarUsage {
  capacity: number;
  shuttles: number;
  building: number;
  used: number; // shuttles + building
  free: number;
  main: number;
  spare: number;
  captain: number;
  out: number;
}

export function hangarUsage(s: GameState): HangarUsage {
  const building = s.queue.filter((j) => j.kind === 'shuttle').length;
  const shuttles = s.shuttles.length;
  return {
    capacity: s.hangar.capacity,
    shuttles,
    building,
    used: shuttles + building,
    free: s.hangar.capacity - shuttles - building,
    main: s.shuttles.filter((x) => x.assignedTo === 'group').length,
    spare: s.shuttles.filter((x) => x.assignedTo === 'spare').length,
    captain: s.shuttles.filter((x) => x.assignedTo === 'captain').length,
    out: s.shuttles.filter((x) => !x.docked).length,
  };
}

/** 「零件优先保障主驱动」政策下必须保留的维修零件数 */
export function protectedParts(s: GameState): number {
  return s.policies.reservePartsForDrive && !s.train.driveRepaired ? Math.max(0, TRAIN.driveRepairParts - s.train.driveRepair) : 0;
}

/** 材料检查（含零件保护）；返回缺项列表 */
export function materialBlocks(s: GameState, items: Partial<Record<ItemId, number>>): string[] {
  const miss = missingItems(s.inventory, items);
  const parts = items.parts ?? 0;
  const keep = protectedParts(s);
  if (!miss.length && parts > 0 && s.inventory.parts - parts < keep) {
    miss.push(`列车政策：维修零件优先保障主驱动（需保留 ${keep} 件，现有 ${fmt(s.inventory.parts)}）`);
  }
  return miss;
}

export function groupOrder(s: GameState, g: Group): ProcessJob | null {
  return s.queue.find((j) => j.kind === 'shuttle' && j.orderedBy === g.id) ?? null;
}

export function ownedSpares(s: GameState, g: Group): Shuttle[] {
  return s.shuttles.filter((x) => x.assignedTo === 'spare' && x.ownerGroupId === g.id);
}

export function jobLabel(j: ProcessJob): string {
  if (j.kind === 'shuttle') return `制造运输机（${SHUTTLE_MODELS[j.recipeId as keyof typeof SHUTTLE_MODELS].label}）`;
  if (j.kind === 'hangar') return HANGAR.expansions[Number(j.recipeId)]?.label ?? '扩建机库';
  return RECIPES.find((r) => r.id === j.recipeId)?.label ?? j.recipeId;
}

export function jobSource(s: GameState, j: ProcessJob): string {
  if (j.orderedBy == null) return '列车长（公共物资）';
  return `${s.groups.find((g) => g.id === j.orderedBy)?.name ?? '小组'}出资`;
}

export function refundText(j: ProcessJob): string {
  const parts: string[] = [];
  if (Object.keys(j.reserved).length) parts.push(costText(j.reserved));
  if (j.pointsPaid > 0) parts.push(`贡献点 ${fmt(j.pointsPaid)}`);
  return parts.length ? `返还 ${parts.join('、')}` : '无可返还';
}

// ---------------- 队列 ----------------

/** 按优先级插入：公共订单排在全部小组订单之前；小组订单排在末尾 */
export function insertJob(s: GameState, job: ProcessJob): void {
  if (job.orderedBy == null) {
    const firstGroup = s.queue.findIndex((j) => j.orderedBy != null);
    if (firstGroup < 0) s.queue.push(job);
    else s.queue.splice(firstGroup, 0, job);
  } else s.queue.push(job);
}

export const QUEUE_MAX = 12;

/** 取消订单：原样返还预留材料与贡献点（不会多返）；已耗能源与工时不退 */
export function cancelOrder(s: GameState, jobId: number, by: 'captain' | number): string {
  const i = s.queue.findIndex((j) => j.id === jobId);
  if (i < 0) return '订单不存在';
  const j = s.queue[i];
  if (by === 'captain' && j.orderedBy != null) return '小组出资的订单只能由该小组取消';
  if (by !== 'captain' && j.orderedBy !== by) return '不能取消其他来源的订单';
  s.queue.splice(i, 1);
  add(s.inventory, j.reserved);
  if (j.pointsPaid > 0) {
    const g = s.groups.find((x) => x.id === j.orderedBy);
    if (g) {
      g.points += j.pointsPaid;
      g.pointsSpent -= j.pointsPaid;
    }
  }
  if (j.kind !== 'recipe') log(s, 'economy', `取消订单：${jobLabel(j)}（${jobSource(s, j)}），${refundText(j)}。已消耗的能源与工时不退。`);
  return '';
}

/** 列车长把一项公共订单提到队首（被挤下的订单保留已完成工时）；小组订单不能被列车长调整 */
export function canMoveToFront(s: GameState, jobId: number): string {
  const i = s.queue.findIndex((j) => j.id === jobId);
  if (i < 0) return '订单不存在';
  if (i === 0) return '已在队首';
  if (s.queue[i].orderedBy != null) return '小组订单按下单顺序排在公共订单之后';
  return '';
}

export function moveToFront(s: GameState, jobId: number): void {
  if (canMoveToFront(s, jobId)) return;
  const i = s.queue.findIndex((j) => j.id === jobId);
  const [job] = s.queue.splice(i, 1);
  s.queue.unshift(job);
}

// ---------------- 制造订单 ----------------

export function canOrderShuttle(s: GameState, g: Group | null): string[] {
  const r: string[] = [];
  if (s.phase === 'failed' || s.phase === 'intro') r.push('游戏未进行');
  if (s.queue.length >= QUEUE_MAX) r.push(`生产队列已满（${QUEUE_MAX} 项）`);
  const u = hangarUsage(s);
  if (u.free <= 0) r.push(`机库已满（容量 ${u.capacity}，现有运输机 ${u.shuttles}，建造预留 ${u.building}）`);
  if (g) {
    if (groupOrder(s, g)) r.push(`${g.name}已有建造中的订单`);
    if (ownedSpares(s, g).length) r.push(`${g.name}已有待领取/备用的新机`);
    if (g.points < SHUTTLE_BUILD.groupPoints) r.push(`贡献点不足（需 ${SHUTTLE_BUILD.groupPoints}，有 ${fmt(g.points, 1)}）`);
  } else if (s.queue.some((j) => j.kind === 'shuttle' && j.orderedBy == null)) {
    r.push('列车长已有一架建造中的公共运输机（同时只能下一单，防止重复下单）');
  }
  r.push(...materialBlocks(s, SHUTTLE_BUILD.items));
  return r;
}

export function orderShuttle(s: GameState, g: Group | null, why = ''): ProcessJob | null {
  if (canOrderShuttle(s, g).length) return null;
  const items = { ...SHUTTLE_BUILD.items };
  consume(s.inventory, items);
  const pts = g ? SHUTTLE_BUILD.groupPoints : 0;
  if (g) {
    g.points -= pts;
    g.pointsSpent += pts;
  }
  const job: ProcessJob = {
    id: newId(s),
    kind: 'shuttle',
    recipeId: SHUTTLE_BUILD.model,
    remaining: SHUTTLE_BUILD.time,
    total: SHUTTLE_BUILD.time,
    started: false,
    orderedBy: g ? g.id : null,
    reserved: items,
    pointsPaid: pts,
    orderedAt: s.time,
  };
  insertJob(s, job);
  const what = `${SHUTTLE_MODELS[SHUTTLE_BUILD.model].label}运输机`;
  if (g) decide(s, g, `自主订购${what}：支付 ${pts} 贡献点，公共库存扣除 ${costText(items)}，预留 1 个机库泊位。理由：${why}`);
  else log(s, 'economy', `列车长下单制造${what}：公共库存扣除 ${costText(items)}，预留 1 个机库泊位，标准工时 ${SHUTTLE_BUILD.time} 分。`);
  return job;
}

// ---------------- 机库扩建 ----------------

export function nextExpansion(s: GameState) {
  return HANGAR.expansions[s.hangar.level] ?? null;
}

export function canExpandHangar(s: GameState): string[] {
  const r: string[] = [];
  const e = nextExpansion(s);
  if (!e) return ['机库已扩建到本阶段上限'];
  if (s.queue.some((j) => j.kind === 'hangar')) r.push('已有扩建工程在队列中');
  if (s.queue.length >= QUEUE_MAX) r.push(`生产队列已满（${QUEUE_MAX} 项）`);
  r.push(...materialBlocks(s, e.items));
  return r;
}

export function expandHangar(s: GameState): void {
  const e = nextExpansion(s);
  if (!e || canExpandHangar(s).length) return;
  const items = { ...e.items };
  consume(s.inventory, items);
  insertJob(s, {
    id: newId(s),
    kind: 'hangar',
    recipeId: String(s.hangar.level),
    remaining: e.time,
    total: e.time,
    started: false,
    orderedBy: null,
    reserved: items,
    pointsPaid: 0,
    orderedAt: s.time,
  });
  log(s, 'economy', `列车长下单${e.label}：公共库存扣除 ${costText(items)}，标准工时 ${e.time} 分，完工后泊位 +${e.add}。`);
}

// ---------------- 完工 ----------------

/** 队列头部订单完工时调用；完工与出队在同一步内完成，存读档不会重复生成 */
export function completeJob(s: GameState, j: ProcessJob): void {
  if (j.kind === 'hangar') {
    const e = HANGAR.expansions[Number(j.recipeId)];
    s.hangar.capacity += e.add;
    s.hangar.level += 1;
    log(s, 'economy', `${e.label}完工：机库容量 → ${s.hangar.capacity}。`);
    s.toasts.push({ t: s.time, title: '机库扩建完成', text: `机库容量 ${s.hangar.capacity}。` });
    return;
  }
  if (j.kind === 'shuttle') {
    const model = j.recipeId as Shuttle['model'];
    const sh = makeShuttle(s, '', model, 100, 0); // 新机不带燃料，出勤前由列车推进剂补给
    sh.name = `${SHUTTLE_MODELS[model].label} ${sh.serial}`;
    sh.assignedTo = 'spare';
    sh.ownerGroupId = j.orderedBy;
    sh.builtAt = s.time;
    s.shuttles.push(sh);
    const g = s.groups.find((x) => x.id === j.orderedBy);
    if (g) {
      log(s, 'economy', `新机 ${sh.name} 完工，归${g.name}所有，等待该组领取或换机。`);
      s.toasts.push({ t: s.time, title: '新运输机完工', text: `${sh.name}（${g.name}出资），等待${g.name}领取。` });
      g.timer = Math.min(g.timer, 1);
    } else {
      log(s, 'economy', `新机 ${sh.name} 完工，作为公共备用机待分配（运输机面板）。`);
      s.toasts.push({ t: s.time, title: '新运输机完工', text: `${sh.name}：公共备用机，可分配给小组换机或配属列车长。` });
    }
  }
}

// ---------------- 换机与配属 ----------------

/** 换机前提：小组在车上且不在卸货、旧机已停靠且货舱已清空、新机为停靠的备用机 */
/** 该备用机是否已被安排给某个小组换装 */
export function reservedBy(s: GameState, sh: Shuttle): Group | null {
  return s.groups.find((g) => g.pendingSwap === sh.id) ?? null;
}

export function canSwap(s: GameState, g: Group, next: Shuttle, by: 'captain' | 'group'): string {
  const rsv = reservedBy(s, next);
  if (rsv && rsv.id !== g.id) return `已安排给${rsv.name}换装`;
  if (by === 'captain' && next.ownerGroupId != null) return `${next.name}由${s.groups.find((x) => x.id === next.ownerGroupId)?.name ?? '其他小组'}出资，只能由该组领取`;
  if (by === 'group' && next.ownerGroupId != null && next.ownerGroupId !== g.id) return '该机属于其他小组';
  if (next.assignedTo !== 'spare') return `${next.name}不是备用机`;
  if (!next.docked) return `${next.name}不在机库`;
  if (!g.memberIds.length) return `${g.name}编组不足，没有成员可驾驶`;
  if (g.state === 'unloading') return `${g.name}正在卸货`;
  if (!isHome(g)) return `${g.name}尚未返航（${g.status}）`;
  const old = s.shuttles.find((x) => x.id === g.shuttleId);
  if (old) {
    if (!old.docked) return `${old.name}尚未停靠`;
    if (cargoUsed(old) > 0.01 && !old.cargo.settled) return `${old.name}货舱尚未卸空`;
  }
  return '';
}

/** 预约换装：小组出勤/卸货中时，列车长可预约，返航卸货后自动换装（只能预约公共备用机） */
export function canScheduleSwap(s: GameState, g: Group, next: Shuttle): string {
  if (g.pendingSwap === next.id) return '已预约';
  if (next.ownerGroupId != null) return `${next.name}由小组出资，只能由该组领取`;
  if (next.assignedTo !== 'spare') return `${next.name}不是备用机`;
  const rsv = reservedBy(s, next);
  if (rsv) return `已安排给${rsv.name}换装`;
  if (g.pendingSwap != null) return `${g.name}已有预约`;
  if (!g.memberIds.length) return `${g.name}编组不足`;
  if (!canSwap(s, g, next, 'captain')) return '现在即可直接换机';
  return '';
}

export function scheduleSwap(s: GameState, g: Group, next: Shuttle): void {
  if (canScheduleSwap(s, g, next)) return;
  g.pendingSwap = next.id;
  log(s, 'group', `列车长安排${g.name}返航卸货后换装${next.name}（该机已为其保留）。`);
}

export function cancelScheduledSwap(s: GameState, g: Group): void {
  if (g.pendingSwap == null) return;
  const sh = s.shuttles.find((x) => x.id === g.pendingSwap);
  g.pendingSwap = null;
  log(s, 'group', `列车长取消了${g.name}的换装安排${sh ? `（${sh.name}恢复为公共备用）` : ''}。`);
}

/** 小组在列车上时执行已预约的换装；条件不再成立（例如该机已被配属）时取消预约 */
export function applyScheduledSwap(s: GameState, g: Group): boolean {
  if (g.pendingSwap == null) return false;
  const sh = s.shuttles.find((x) => x.id === g.pendingSwap);
  if (!sh || sh.assignedTo !== 'spare' || sh.ownerGroupId != null) {
    g.pendingSwap = null;
    return false;
  }
  if (canSwap(s, g, sh, 'captain')) return false;
  g.pendingSwap = null;
  return swapShuttle(s, g, sh, 'captain', '');
}

/** 执行换机：旧机转为备用（保留归属、升级、耐久与燃料），不销毁 */
export function swapShuttle(s: GameState, g: Group, next: Shuttle, by: 'captain' | 'group', why: string): boolean {
  if (canSwap(s, g, next, by)) return false;
  const old = s.shuttles.find((x) => x.id === g.shuttleId) ?? null;
  if (old) old.assignedTo = 'spare';
  next.assignedTo = 'group';
  g.shuttleId = next.id;
  if (g.state === 'grounded') {
    setState(s, g, 'docked', '已换装运输机，待命');
  }
  g.timer = Math.min(g.timer, 1);
  const txt = old ? `${g.name}换机：${old.name} → ${next.name}，旧机转为备用（保留升级与耐久）` : `${g.name}领取 ${next.name} 作为主运输机`;
  if (by === 'group') decide(s, g, `${txt}。理由：${why}`);
  else log(s, 'group', `列车长安排${txt}。`);
  return true;
}

/** 列车长配属座机：只能使用列车公共运输机，不能征用小组出资的运输机 */
export function canAssignCaptain(s: GameState, shId: number): string {
  const sh = s.shuttles.find((x) => x.id === shId);
  if (!sh) return '无此运输机';
  if (sh.assignedTo === 'captain') return '已配属列车长';
  if (sh.ownerGroupId != null) return `由${s.groups.find((g) => g.id === sh.ownerGroupId)?.name ?? '小组'}出资，列车长无权征用`;
  const rsv = reservedBy(s, sh);
  if (rsv) return `已安排给${rsv.name}换装（可先取消安排）`;
  const g = s.groups.find((x) => x.shuttleId === shId);
  if (g && !isHome(g)) return `${g.name}正在使用（出勤中）`;
  if (g && g.state === 'unloading') return `${g.name}正在卸货`;
  if (!sh.docked) return '运输机不在机库';
  if (cargoUsed(sh) > 0.01 && !sh.cargo.settled) return '货舱尚未卸空';
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

/** 释放座机：优先归还给缺运输机的小组，否则转为公共备用 */
export function releaseShuttle(s: GameState, shId: number): void {
  const sh = s.shuttles.find((x) => x.id === shId);
  if (!sh || sh.assignedTo !== 'captain') return;
  const g = s.groups.find((x) => x.shuttleId == null && x.memberIds.length);
  if (g) {
    sh.assignedTo = 'group';
    g.shuttleId = sh.id;
    g.timer = 1;
    log(s, 'system', `列车长释放${sh.name}，交还${g.name}作为主运输机。`);
  } else {
    sh.assignedTo = 'spare';
    log(s, 'system', `列车长释放${sh.name}，转为公共备用机。`);
  }
}

// ---------------- 小组自主：领取 / 换机 / 订购 ----------------

/** 小组在列车上时调用：先处理本组新机，再判断是否需要订购。返回是否做了决定。 */
export function groupConsiderShuttle(s: GameState, g: Group): boolean {
  if (!g.memberIds.length) return false;
  if (applyScheduledSwap(s, g)) return true;
  const main = s.shuttles.find((x) => x.id === g.shuttleId) ?? null;
  // 1) 领取或换装本组出资的新机
  for (const sp of ownedSpares(s, g)) {
    const why = !main
      ? '本组没有主运输机'
      : main.durability < GROUP_ORDER.lowDurability && sp.durability > main.durability + 20
        ? `主运输机耐久 ${fmt(main.durability)} 偏低`
        : cargoCap(sp) > cargoCap(main) && g.lastCargoFullRatio >= GROUP_ORDER.cargoFullRatio
          ? `货舱经常装满，新机运载量 ${cargoCap(sp)} > ${cargoCap(main)}`
          : '';
    if (!why) continue; // 继续作为本组备用机
    const block = canSwap(s, g, sp, 'group');
    if (block) {
      g.reason = `等待换装新机：${block}`;
      return false;
    }
    return swapShuttle(s, g, sp, 'group', why);
  }
  // 2) 判断是否需要订购（只在星球停靠、没有召回和灾变迫近时）
  if (s.phase !== 'planet' || s.recallActive) return false;
  const st = stage(s);
  if (st === 'edge' || st === 'impact' || st === 'warn') return false;
  if (groupOrder(s, g) || ownedSpares(s, g).length) return false;
  const newCap = SHUTTLE_MODELS[SHUTTLE_BUILD.model].cargo;
  let need = '';
  if (!main) need = '本组没有可用的主运输机，订购备用机';
  else if (main.durability < GROUP_ORDER.lowDurability) need = `主运输机耐久 ${fmt(main.durability)} 偏低，订购新机准备换机`;
  else if (cargoCap(main) < newCap && g.lastCargoFullRatio >= GROUP_ORDER.cargoFullRatio && g.trips >= GROUP_ORDER.minTrips)
    need = `货舱长期装满（运载 ${cargoCap(main)}），订购运载量 ${newCap} 的${SHUTTLE_MODELS[SHUTTLE_BUILD.model].label}准备换机`;
  if (!need) return false;
  if (g.points < SHUTTLE_BUILD.groupPoints + GROUP_ORDER.pointsBuffer) return false; // 预算不足时不订购，也不刷屏
  const blocks = canOrderShuttle(s, g);
  if (blocks.length) {
    const t = `想订购新机（${need}），暂缓：${blocks.join('；')}`;
    if (g.decisions[0]?.text !== t) decide(s, g, t, false);
    return false;
  }
  return !!orderShuttle(s, g, need);
}

export function itemListText(items: Partial<Record<ItemId, number>>): string {
  return (Object.keys(items) as ItemId[]).map((k) => `${ITEM_INFO[k].label} ${items[k]}`).join('、');
}

