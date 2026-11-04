// 测试辅助：把当前状态还原成旧版本存档的数据形状（v1 / v2），用于验证迁移。
import type { GameState } from '../src/sim/types';

export function toLegacy(s: GameState, version: 1 | 2, trueArrival = 960): string {
  const o = JSON.parse(JSON.stringify(s));
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
