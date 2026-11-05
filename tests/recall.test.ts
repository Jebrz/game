import { describe, expect, it } from 'vitest';
import * as A from '../src/sim/actions';
import { recallInfo, sortieOutlooks } from '../src/sim/groupAI';
import { tank } from '../src/sim/shuttles';
import { fuelPlan, nextLegFuel } from '../src/sim/objectives';
import { createInitialState } from '../src/sim/state';
import { processingSpeed } from '../src/sim/staff';
import { step } from '../src/sim/step';
import type { GameState } from '../src/sim/types';
import { departureAdvice } from '../src/ui/panels';
import { estimate, stage } from '../src/sim/catastrophe';

// 注入状态（准备测试局面，不代表正常试玩）
function planOf(s: GameState) {
  return fuelPlan(s, (g) => recallInfo(s, g).eta, processingSpeed(s))!;
}
function scanned(seed = 79): GameState {
  const s = createInitialState(seed);
  A.startGame(s);
  A.startScan(s);
  s.train.driveRepaired = true;
  return s;
}
const run = (s: GameState, n: number) => {
  for (let i = 0; i < n; i++) {
    step(s);
    s.paused = false;
  }
};
const allHome = (s: GameState) => s.groups.every((g) => ['docked', 'resting', 'grounded'].includes(g.state));

describe('召回前后的离站燃料判断', () => {
  it('原料够但燃料未加工：提示需先加入队列；召回不中断加工；加工完成且全员回车后可离站', () => {
    const s = scanned();
    run(s, 60);
    const need = nextLegFuel(s);
    s.inventory.trainFuel = 0;
    s.inventory.crystal = need * 3 + 2;
    s.inventory.ice = need + 3;
    const p = planOf(s);
    expect(p.verdict).toBe('process');
    expect(p.makeable).toBe(need);
    expect(p.short).toBe(0);
    const html = departureAdvice(s, estimate(s).low);
    expect(html).toContain('需要先在「库存加工」加入队列');
    expect(html).toContain('data-act="tab" data-arg="industry"');
    A.setRecall(s, true);
    A.enqueue(s, 'trainFuel', 5);
    A.enqueue(s, 'trainFuel', need - 5);
    expect(planOf(s).verdict).toBe('processing');
    const rem0 = s.queue.reduce((a, j) => a + j.remaining, 0);
    run(s, 5);
    expect(s.queue.reduce((a, j) => a + j.remaining, 0)).toBeLessThan(rem0); // 召回中仍在加工
    for (let i = 0; i < 600 && (s.inventory.trainFuel < need || !allHome(s)); i++) run(s, 1);
    expect(s.inventory.trainFuel).toBeGreaterThanOrEqual(need);
    expect(planOf(s).verdict).toBe('enough');
    expect(A.canDepartTo(s, s.journey.current + 1)).toBe('');
  });

  it('小组正带着所缺原料返航：分开显示「预计带回」与「已入库」，给出小组与预计返航时间；卸货后才入库', () => {
    const s = scanned();
    A.setDemandBonus(s, 'crystal', 4);
    A.setDemandBonus(s, 'ice', 4);
    let g: GameState['groups'][number] | undefined;
    for (let i = 0; i < 900 && !g; i++) {
      run(s, 1);
      g = s.groups.find((x) => {
        const sh = s.shuttles.find((y) => y.id === x.shuttleId)!;
        return x.state === 'mining' && (sh.cargo.items.crystal ?? 0) >= 6;
      });
    }
    expect(g).toBeTruthy();
    const sh = s.shuttles.find((y) => y.id === g!.shuttleId)!;
    // 让缺口正好落在这批货上：库存冰晶足够、辉晶为 0
    s.inventory.trainFuel = nextLegFuel(s) - Math.floor((sh.cargo.items.crystal ?? 0) / 3);
    s.inventory.crystal = 0;
    s.inventory.ice = 20;
    s.queue = s.queue.filter((j) => j.recipeId !== 'trainFuel');
    A.setRecall(s, true);
    run(s, 1);
    const p = planOf(s);
    expect(p.verdict).toBe('cargo');
    const b = p.inbound.find((x) => x.groupId === g!.id)!;
    expect(b.crystal).toBeGreaterThan(0);
    expect(b.returning).toBe(true);
    expect(b.eta).toBeGreaterThan(0);
    const html = departureAdvice(s, estimate(s).low);
    expect(html).toContain(`${g!.name}运输机上已装`);
    expect(html).toContain('预计带回，未入库');
    expect(s.inventory.crystal).toBe(0); // 尚未入库
    for (let i = 0; i < 300 && s.inventory.crystal === 0; i++) run(s, 1);
    expect(s.inventory.crystal).toBeGreaterThan(0); // 卸货结算后入库
    expect(['process', 'processing']).toContain(planOf(s).verdict);
  });

  it('原料不足且灾变逼近：说明仍缺多少、按规则能做什么（解除召回可恢复出勤、危险边缘后不再出勤）与风险；召回按钮仍可用', () => {
    const s = scanned();
    run(s, 30);
    s.inventory.trainFuel = 0;
    s.inventory.crystal = 0;
    s.inventory.ice = 0;
    for (const x of s.shuttles) x.cargo.items = {};
    s.queue = [];
    const p = planOf(s);
    expect(p.verdict).toBe('short');
    expect(p.short).toBe(nextLegFuel(s));
    expect(p.shortRaw.crystal).toBe(nextLegFuel(s) * 3);
    let html = departureAdvice(s, estimate(s).low);
    expect(html).toContain('仍缺轨道燃料');
    expect(html).toMatch(/暂不召回，.*会继续自主出勤/);
    expect(html).toContain('召回始终可以一键发出');
    A.setRecall(s, true);
    expect(s.recallActive).toBe(true);
    html = departureAdvice(s, estimate(s).low);
    expect(html).toMatch(/解除召回令，.*会恢复自主出勤/);
    // 解除召回后小组确实会重新出勤（远方/逼近阶段）
    for (let i = 0; i < 200 && !allHome(s); i++) run(s, 1);
    A.setRecall(s, false);
    let out = false;
    for (let i = 0; i < 60 && !out; i++) {
      run(s, 1);
      out = !allHome(s);
    }
    expect(out).toBe(true);
    // 危险边缘：文案说明不再出勤；在车上的小组不会出发
    A.setRecall(s, true);
    for (let i = 0; i < 300 && !allHome(s); i++) run(s, 1);
    s.catastrophe.front = s.journey.nodes[s.journey.current].pos - 30; // 跳到危险边缘
    expect(stage(s)).toBe('edge');
    html = departureAdvice(s, estimate(s).low);
    expect(html).toContain('已到危险边缘：即使解除召回，小组也不再出勤');
    expect(html).toContain('本星已没有补足燃料的途径');
    expect(html).not.toContain('提高辉晶/冰晶的需求奖励');
    A.setRecall(s, false);
    run(s, 30);
    expect(allHome(s)).toBe(true);
  });

  it('推进剂不足时如实说明「解除召回也不会出勤」与补推进剂的现有入口；与实际行为一致', () => {
    const s = scanned();
    run(s, 40);
    A.setRecall(s, true);
    for (let i = 0; i < 300 && !allHome(s); i++) run(s, 1);
    s.inventory.trainFuel = 0;
    s.inventory.crystal = 0;
    s.inventory.ice = 0;
    s.inventory.propellant = 0;
    for (const x of s.shuttles) x.fuel = 0;
    s.queue = [];
    const html = departureAdvice(s, estimate(s).low);
    expect(html).toContain('即使解除召回令，也没有小组会出勤');
    expect(html).toContain('推进剂不足');
    expect(html).toContain('应急合成推进剂');
    expect(html).toContain('前往库存加工（推进剂）');
    A.setRecall(s, false);
    run(s, 40);
    expect(allHome(s)).toBe(true); // 与提示一致：确实没有小组出勤
  });

  it('推进剂只够一组时：提示按共享推进剂逐组判断，解除召回后实际出勤的小组与提示一致', () => {
    const s = scanned();
    run(s, 300); // 已知矿点
    A.setRecall(s, true);
    for (let i = 0; i < 300 && !allHome(s); i++) run(s, 1);
    run(s, 20);
    for (const x of s.shuttles) x.fuel = 0;
    const first = s.shuttles.find((x) => x.id === s.groups[0].shuttleId)!;
    s.inventory.propellant = Math.min(tank(first), 12);
    for (const p of s.passengers) p.fatigue = 0;
    const om = sortieOutlooks(s);
    const predicted = s.groups.filter((g) => !om.get(g.id)).map((g) => g.name);
    expect(predicted.length).toBe(1);
    A.setRecall(s, false);
    run(s, 30);
    const went = s.groups.filter((g) => !['docked', 'resting', 'grounded'].includes(g.state)).map((g) => g.name);
    expect(went).toEqual(predicted);
  });

  it('无矿星：小组带回的遗留燃料舱计入「预计带回」，无需加工', () => {
    const s = scanned();
    run(s, 40);
    const g = s.groups.find((x) => !['docked', 'resting', 'grounded'].includes(x.state))!;
    expect(g).toBeTruthy();
    s.inventory.trainFuel = 0;
    s.inventory.crystal = 0;
    s.inventory.ice = 0;
    s.queue = [];
    for (const x of s.shuttles) x.cargo.items = {};
    g.loot = { trainFuel: nextLegFuel(s) };
    const p = planOf(s);
    expect(p.verdict).toBe('cargo');
    expect(p.inbound[0].fuel).toBe(nextLegFuel(s));
    expect(departureAdvice(s, estimate(s).low)).toContain(`遗留轨道燃料 ${nextLegFuel(s)}`);
  });

  it('判断只读：生成提示不改变状态，也不自动召回、送燃料或派遣', () => {
    const s = scanned();
    run(s, 40);
    const before = JSON.stringify(s);
    departureAdvice(s, estimate(s).low);
    planOf(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});
