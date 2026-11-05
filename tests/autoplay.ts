// 测试用脚本玩家：只调用与界面按钮相同的操作函数。
// - expert：每 5 分钟操作，批量排产、用需求奖励精确引导、跳过无矿星、利用原住民。（最优脚本，不代表新手体验）
// - novice：每 30 分钟看一次，按界面提示粗略操作：一次只排 1 项、不使用「提前」、不跳站，逼近预警时才离站。
import * as A from '../src/sim/actions';
import { stage } from '../src/sim/catastrophe';
import { SHUTTLE_BUILD, TRAIN } from '../src/config/balance';
import { canSwap } from '../src/sim/hangar';
import { nextLegFuel, rawShortfall } from '../src/sim/objectives';
import { enrollOrder } from '../src/sim/training';
import type { GameState, RawId } from '../src/sim/types';

export interface BotOpts {
  style?: 'expert' | 'novice';
  noBonus?: boolean; // 完全不调需求奖励的被动玩家
  buildShuttle?: boolean; // 在起始星球尝试制造运输机
  keepSpare?: boolean; // 新造的公共运输机留作备用（供动态新组），不给现有小组换机
  train?: boolean; // 起始星球安排一次采掘培训（按界面名单顺序选学员）
  /** 覆盖离站判断：返回 true 时发出召回并前往下一站 */
  leaveWhen?: (s: GameState) => boolean;
}

export function botInterval(o: BotOpts): number {
  return o.style === 'novice' ? 30 : 5;
}

export function autoPlayer(s: GameState, opts: BotOpts = {}): void {
  const novice = opts.style === 'novice';
  if (s.phase === 'intro') A.startGame(s);
  if (s.phase === 'planet' && s.planet) {
    const P = s.planet;
    if (!A.canScan(s)) A.startScan(s);
    const queued = (id: string) => s.queue.filter((j) => j.recipeId === id).length;
    const need = nextLegFuel(s);
    const partsLeft = s.train.driveRepaired ? 0 : TRAIN.driveRepairParts - s.train.driveRepair;
    // 需求奖励：按「还缺」提示引导
    if (!opts.noBonus) {
      const short = rawShortfall(s);
      const want: Record<RawId, number> = { iron: 0, copper: 0, ice: 0, crystal: 0, bio: 0 };
      for (const k of Object.keys(short.parts) as RawId[]) want[k] = novice ? 3 : 4;
      for (const k of Object.keys(short.fuel) as RawId[]) want[k] = novice ? 3 : 4;
      if (s.inventory.propellant < 30 || s.inventory.ice < 15) want.ice = Math.max(want.ice, 3);
      // 想造运输机时：照着下单按钮上显示的缺项提高对应原料的奖励（新手也能看到；零件折算为铁矿 4 + 铜矿 2）
      if (opts.buildShuttle && s.journey.current === 0 && !s.shuttles.some((x) => x.builtAt >= 0) && !s.queue.some((j) => j.kind === 'shuttle')) {
        const it = SHUTTLE_BUILD.items;
        const partsGap = Math.max(0, (it.parts ?? 0) + partsLeft - s.inventory.parts);
        const gap: Partial<Record<RawId, number>> = {
          iron: (it.iron ?? 0) + partsGap * 4 - s.inventory.iron,
          copper: (it.copper ?? 0) + partsGap * 2 - s.inventory.copper,
          crystal: (it.crystal ?? 0) + need * 3 - s.inventory.crystal,
        };
        for (const k of Object.keys(gap) as RawId[]) if ((gap[k] ?? 0) > 0) want[k] = Math.max(want[k], 3);
      }
      for (const r of Object.keys(want) as RawId[]) A.setDemandBonus(s, r, want[r]);
    }
    if (!s.research.current && !A.canResearch(s, 'geneMining')) A.startResearch(s, 'geneMining');
    // 排产
    const maxQ = novice ? 3 : 12;
    const add = (id: string, n: number) => {
      if (s.queue.length >= maxQ) return;
      if (!A.canEnqueue(s, id, n)) A.enqueue(s, id, n);
      else if (n > 1 && !A.canEnqueue(s, id, 1)) A.enqueue(s, id, 1);
    };
    const shuttleExtra = opts.buildShuttle && s.journey.current === 0 && !s.shuttles.some((x) => x.builtAt >= 0) && !s.queue.some((j) => j.kind === 'shuttle') ? 5 : 0;
    const partsWant = partsLeft + shuttleExtra - s.inventory.parts - queued('parts');
    if (partsWant > 0) add('parts', novice ? 1 : Math.min(5, partsWant));
    const fuelWant = need + (novice ? 0 : 2) - s.inventory.trainFuel - queued('trainFuel');
    if (fuelWant > 0) add('trainFuel', novice ? 1 : Math.min(5, fuelWant));
    if (s.inventory.propellant + queued('propellant') * 6 < (novice ? 30 : 45)) add('propellant', 1);
    if (!A.canRepairDrive(s)) A.repairDrive(s);
    // 起始星球：尝试制造运输机，完工后分配给小组换机
    if (opts.buildShuttle && s.journey.current === 0 && s.train.driveRepaired && stage(s) === 'far' && !A.canOrderShuttle(s, null).length) {
      if (!s.shuttles.some((x) => x.builtAt >= 0 && x.ownerGroupId == null)) A.captainOrderShuttle(s);
    }
    if (opts.train && s.journey.current === 0 && !s.training.enrollments.length && !s.passengers.some((p) => p.coursesDone.includes('miningBasic'))) {
      const cands = enrollOrder(s, 'miningBasic').map((x) => x.p);
      if (cands[0]) A.enroll(s, cands[0].id, 'miningBasic');
    }
    for (const sp of opts.keepSpare ? [] : s.shuttles.filter((x) => x.assignedTo === 'spare' && x.ownerGroupId == null)) {
      const g = [...s.groups].sort((a, b) => (s.shuttles.find((x) => x.id === a.shuttleId)?.durability ?? 0) - (s.shuttles.find((x) => x.id === b.shuttleId)?.durability ?? 0))[0];
      if (g && !canSwap(s, g, sp, 'captain')) A.captainSwap(s, g.id, sp.id);
      else if (g && !A.canScheduleSwap(s, g, sp)) A.captainScheduleSwap(s, g.id, sp.id);
    }
    // 原住民
    if (P.natives.kind === 'friendly' && P.natives.contacted) {
      if (!s.research.current && !s.research.done.includes('translation') && !A.canResearch(s, 'translation')) A.startResearch(s, 'translation');
      if (!novice) for (const d of P.deposits.filter((x) => x.zone === 'permit' && x.discoveredBy != null)) if (!A.canNegotiate(s, d, 'share')) A.negotiate(s, d.id, 'share');
      if (s.inventory.trainFuel + queued('trainFuel') < need && !A.canTrade(s, 'fuel')) A.trade(s, 'fuel');
    }
    // 事件：expert 选投入较大的方案（可负担时），novice 选省事的方案；原住民矿区选分享产出，不可协商时拒绝
    for (const ev of s.events.filter((e) => e.status === 'pending' && e.nodeIndex === s.journey.current)) {
      const prefs = ev.kind === 'facility' ? (novice ? ['salvage'] : ['repair', 'salvage']) : ev.kind === 'beacon' ? (novice ? ['record'] : ['deep', 'record']) : ['share', 'decline'];
      const pick = prefs.find((o) => !A.canChoose(s, ev, o));
      if (pick) A.chooseEvent(s, ev.id, pick);
    }
    // 离站：逼近预警（或燃料与目标完成后）时召回，然后前往下一站（expert 会跳过已知无矿的星球）
    const st = stage(s);
    const ready = s.train.driveRepaired && s.inventory.trainFuel >= need;
    const leave = opts.leaveWhen ? opts.leaveWhen(s) : st === 'edge' || st === 'impact' || (ready && st === 'warn');
    if (leave) A.setRecall(s, true);
    if (s.recallActive) {
      let dest = s.journey.current + 1;
      if (!novice) {
        const n = s.journey.nodes[dest];
        if (n && n.kind === 'planet' && n.intel.startsWith('几乎没有矿物') && !A.canDepartTo(s, dest + 1)) dest += 1;
      }
      if (!A.canDepartTo(s, dest)) A.departTo(s, dest);
    }
  }
  if (s.phase === 'station') {
    if (!A.canBuy(s, 'food', 10)) A.buy(s, 'food', 10);
    if (!A.canRepairHull(s, 10)) A.repairHull(s, 10);
  }
}
