// 存档：带版本号；整个世界状态（含小组行动、矿点占用、货舱批次、随机数状态）一起保存。

import { SAVE_VERSION } from '../config/balance';
import type { GameState } from './types';

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
  if (f.version !== SAVE_VERSION) throw new Error(`存档版本 ${f.version} 与当前版本 ${SAVE_VERSION} 不兼容`);
  const s = f.state;
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
