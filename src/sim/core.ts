// 通用工具：随机数、日志、库存操作、查询。

import { ITEM_INFO } from '../config/content';
import type { GameState, Group, Inventory, ItemId, LogEntry, Passenger, Shuttle } from './types';

/** 确定性随机数（mulberry32），状态保存在 state.rng 中以便存档复现。 */
export function rand(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function log(s: GameState, cat: LogEntry['cat'], text: string): void {
  s.log.push({ t: s.time, cat, text });
  if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function newId(s: GameState): number {
  return s.nextId++;
}

export function person(s: GameState, id: number): Passenger {
  const p = s.passengers.find((x) => x.id === id);
  if (!p) throw new Error(`无此乘客 ${id}`);
  return p;
}

export function groupShuttle(s: GameState, g: Group): Shuttle | null {
  if (g.shuttleId == null) return null;
  return s.shuttles.find((x) => x.id === g.shuttleId) ?? null;
}

export function members(s: GameState, g: Group): Passenger[] {
  return g.memberIds.map((id) => person(s, id));
}

export function onBoardPeople(s: GameState): Passenger[] {
  return s.passengers.filter((p) => !p.leftBehind);
}

/** 检查库存是否足够；返回缺少的描述，足够时返回空数组。 */
export function missingItems(inv: Inventory, cost: Partial<Record<ItemId, number>>, mult = 1): string[] {
  const out: string[] = [];
  for (const k of Object.keys(cost) as ItemId[]) {
    const need = (cost[k] ?? 0) * mult;
    if (inv[k] + 1e-9 < need) {
      out.push(`${ITEM_INFO[k].label}缺 ${fmt(need - inv[k])}`);
    }
  }
  return out;
}

/** 扣除库存。调用前必须确认足够；若不足则抛错，绝不产生负库存。 */
export function consume(inv: Inventory, cost: Partial<Record<ItemId, number>>, mult = 1): void {
  if (missingItems(inv, cost, mult).length) throw new Error('库存不足，拒绝扣除');
  for (const k of Object.keys(cost) as ItemId[]) {
    inv[k] = Math.max(0, inv[k] - (cost[k] ?? 0) * mult);
  }
}

export function add(inv: Inventory, items: Partial<Record<ItemId, number>>, mult = 1): void {
  for (const k of Object.keys(items) as ItemId[]) inv[k] += (items[k] ?? 0) * mult;
}

export function fmt(n: number, digits = 0): string {
  if (!isFinite(n)) return '—';
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return digits ? r.toFixed(digits) : String(Math.round(r));
}

export function fmtTime(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${h}小时${mm ? mm + '分' : ''}` : `${mm}分`;
}

export function clockText(t: number): string {
  const day = Math.floor(t / 1440) + 1;
  const h = Math.floor((t % 1440) / 60);
  const m = Math.floor(t % 60);
  return `第${day}日 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function costText(cost: Partial<Record<ItemId, number>>): string {
  return (Object.keys(cost) as ItemId[]).map((k) => `${ITEM_INFO[k].label} ${fmt(cost[k] ?? 0, 1).replace(/\.0$/, '')}`).join('、');
}
