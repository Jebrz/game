import { describe, expect, it } from 'vitest';
import { CATASTROPHE } from '../src/config/balance';
import { frontSpeed, interval, minutesUntil } from '../src/sim/catastrophe';
import { createInitialState } from '../src/sim/state';
import { step } from '../src/sim/step';
import { autoPlayer } from './autoplay';
import { measurePace } from './pace';

describe('首站 → 第二站节奏（脚本玩家，与界面按钮相同的操作）', () => {
  it('首站完成培训、造公共运输机、第三组首次交付后再走（新手节奏）：第二站在首次预警前能完成调查，并能按召回耗时安全离开', () => {
    for (const seed of [79, 7, 3]) {
      const r = measurePace(seed, 'builder', 'edge', 'novice');
      expect(r.g3First, `种子 ${seed} 第三组首次交付`).toBeGreaterThan(0);
      expect(r.g3First).toBeLessThanOrEqual(r.leave0 + 30);
      expect(r.arrive1).toBeGreaterThan(0);
      // 抵达后到首次预警至少 4 小时游戏时间（1× 约 2 现实分钟）
      expect(r.warn1 - r.arrive1, `种子 ${seed} 预警余量`).toBeGreaterThanOrEqual(240);
      // 首个调查在预警前完成
      expect(r.firstSurvey1).toBeGreaterThan(0);
      expect(r.firstSurvey1).toBeLessThan(r.warn1);
      // 预警 ≠ 必须撤离：真正抵达在预警之后数小时
      expect(r.impact1 - r.warn1).toBeGreaterThanOrEqual(300);
      // 按危险边缘召回后安全离开，并走完航线
      expect(r.margin1, `种子 ${seed} 离站余量`).toBeGreaterThanOrEqual(60);
      expect(r.reachedStation).toBe(true);
    }
  });

  it('继续贪采会压缩撤离余量', () => {
    for (const seed of [79, 7]) {
      const normal = measurePace(seed, 'builder', 'edge', 'novice');
      const greedy = measurePace(seed, 'builder', 'greedy', 'novice');
      expect(greedy.arrive1).toBe(normal.arrive1);
      expect(greedy.margin1).toBeLessThan(normal.margin1 - 60);
      expect(greedy.margin1).toBeLessThanOrEqual(40);
    }
  });

  it('只修驱动、备燃料就走的玩家在第二站停留更久；两种走法的第二站抵达时刻都早于灾变', () => {
    const quick = measurePace(79, 'quick', 'edge', 'novice');
    const builder = measurePace(79, 'builder', 'edge', 'novice');
    expect(quick.leave0).toBeLessThan(builder.leave0);
    expect(quick.warn1 - quick.arrive1).toBeGreaterThan(builder.warn1 - builder.arrive1);
  });

  it('较慢的正常玩家（上轮界面实测：t≈1530 才抵达第二站）抵达后仍有约 3.7 小时以上才首次预警（调整前种子 79 只有 79 分）', () => {
    for (const seed of [79, 7, 41]) {
      const s = createInitialState(seed);
      const pos = s.journey.nodes[1].pos;
      const impact = minutesUntil(s.catastrophe.front, 0, pos);
      const arrive = 1530;
      let warn = arrive;
      while (warn < impact && interval(s, impact - warn).low > CATASTROPHE.warnAt) warn++;
      expect(warn - arrive, `种子 ${seed}`).toBeGreaterThanOrEqual(220);
      expect(impact - arrive).toBeGreaterThanOrEqual(540);
    }
  });

  it('灾变曲线：前期较慢、峰值更高；跨星球连续追赶，后段两星之间的间隔不比调整前宽', () => {
    expect(frontSpeed(0)).toBeCloseTo(CATASTROPHE.v0, 5);
    expect(frontSpeed(CATASTROPHE.rampMinutes)).toBeCloseTo(CATASTROPHE.v1, 5);
    const s = createInitialState(79);
    const at = (pos: number) => minutesUntil(s.catastrophe.front, 0, pos);
    const startPlanet = at(0);
    expect(startPlanet).toBeGreaterThan(1700);
    expect(startPlanet).toBeLessThan(1830);
    // 第二、第三颗星之间（393 Mm）的前锋耗时不超过调整前（约 335 分）
    expect(at(786) - at(393)).toBeLessThanOrEqual(340);
  });
});

describe('原住民领地内迹象的调查', () => {
  it('种子 79：小组会调查领地内唯一的迹象，并在日志写明理由；之后出现许可选项', () => {
    const s = createInitialState(79);
    let arrive = -1;
    let found = -1;
    for (let i = 0; i < 3000 && s.journey.current < 2; i++) {
      if (i % 5 === 0) autoPlayer(s, { style: 'expert' });
      step(s);
      if (s.paused) s.paused = false;
      if (s.journey.current === 1 && s.phase === 'planet') {
        if (arrive < 0) arrive = s.time;
        if (found < 0 && s.planet!.deposits.some((d) => d.zone === 'permit' && d.discoveredBy != null)) found = s.time;
      }
    }
    expect(found).toBeGreaterThan(0);
    expect(found - arrive).toBeLessThan(240);
    expect(s.log.some((l) => l.text.includes('领地内的辉晶迹象：调查不需要许可'))).toBe(true);
    // 确认后出现许可选项（原住民矿区事件或协商记录）
    expect(s.events.some((e) => e.kind === 'nativeMine') || s.log.some((l) => l.text.includes('采矿许可'))).toBe(true);
  });

  it('种子 7 回归：签订分享产出许可 → 许可内采矿 → 交付时扣出份额、贡献点只按留存部分、每批只结算一次', () => {
    const s = createInitialState(7);
    for (let i = 0; i < 3000 && s.journey.current < 2; i++) {
      if (i % 5 === 0) autoPlayer(s, { style: 'expert' });
      step(s);
      if (s.paused) s.paused = false;
    }
    const signed = s.log.find((l) => /签订.*采矿许可：交出该矿点产出的 30%/.test(l.text));
    expect(signed).toBeTruthy();
    const shared = s.log.filter((l) => l.text.includes('按协议把'));
    expect(shared.length).toBeGreaterThan(0);
    const settled = s.log.filter((l) => l.text.includes('仅按列车留存部分计算'));
    expect(settled.length).toBe(shared.length);
    const batches = settled.map((l) => l.text.match(/批次 #(\d+)/)![1]);
    expect(new Set(batches).size).toBe(batches.length);
  });
});
