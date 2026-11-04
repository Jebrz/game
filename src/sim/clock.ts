// 实时时钟：把真实时间换算为固定步数。暂停时不推进任何模拟。

import { TIME } from '../config/balance';
import { step } from './step';
import type { GameState } from './types';

export interface Clock {
  acc: number; // 累积的游戏分钟（小数部分）
}

/** 返回本帧执行的步数 */
export function advance(s: GameState, clock: Clock, realMs: number): number {
  if (s.paused || s.phase === 'intro' || s.phase === 'failed') {
    clock.acc = 0;
    return 0;
  }
  clock.acc += (Math.min(realMs, 250) / 1000) * TIME.minutesPerRealSecond * s.speed;
  let n = 0;
  while (clock.acc >= 1 && n < TIME.maxStepsPerFrame) {
    step(s);
    clock.acc -= 1;
    n++;
    if (s.paused) {
      clock.acc = 0;
      break;
    }
  }
  if (n >= TIME.maxStepsPerFrame) clock.acc = Math.min(clock.acc, 1);
  return n;
}
