// 六泊位机库预览：每架运输机的状态与动画时间线（纯逻辑，按经过的真实时间推进）。

import { BAYS, type Bay } from './hangarLayout';

export type ShuttleStatus = 'docked' | 'departing' | 'away' | 'returning';

export const STATUS_LABEL: Record<ShuttleStatus, string> = {
  docked: '已停靠',
  departing: '正在出航',
  away: '已离队',
  returning: '正在归队',
};

/** 时间线（秒）。出航合计约 6.6 秒，归队约 6.4 秒。 */
export const TIMING = {
  taxiOut: 2.6, // 机位 → 穿过门口 → 外平台（缓起缓停）
  holdOut: 1.0, // 在外平台停稳约 1 秒，引擎升温
  launch: 3.0, // 平台 → 画面边缘（逐渐加速并淡出）
  approach: 3.0, // 画面边缘 → 外平台（减速）
  holdIn: 0.8, // 平台上短暂停顿
  taxiIn: 2.6, // 倒退穿过门口回到机位
} as const;

export interface ShuttleAnim {
  bayId: string;
  status: ShuttleStatus;
  /** 当前阶段已经过的秒数 */
  t: number;
  /** 当前阶段序号（出航/归队各 3 段） */
  leg: 0 | 1 | 2;
}

export interface Pose {
  x: number;
  y: number;
  /** 机头方向：上侧泊位朝上（0），下侧泊位朝下（π），全程不变 */
  angle: number;
  alpha: number;
  /** 引擎光效强度 0–1 */
  engine: number;
}

const smooth = (u: number) => u * u * (3 - 2 * u); // 缓起缓停
const easeIn = (u: number) => u * u * u; // 逐渐加速
const easeOut = (u: number) => 1 - (1 - u) ** 3; // 逐渐减速
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

export function initialShuttles(): ShuttleAnim[] {
  return BAYS.map((b) => ({ bayId: b.id, status: 'docked', t: 0, leg: 0 }));
}

export function canDepart(a: ShuttleAnim): boolean {
  return a.status === 'docked';
}
export function canReturn(a: ShuttleAnim): boolean {
  return a.status === 'away';
}

/** 出航：只有已停靠时生效，返回是否执行 */
export function depart(a: ShuttleAnim): boolean {
  if (!canDepart(a)) return false;
  a.status = 'departing';
  a.leg = 0;
  a.t = 0;
  return true;
}
/** 归队：只有已离队时生效 */
export function recall(a: ShuttleAnim): boolean {
  if (!canReturn(a)) return false;
  a.status = 'returning';
  a.leg = 0;
  a.t = 0;
  return true;
}

/** 重置：取消一切动画，全部回到机位 */
export function resetAll(list: ShuttleAnim[]): void {
  for (const a of list) {
    a.status = 'docked';
    a.leg = 0;
    a.t = 0;
  }
}

const OUT_LEGS = [TIMING.taxiOut, TIMING.holdOut, TIMING.launch];
const IN_LEGS = [TIMING.approach, TIMING.holdIn, TIMING.taxiIn];

/** 推进 dt 秒（真实经过的时间，与帧率无关） */
export function advance(a: ShuttleAnim, dt: number): void {
  if (a.status !== 'departing' && a.status !== 'returning') return;
  const legs = a.status === 'departing' ? OUT_LEGS : IN_LEGS;
  a.t += dt;
  while (a.t >= legs[a.leg]) {
    a.t -= legs[a.leg];
    if (a.leg === 2) {
      a.status = a.status === 'departing' ? 'away' : 'docked';
      a.leg = 0;
      a.t = 0;
      return;
    }
    a.leg = (a.leg + 1) as 0 | 1 | 2;
  }
}

export function poseOf(a: ShuttleAnim, bay: Bay = BAYS.find((b) => b.id === a.bayId)!): Pose {
  const angle = bay.side === 'up' ? 0 : Math.PI;
  const base = { x: bay.park.x, angle };
  const at = (y: number, alpha: number, engine: number): Pose => ({ ...base, y, alpha, engine });
  switch (a.status) {
    case 'docked':
      return at(bay.park.y, 1, 0);
    case 'away':
      return at(bay.away.y, 0, 0);
    case 'departing': {
      if (a.leg === 0) {
        const u = clamp01(a.t / TIMING.taxiOut);
        return at(lerp(bay.park.y, bay.platform.y, smooth(u)), 1, 0.18 * clamp01(u * 4));
      }
      if (a.leg === 1) {
        const u = clamp01(a.t / TIMING.holdOut);
        return at(bay.platform.y, 1, 0.18 + 0.42 * smooth(u));
      }
      const u = clamp01(a.t / TIMING.launch);
      const alpha = 1 - smooth(clamp01((u - 0.55) / 0.45));
      return at(lerp(bay.platform.y, bay.away.y, easeIn(u)), alpha, 0.6 + 0.4 * clamp01(u * 3));
    }
    case 'returning': {
      if (a.leg === 0) {
        const u = clamp01(a.t / TIMING.approach);
        const alpha = smooth(clamp01(u / 0.4));
        return at(lerp(bay.away.y, bay.platform.y, easeOut(u)), alpha, 1 - 0.45 * u);
      }
      if (a.leg === 1) return at(bay.platform.y, 1, 0.55);
      const u = clamp01(a.t / TIMING.taxiIn);
      return at(lerp(bay.platform.y, bay.park.y, smooth(u)), 1, 0.55 * (1 - smooth(clamp01((u - 0.5) / 0.5))));
    }
  }
}
