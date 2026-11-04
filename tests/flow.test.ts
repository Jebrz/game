import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { step } from '../src/sim/step';
import { stageComplete } from '../src/sim/actions';
import { autoPlayer } from './autoplay';

describe('完整流程（脚本玩家，正常操作函数）', () => {
  it('从开局走到交易站并完成补给/维修', () => {
    const s = createInitialState(7);
    let guard = 0;
    while (!stageComplete(s) && s.phase !== 'failed' && guard++ < 3000) {
      if (s.time % 5 === 0) autoPlayer(s);
      s.paused = false;
      step(s);
    }
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.VERBOSE) {
      for (const l of s.log) console.log(l.t, l.text);
      console.log(JSON.stringify(s.stats), s.groups.map((g) => [g.name, g.points, g.purchases]));
    }
    expect(s.phase).toBe('station');
    expect(stageComplete(s)).toBe(true);
    expect(s.stats.deliveries).toBeGreaterThan(2);
    expect(s.stats.upgrades + s.stats.genes).toBeGreaterThan(0);
    expect(s.stats.leftBehind).toBe(0);
    for (const v of Object.values(s.inventory)) expect(v).toBeGreaterThanOrEqual(0);
  });
});
