// 灾变：预计到达时间以区间表达，越接近越准确。

import { CATASTROPHE } from '../config/balance';
import { log } from './core';
import type { GameState } from './types';

export type CatStage = 'far' | 'warn' | 'edge' | 'impact' | 'none';

export function estimate(s: GameState): { low: number; high: number; remaining: number } {
  const c = s.catastrophe;
  const remaining = Math.max(0, c.trueArrival - s.time);
  const u = Math.max(CATASTROPHE.minUncertainty, CATASTROPHE.uncertaintyFrac * remaining);
  const center = remaining + (c.bias * remaining) / c.trueArrival;
  return { low: Math.max(0, Math.round(center - u)), high: Math.round(center + u), remaining };
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
  none: '已脱离',
};

export function tickCatastrophe(s: GameState): void {
  const c = s.catastrophe;
  const st = stage(s);
  if (st === 'warn' && !c.warned) {
    c.warned = true;
    log(s, 'danger', '⚠ 灾变逼近：灰烬潮已进入预警范围。请做好召回与离站准备。');
    s.toasts.push({ t: s.time, title: '灾变逼近', text: '灰烬潮进入预警范围。检查维修、燃料与小组位置。' });
  }
  if (st === 'edge' && !c.edgeWarned) {
    c.edgeWarned = true;
    log(s, 'danger', '⚠ 危险边缘：灰烬潮最早可能在两小时内到达！已自动暂停。');
    s.toasts.push({ t: s.time, title: '危险边缘', text: '灾变最早可能在 2 小时内到达。游戏已自动暂停，请发出召回并准备离站。' });
    if (!s.edgePauseTriggered) {
      s.edgePauseTriggered = true;
      s.paused = true;
    }
  }
  if (!c.arrived && s.time >= c.trueArrival) {
    c.arrived = true;
    log(s, 'danger', '灰烬潮抵达！车体与在外人员正在受损，必须立即离站。');
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
      s.failReason = '列车在灰烬潮中失去车体完整性。';
      s.paused = true;
      log(s, 'danger', '列车被灰烬潮吞没。（可读取存档重试）');
    }
  }
}
