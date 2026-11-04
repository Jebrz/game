import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { step } from '../src/sim/step';
import { stageComplete } from '../src/sim/actions';
import { autoPlayer } from './autoplay';

function run(seed: number, opts: Parameters<typeof autoPlayer>[1]) {
  const s = createInitialState(seed);
  let guard = 0;
  while (!stageComplete(s) && s.phase !== 'failed' && guard++ < 3000) {
    if (s.time % 5 === 0) autoPlayer(s, opts);
    s.paused = false;
    step(s);
  }
  return s;
}

describe('多种子稳健性', () => {
  it('使用需求奖励引导的玩家在多个种子下都能抵达交易站', () => {
    const res = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((seed) => {
      const s = run(seed, {});
      return { seed, ok: stageComplete(s), dep: s.stats.departedAt, growth: s.stats.upgrades + s.stats.genes };
    });
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.VERBOSE) console.log(res);
    for (const r of res) {
      expect(r.ok, `seed ${r.seed}`).toBe(true);
      expect(r.growth, `seed ${r.seed}`).toBeGreaterThan(0);
    }
  });
  it('报告：完全不调需求奖励的被动玩家结果（不作硬性要求）', () => {
    const res = [1, 2, 3, 4, 5].map((seed) => {
      const s = run(seed, { noBonus: true });
      return { seed, ok: stageComplete(s), dep: s.stats.departedAt };
    });
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.VERBOSE) console.log('被动玩家', res);
    expect(res.length).toBe(5);
  });
});
