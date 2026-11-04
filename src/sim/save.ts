// 存档：带版本号；整个世界状态（含小组行动、矿点占用、货舱批次、随机数状态）一起保存。

import { SAVE_VERSION } from '../config/balance';
import { CATASTROPHE, HANGAR, ROUTE, SHUTTLE_BUILD } from '../config/balance';
import { advanceOver } from './catastrophe';
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
  if (![1, 2, SAVE_VERSION].includes(f.version)) throw new Error(`存档版本 ${f.version} 与当前版本 ${SAVE_VERSION} 不兼容`);
  let s = f.state;
  if (f.version === 1) s = migrateV1(s);
  if (f.version <= 2) s = migrateV2(s);
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

/** v2 旧航程（一颗星球 + 交易站）的离站燃料与航程：保持旧规则的 10 单位燃料 */
export const LEGACY_STATION_DIST = 400;

/**
 * v2 → v3：旧的单星球存档迁移为「起始星球 → 交易站」两节点航线，继续完成旧阶段。
 * - 不重新发放物资，不刷新地图；灾变由倒计时换算为前锋位置（剩余时间保持一致）。
 * - 体验 2～3 颗星球的新旅程需要新开局。
 */
export function migrateV2(old: GameState): GameState {
  const s = old as GameState & Record<string, unknown>;
  const oc = (s.catastrophe ?? {}) as unknown as { trueArrival?: number; warned?: boolean; edgeWarned?: boolean; arrived?: boolean; bias?: number };
  const P = s.planet;
  if (P) {
    P.resourceProfile = P.resourceProfile ?? 'rich';
    P.natives = P.natives ?? { kind: 'none', name: '', x: 0, y: 0, r: 0, detected: false, contacted: false, permitGranted: false, permitCost: {}, trades: [] };
    P.warned = P.warned ?? !!oc.warned;
    P.edgeWarned = P.edgeWarned ?? !!oc.edgeWarned;
    for (const sg of P.signs) {
      sg.kind = sg.kind ?? 'resource';
      sg.restricted = sg.restricted ?? false;
      sg.loot = sg.loot ?? {};
      sg.research = sg.research ?? 0;
      sg.lootTaken = sg.lootTaken ?? false;
    }
    for (const d of P.deposits) d.zone = d.zone ?? 'open';
  }
  for (const g of s.groups) {
    g.loot = g.loot ?? {};
    g.lootResearch = g.lootResearch ?? 0;
    g.pendingSwap = g.pendingSwap ?? null;
  }
  s.research.bank = s.research.bank ?? 0;
  const onPlanet = s.phase === 'planet' || s.phase === 'intro' || s.phase === 'failed';
  const planetNode = {
    id: s.nextId++,
    kind: 'planet' as const,
    name: P?.name ?? '灰岩星 K-7',
    pos: 0,
    intel: '起始星球（旧存档）。',
    planet: onPlanet ? null : P,
    status: (onPlanet ? 'current' : 'visited') as 'current' | 'visited',
    arrivedAt: 0,
    departedAt: onPlanet ? -1 : s.stats.departedAt,
    notes: onPlanet ? [] : ['旧存档：已离开'],
  };
  const stationNode = {
    id: s.nextId++,
    kind: 'station' as const,
    name: '回声交易站',
    pos: LEGACY_STATION_DIST,
    intel: '公共交易站（旧存档航线）。',
    planet: null,
    status: (s.phase === 'station' ? 'current' : 'unvisited') as 'current' | 'unvisited',
    arrivedAt: s.phase === 'station' ? s.station.arrivalTime : -1,
    departedAt: -1,
    notes: [],
  };
  const oldTravel = s.travel as unknown as { progress: number; duration: number } | null;
  let pos = 0;
  if (s.phase === 'travel' && oldTravel) {
    const dur = Math.ceil(LEGACY_STATION_DIST / ROUTE.trainSpeed);
    const progress = Math.min(dur - 1, Math.round((oldTravel.progress / oldTravel.duration) * dur));
    s.travel = { progress, duration: dur, from: 0, to: 1, fuel: 10 };
    pos = progress * ROUTE.trainSpeed;
  } else if (s.phase === 'station') {
    pos = LEGACY_STATION_DIST;
    s.travel = null;
  }
  s.journey = { nodes: [planetNode, stationNode], current: s.phase === 'station' ? 1 : 0, dest: s.phase === 'travel' ? 1 : null, pos };
  if (!onPlanet) s.planet = null;
  // 灾变：剩余时间保持与旧倒计时一致
  let front: number;
  if (onPlanet) {
    const remaining = Math.max(0, (oc.trueArrival ?? s.time + 600) - s.time);
    front = oc.arrived ? 0 : -advanceOver(s.time, remaining);
  } else front = pos - 600;
  s.catastrophe = { front, bias: typeof oc.bias === 'number' ? Math.max(-0.12, Math.min(0.12, oc.bias / 600)) : 0, arrived: !!oc.arrived, lastMilestone: CATASTROPHE.milestones.filter((m) => smoothFrac(s.time) >= m).length };
  s.version = 3;
  return s;
}

function smoothFrac(t: number): number {
  const x = Math.max(0, Math.min(1, t / CATASTROPHE.rampMinutes));
  return 3 * x * x - 2 * x * x * x;
}
