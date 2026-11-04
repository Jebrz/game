// 存档：带版本号；整个世界状态（含小组行动、矿点占用、货舱批次、随机数状态）一起保存。

import { SAVE_VERSION } from '../config/balance';
import { HANGAR, SHUTTLE_BUILD } from '../config/balance';
import { RECIPES } from '../config/content';
import type { GameState, ProcessJob, Shuttle } from './types';

export interface SaveFile {
  version: number;
  savedAt: string;
  gameTime: number;
  state: GameState;
}

export function serialize(s: GameState): string {
  const f: SaveFile = { version: SAVE_VERSION, savedAt: new Date().toISOString(), gameTime: s.time, state: s };
  return JSON.stringify(f);
}

export function deserialize(json: string): GameState {
  const f = JSON.parse(json) as SaveFile;
  if (!f || typeof f !== 'object' || !f.state) throw new Error('存档格式无效');
  if (f.version !== SAVE_VERSION && f.version !== 1) throw new Error(`存档版本 ${f.version} 与当前版本 ${SAVE_VERSION} 不兼容`);
  const s = f.version === 1 ? migrateV1(f.state) : f.state;
  s.paused = true; // 读档后暂停，便于确认状态
  return s;
}

export const SLOT_KEYS = { auto: 'startrain.save.auto', slot1: 'startrain.save.1', slot2: 'startrain.save.2' } as const;
export type SlotId = keyof typeof SLOT_KEYS;

export function slotInfo(storage: Storage, slot: SlotId): { gameTime: number; savedAt: string } | null {
  try {
    const raw = storage.getItem(SLOT_KEYS[slot]);
    if (!raw) return null;
    const f = JSON.parse(raw) as SaveFile;
    return { gameTime: f.gameTime, savedAt: f.savedAt };
  } catch {
    return null;
  }
}

export function saveTo(storage: Storage, slot: SlotId, s: GameState): void {
  storage.setItem(SLOT_KEYS[slot], serialize(s));
}

export function loadFrom(storage: Storage, slot: SlotId): GameState {
  const raw = storage.getItem(SLOT_KEYS[slot]);
  if (!raw) throw new Error('该槽位没有存档');
  return deserialize(raw);
}

/**
 * v1 → v2：补齐运输机编号/归属、机库容量、队列订单字段。
 * 保留原有运输机、小组、资源与进度；机库容量至少容纳已有运输机。
 */
export function migrateV1(old: GameState): GameState {
  const s = old as GameState & { shuttleSerial?: number; hangar?: GameState['hangar'] };
  let n = 0;
  for (const sh of s.shuttles as (Shuttle & Partial<Shuttle>)[]) {
    n += 1;
    if (!sh.serial) sh.serial = `${SHUTTLE_BUILD.serialPrefix}${String(n).padStart(2, '0')}`;
    if (sh.ownerGroupId === undefined) sh.ownerGroupId = null;
    if (sh.builtAt === undefined) sh.builtAt = -1;
  }
  s.shuttleSerial = s.shuttleSerial ?? n;
  if (!s.hangar) s.hangar = { capacity: Math.max(HANGAR.baseCapacity, s.shuttles.length), level: 0 };
  s.queue = s.queue.map((j) => {
    const job = j as ProcessJob & Partial<ProcessJob>;
    return {
      ...job,
      kind: job.kind ?? 'recipe',
      orderedBy: job.orderedBy ?? null,
      reserved: job.reserved ?? { ...(RECIPES.find((r) => r.id === job.recipeId)?.inputs ?? {}) },
      pointsPaid: job.pointsPaid ?? 0,
      orderedAt: job.orderedAt ?? s.time,
    };
  });
  s.version = 2;
  return s;
}
