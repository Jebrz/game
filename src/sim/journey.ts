// 航线与航行：选择下一站（可跳过星球）、燃料按航程计算、离站/航行/抵达。
// 星球地图同一时刻只由一处持有：当前星球在 s.planet，其余在各自航线节点中，避免存档重复或刷新。

import { MOOD, ROUTE, STATION } from '../config/balance';
import { predictAtArrival } from './catastrophe';
import { releaseAllOf } from './claims';
import { fmt, fmtTime, groupShuttle, log, members } from './core';
import { isHome, setState } from './groups';
import type { GameState, RouteNode } from './types';
import { legFuel } from './world';

export function currentNode(s: GameState): RouteNode {
  return s.journey.nodes[s.journey.current];
}

export function outsideGroups(s: GameState) {
  return s.groups.filter((g) => !isHome(g));
}

export interface LegOption {
  index: number;
  node: RouteNode;
  dist: number;
  fuel: number;
  travel: number;
  skips: string[];
  predict: ReturnType<typeof predictAtArrival>;
  block: string; // 不可前往的原因（空表示可前往）
}

/** 当前位置可前往的所有后续节点（可跳过中间星球） */
export function legOptions(s: GameState): LegOption[] {
  const cur = s.journey.current;
  const out: LegOption[] = [];
  for (let i = cur + 1; i < s.journey.nodes.length; i++) {
    const node = s.journey.nodes[i];
    const dist = node.pos - s.journey.nodes[cur].pos;
    const fuel = legFuel(dist);
    out.push({
      index: i,
      node,
      dist,
      fuel,
      travel: Math.round(dist / ROUTE.trainSpeed),
      skips: s.journey.nodes.slice(cur + 1, i).map((n) => n.name),
      predict: predictAtArrival(s, node.pos),
      block: canDepartTo(s, i),
    });
  }
  return out;
}

export function canDepartTo(s: GameState, index: number, force = false): string {
  if (s.phase !== 'planet') return '不在星球停靠中';
  const cur = s.journey.current;
  if (index <= cur || index >= s.journey.nodes.length) return '无效目的地';
  const r: string[] = [];
  if (!s.train.driveRepaired) r.push(s.train.driveRepairTimer > 0 ? '主驱动维修中' : '主驱动未修复');
  const need = legFuel(s.journey.nodes[index].pos - s.journey.nodes[cur].pos);
  if (s.inventory.trainFuel < need) r.push(`轨道燃料不足（需 ${need}，有 ${fmt(s.inventory.trainFuel)}，缺 ${fmt(need - s.inventory.trainFuel)}）`);
  const out = outsideGroups(s);
  if (force) {
    if (!out.length) r.push('所有人员已归队，无需强行离站');
  } else if (out.length) r.push(`尚有小组未归：${out.map((g) => `${g.name}（${g.status}）`).join('、')}`);
  return r.join('；');
}

/** 兼容旧接口：前往下一节点 */
export function canDepart(s: GameState): string {
  return canDepartTo(s, s.journey.current + 1);
}
export function canForceDepart(s: GameState): string {
  return canDepartTo(s, s.journey.current + 1, true);
}
export function depart(s: GameState, force = false): void {
  departTo(s, s.journey.current + 1, force);
}

export function departTo(s: GameState, index: number, force = false): void {
  if (canDepartTo(s, index, force)) return;
  const cur = s.journey.current;
  const from = s.journey.nodes[cur];
  const to = s.journey.nodes[index];
  const dist = to.pos - from.pos;
  const fuel = legFuel(dist);
  s.inventory.trainFuel -= fuel;
  // 强行离站：遗留未归人员与其运输机（严重行为）
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
    for (const p of members(s, g)) p.aboard = true;
    if (g.memberIds.length) {
      g.target = null;
      setState(s, g, 'docked', '列车航行中，随车待命');
    }
  }
  // 访问记录，并把当前星球地图交还航线节点保存
  const P = s.planet;
  if (P) {
    const found = P.deposits.filter((d) => d.discoveredBy != null).length;
    const explored = P.signs.filter((x) => x.explored).length;
    from.notes.push(`停留 ${fmtTime(s.time - Math.max(0, from.arrivedAt))}；调查迹象 ${explored}/${P.signs.length}，确认矿点 ${found} 处${P.natives.contacted ? `；与${P.natives.name}建立联系` : ''}`);
    from.planet = P;
    s.planet = null;
  }
  from.status = 'visited';
  from.departedAt = s.time;
  for (let i = cur + 1; i < index; i++) {
    s.journey.nodes[i].status = 'skipped';
    s.journey.nodes[i].notes.push('未停靠（跳过）');
  }
  s.recallActive = false;
  s.catastrophe.arrived = false;
  s.phase = 'travel';
  s.journey.dest = index;
  s.travel = { progress: 0, duration: Math.round(dist / ROUTE.trainSpeed), from: cur, to: index, fuel };
  if (s.stats.departedAt < 0) s.stats.departedAt = s.time;
  const skipped = index - cur - 1;
  log(s, 'system', `列车离开${from.name}，驶向${to.name}（${fmt(dist)} Mm，约 ${fmtTime(s.travel.duration)}，消耗轨道燃料 ${fuel}${skipped ? `，跳过 ${skipped} 颗星球` : ''}）。`);
  s.toasts.push({ t: s.time, title: '离站', text: `列车驶向${to.name}，约 ${fmtTime(s.travel.duration)}。` });
}

/** 航行中每分钟推进 */
export function tickJourney(s: GameState): void {
  const t = s.travel;
  if (!t) return;
  t.progress += 1;
  const from = s.journey.nodes[t.from];
  const to = s.journey.nodes[t.to];
  s.journey.pos = Math.min(to.pos, from.pos + t.progress * ROUTE.trainSpeed);
  if (t.progress >= t.duration) arrive(s, t.to);
}

function arrive(s: GameState, index: number): void {
  const node = s.journey.nodes[index];
  s.journey.current = index;
  s.journey.dest = null;
  s.journey.pos = node.pos;
  s.travel = null;
  node.status = 'current';
  node.arrivedAt = s.time;
  if (node.kind === 'station') {
    arriveStation(s);
    return;
  }
  const P = node.planet!;
  s.planet = P;
  node.planet = null;
  s.phase = 'planet';
  for (const sh of s.shuttles) {
    sh.x = P.trainX;
    sh.y = P.trainY;
  }
  for (const g of s.groups) {
    g.target = null;
    g.recalled = false;
    g.timer = 2;
    if (g.memberIds.length) setState(s, g, 'docked', '抵达新星球，等待扫描结果');
  }
  log(s, 'system', `抵达${P.name}。情报：${node.intel} 先启动扫描，小组会自主探索。`);
  s.toasts.push({ t: s.time, title: `抵达${P.name}`, text: '启动列车扫描，查看「航线」面板中的星球情报与下一站。' });
  s.paused = true;
}

function arriveStation(s: GameState): void {
  s.phase = 'station';
  s.station.docked = true;
  s.station.arrivalTime = s.time;
  if (s.credits >= STATION.dockingFee) {
    s.credits -= STATION.dockingFee;
    s.station.feePaid = true;
    log(s, 'station', `抵达${STATION.name}。支付停泊费 ${STATION.dockingFee} 星币。站内禁止暴力，私人武装机器人已封存。灾变追赶暂停。`);
  } else {
    s.inventory.energy = Math.max(0, s.inventory.energy - STATION.dockingFee * 10);
    s.station.feePaid = true;
    log(s, 'station', `抵达${STATION.name}。星币不足，以 ${STATION.dockingFee * 10} kWh 能源抵付停泊费。灾变追赶暂停。`);
  }
  s.boosts.push({ label: '抵达交易站', until: s.time + 720, morale: 10 });
  s.toasts.push({ t: s.time, title: `抵达${STATION.name}`, text: '可以买卖、补给与维修。完成一次补给或维修后可查看旅程总结。' });
  s.paused = true;
}
