// 矿点作业位置占用规则
// - 运输机实际抵达并开始部署时才取得位置（先到先得，按小组顺序逐个处理，杜绝同时占用）。
// - 正常返航交货期间保留位置，超过期限未恢复则释放。
// - 储量采空后释放全部位置。

import { log } from './core';
import type { Deposit, GameState, Slot } from './types';

export const SLOT_RESERVE_MINUTES = 120; // 返航交货期间保留时长（原型参数）

export function findDeposit(s: GameState, id: number | undefined): Deposit | null {
  if (id == null || !s.planet) return null;
  return s.planet.deposits.find((d) => d.id === id) ?? null;
}

/** 该小组在此矿点持有（工作中或保留中）的位置 */
export function heldSlot(d: Deposit, groupId: number): Slot | null {
  return d.slots.find((x) => x.holderGroupId === groupId) ?? null;
}

export function freeSlots(d: Deposit): number {
  return d.slots.filter((x) => x.status === 'free').length;
}

/** 尝试在抵达时占用位置；成功返回位置，失败返回 null。 */
export function tryClaim(_s: GameState, d: Deposit, groupId: number): Slot | null {
  if (d.reserve <= 0) return null;
  const own = heldSlot(d, groupId);
  if (own) {
    own.status = 'working';
    own.reservedUntil = -1;
    return own;
  }
  const free = d.slots.find((x) => x.status === 'free');
  if (!free) return null;
  free.holderGroupId = groupId;
  free.status = 'working';
  free.reservedUntil = -1;
  return free;
}

/** 返航交货：保留位置 */
export function reserveForDelivery(s: GameState, d: Deposit, groupId: number): void {
  const own = heldSlot(d, groupId);
  if (!own) return;
  if (d.reserve <= 0) {
    release(own);
    return;
  }
  own.status = 'reserved';
  own.reservedUntil = s.time + SLOT_RESERVE_MINUTES;
}

export function releaseAllOf(s: GameState, groupId: number): void {
  for (const d of s.planet?.deposits ?? []) {
    const own = heldSlot(d, groupId);
    if (own) release(own);
  }
}

export function release(slot: Slot): void {
  slot.holderGroupId = null;
  slot.status = 'free';
  slot.reservedUntil = -1;
}

/** 每分钟检查保留到期与采空释放 */
export function tickClaims(s: GameState): void {
  for (const d of s.planet?.deposits ?? []) {
    for (const slot of d.slots) {
      if (slot.status === 'reserved' && s.time >= slot.reservedUntil) {
        const g = s.groups.find((x) => x.id === slot.holderGroupId);
        log(s, 'group', `${d.name}的作业位置保留到期，已释放${g ? `（原属${g.name}）` : ''}。`);
        release(slot);
      }
      if (d.reserve <= 0 && slot.status !== 'free') {
        // 正在作业的组会在自身状态机中处理采空
        if (slot.status === 'reserved') release(slot);
      }
    }
  }
}
