// 灾变「灰烬潮」：前锋沿航线追赶列车，推进速度由慢到快。
// - 前锋位置是全局状态，换星球不会重置；停泊交易站期间暂停推进。
// - 预计到达时间按加速曲线精确推算，再给出区间（越接近越准），不会无预警跳变。

import { CATASTROPHE, ROUTE } from '../config/balance';
import { clamp, fmt, fmtTime, log } from './core';
import type { GameState } from './types';

export type CatStage = 'far' | 'warn' | 'edge' | 'impact' | 'none';

function smooth(x: number): number {
  const c = clamp(x, 0, 1);
  return 3 * c * c - 2 * c * c * c;
}

/** 时刻 t 的前锋推进速度（Mm/分钟） */
export function frontSpeed(t: number): number {
  return CATASTROPHE.v0 + (CATASTROPHE.v1 - CATASTROPHE.v0) * smooth(t / CATASTROPHE.rampMinutes);
}

/** 从 0 到 t 的累计推进里程（解析积分） */
function integral(t: number): number {
  const T = CATASTROPHE.rampMinutes;
  const x = t / T;
  const g = x <= 1 ? x ** 3 - x ** 4 / 2 : 0.5 + (x - 1);
  return CATASTROPHE.v0 * t + (CATASTROPHE.v1 - CATASTROPHE.v0) * T * g;
}

/** 前锋从 front 出发（时刻 t0），抵达里程 pos 还需多少分钟（不考虑交易站暂停） */
export function minutesUntil(front: number, t0: number, pos: number): number {
  if (front >= pos) return 0;
  const need = pos - front;
  const base = integral(t0);
  let lo = 0;
  let hi = 1;
  while (integral(t0 + hi) - base < need) hi *= 2;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (integral(t0 + m) - base >= need) hi = m;
    else lo = m;
  }
  return hi;
}

/** 从 t0 起 minutes 分钟内前锋推进的里程 */
export function advanceOver(t0: number, minutes: number): number {
  return integral(t0 + minutes) - integral(t0);
}

/** 推算前锋在未来某时刻的位置 */
export function frontAt(s: GameState, t: number): number {
  return s.catastrophe.front + integral(t) - integral(s.time);
}

/** 区间估计：中心带偏差，宽度随剩余时间缩小 */
export function interval(s: GameState, remaining: number): { low: number; high: number } {
  const bias = s.catastrophe.bias * Math.min(1, remaining / 600);
  const center = remaining * (1 + bias);
  const u = Math.max(CATASTROPHE.minUncertainty, CATASTROPHE.uncertaintyFrac * remaining);
  return { low: Math.max(0, Math.round(center - u)), high: Math.round(center + u) };
}

/** 当前停靠星球的灾变到达估计 */
export function estimate(s: GameState): { low: number; high: number; remaining: number } {
  const node = s.journey.nodes[s.journey.current];
  const remaining = minutesUntil(s.catastrophe.front, s.time, node.pos);
  return { ...interval(s, remaining), remaining };
}

export function stage(s: GameState): CatStage {
  if (s.phase !== 'planet') return 'none';
  if (s.catastrophe.arrived) return 'impact';
  const e = estimate(s);
  if (e.low <= CATASTROPHE.edgeAt) return 'edge';
  if (e.low <= CATASTROPHE.warnAt) return 'warn';
  return 'far';
}

export const STAGE_LABEL: Record<CatStage, string> = {
  far: '远方',
  warn: '逼近',
  edge: '危险边缘',
  impact: '灾变冲击中',
  none: '航行/停泊中',
};

/** 加速进度（0-1）与描述，用于界面「正在加速」提示 */
export function accelInfo(s: GameState): { frac: number; speed: number; text: string } {
  const frac = smooth(s.time / CATASTROPHE.rampMinutes);
  const sp = frontSpeed(s.time);
  const mult = sp / CATASTROPHE.v0;
  const text =
    frac >= 0.999
      ? `推进速度已达峰值 ${fmt(sp * 60)} Mm/小时`
      : frac < 0.05
        ? `推进缓慢（${fmt(sp * 60)} Mm/小时），但正在逐渐加快`
        : `正在加速：${fmt(sp * 60)} Mm/小时（开局的 ${fmt(mult, 1)} 倍）`;
  return { frac, speed: sp, text };
}

/** 前锋与列车的距离（Mm） */
export function gapToTrain(s: GameState): number {
  return s.journey.pos - s.catastrophe.front;
}

/** 每分钟推进（暂停时不会调用；停泊交易站时不推进） */
export function tickCatastrophe(s: GameState): void {
  const c = s.catastrophe;
  if (s.phase === 'station' || s.phase === 'intro' || s.phase === 'failed') return;
  c.front += integral(s.time) - integral(s.time - 1);
  // 加速阶段提示（平滑加速，提前告知）
  const frac = smooth(s.time / CATASTROPHE.rampMinutes);
  const ms = CATASTROPHE.milestones;
  while (c.lastMilestone < ms.length && frac >= ms[c.lastMilestone]) {
    c.lastMilestone++;
    const sp = frontSpeed(s.time);
    log(s, 'danger', `灰烬潮推进加快：当前 ${fmt(sp * 60)} Mm/小时，仍在加速。停留时间会越来越短。`);
    s.toasts.push({ t: s.time, title: '灾变正在加速', text: `推进速度 ${fmt(sp * 60)} Mm/小时。后续星球可停留的时间会更短，请提前规划航线。` });
  }
  if (s.phase !== 'planet' || !s.planet) return;
  const P = s.planet;
  const st = stage(s);
  if (st === 'warn' && !P.warned) {
    P.warned = true;
    log(s, 'danger', `⚠ 灾变逼近${P.name}：灰烬潮已进入预警范围。请做好召回与离站准备。`);
    s.toasts.push({ t: s.time, title: '灾变逼近', text: '灰烬潮进入预警范围。检查燃料、维修与小组位置，在「航线」选择下一站。' });
  }
  if (st === 'edge' && !P.edgeWarned) {
    P.edgeWarned = true;
    log(s, 'danger', '⚠ 危险边缘：灰烬潮最早可能在两小时内到达！');
    s.toasts.push({ t: s.time, title: '危险边缘', text: `灾变最早可能在 2 小时内到达${P.name}。请发出召回并离站。` });
    if (!s.edgePauseTriggered) {
      s.edgePauseTriggered = true;
      s.paused = true;
      log(s, 'danger', '首次进入危险边缘，已自动暂停。');
    }
  }
  const node = s.journey.nodes[s.journey.current];
  if (!c.arrived && c.front >= node.pos) {
    c.arrived = true;
    log(s, 'danger', `灰烬潮抵达${P.name}！车体与在外人员正在受损，必须立即离站。`);
    s.toasts.push({ t: s.time, title: '灾变抵达', text: '车体持续受损。车体归零将导致失败。' });
    s.paused = true;
  }
  if (c.arrived) {
    s.train.hull = Math.max(0, s.train.hull - CATASTROPHE.hullDamagePerMin);
    for (const p of s.passengers) {
      if (!p.aboard && !p.leftBehind) p.health = Math.max(5, p.health - CATASTROPHE.outsideHealthPerMin);
    }
    for (const sh of s.shuttles) if (!sh.docked) sh.durability = Math.max(0, sh.durability - CATASTROPHE.shuttleWearPerMin);
    if (s.train.hull <= 0) {
      s.phase = 'failed';
      s.failReason = `列车在${P.name}被灰烬潮吞没，车体完整性归零。`;
      s.paused = true;
      log(s, 'danger', '列车被灰烬潮吞没。（可读取存档重试）');
    }
  }
}

/** 出发前预测：到达目的地时，灾变还需多久抵达那里 */
export function predictAtArrival(s: GameState, destPos: number): { travel: number; arriveAt: number; remaining: number; low: number; high: number } {
  const travel = Math.round((destPos - s.journey.pos) / ROUTE.trainSpeed);
  const arriveAt = s.time + travel;
  const frontThen = frontAt(s, arriveAt);
  const remaining = minutesUntil(frontThen, arriveAt, destPos);
  return { travel, arriveAt, remaining, ...interval(s, remaining) };
}

export function describeGap(s: GameState): string {
  return `前锋距列车 ${fmt(gapToTrain(s))} Mm`;
}

export { fmtTime };
