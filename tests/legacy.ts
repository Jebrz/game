// 测试辅助：把当前状态还原成旧版本存档的数据形状（v1 / v2），用于验证迁移。
import type { GameState } from '../src/sim/types';

export function toLegacy(s: GameState, version: 1 | 2 | 3 | 4 | 5, trueArrival = 960): string {
  const o = JSON.parse(JSON.stringify(s));
  // v6 新增：资格、课程、年龄、组内名额、培训状态
  if (o.training?.enrollments?.length) throw new Error('旧版本没有培训');
  delete o.training;
  for (const p of o.passengers) for (const k of ['age', 'quals', 'coursesDone', 'courseProgress', 'coursePaid']) delete p[k];
  for (const g of o.groups) delete g.memberRoles;
  o.queue = o.queue.filter((j: { kind: string }) => j.kind !== 'training');
  if (version === 5) {
    o.version = 5;
    return JSON.stringify({ version: 5, savedAt: '', gameTime: s.time, state: o });
  }
  // v5 新增：事件、原住民关系与许可、货舱分享、事件地点
  delete o.events;
  for (const sh of o.shuttles) delete sh.cargo.owed;
  for (const P of [o.planet, ...o.journey.nodes.map((n: { planet: unknown }) => n.planet)]) {
    if (!P) continue;
    for (const k of ['relation', 'relationLog', 'permits', 'sharePaid']) delete P.natives[k];
    for (const sg of P.signs) {
      delete sg.eventKind;
      delete sg.eventRolls;
    }
  }
  for (const g of o.groups) if (g.state === 'toEvent' || g.state === 'eventWork') throw new Error('旧版本没有事件状态');
  if (version === 4) {
    o.version = 4;
    return JSON.stringify({ version: 4, savedAt: '', gameTime: s.time, state: o });
  }
  // v4 新增：按星球交付计数、小组连续探索计数、新组提示
  delete o.formationNote;
  for (const g of o.groups) delete g.exploreStreak;
  for (const P of [o.planet, ...o.journey.nodes.map((n: { planet: unknown }) => n.planet)]) if (P) delete (P as Record<string, unknown>).deliveries;
  if (version === 3) {
    o.version = 3;
    return JSON.stringify({ version: 3, savedAt: '', gameTime: s.time, state: o });
  }
  // v3 新增：航线、灾变前锋、星球画像/原住民、迹象与矿点扩展字段、小组遗留物资、研究储备
  const P = o.planet ?? o.journey.nodes[o.journey.current].planet;
  delete o.journey;
  o.catastrophe = { trueArrival, bias: 10, warned: false, edgeWarned: false, arrived: false, chase: 0 };
  if (o.travel) o.travel = { progress: o.travel.progress, duration: 240 };
  if (P) {
    delete P.resourceProfile;
    delete P.natives;
    delete P.warned;
    delete P.edgeWarned;
    for (const sg of P.signs) for (const k of ['kind', 'restricted', 'loot', 'research', 'lootTaken']) delete sg[k];
    for (const d of P.deposits) delete d.zone;
    o.planet = P; // 旧版离站后仍保留 planet
  }
  for (const g of o.groups) {
    delete g.loot;
    delete g.lootResearch;
  }
  delete o.research.bank;
  o.version = version;
  if (version === 1) {
    delete o.hangar;
    delete o.shuttleSerial;
    for (const sh of o.shuttles) {
      delete sh.serial;
      delete sh.ownerGroupId;
      delete sh.builtAt;
    }
    o.queue = o.queue.map((j: Record<string, unknown>) => ({ id: j.id, recipeId: j.recipeId, remaining: j.remaining, total: j.total, started: j.started }));
  }
  return JSON.stringify({ version, savedAt: '', gameTime: s.time, state: o });
}
