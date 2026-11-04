// 测试用脚本玩家：只调用与界面按钮相同的操作函数。
import * as A from '../src/sim/actions';
import { stage } from '../src/sim/catastrophe';
import { TRAIN } from '../src/config/balance';
import type { GameState } from '../src/sim/types';

export function autoPlayer(s: GameState, opts: { recallEarly?: boolean; noBonus?: boolean } = {}): void {
  if (s.phase === 'intro') A.startGame(s);
  if (s.phase === 'planet') {
    if (!A.canScan(s)) A.startScan(s);
    // 用需求奖励引导小组采集列车需要的原料
    const partsLeft = s.train.driveRepaired ? 0 : TRAIN.driveRepairParts - s.train.driveRepair - s.inventory.parts;
    if (!opts.noBonus) {
      A.setDemandBonus(s, 'iron', partsLeft > 0 && s.inventory.iron < partsLeft * 4 ? 4 : 0);
      A.setDemandBonus(s, 'copper', partsLeft > 0 && s.inventory.copper < partsLeft * 2 ? 4 : 0);
      A.setDemandBonus(s, 'ice', s.inventory.ice < 20 ? 3 : 0);
      A.setDemandBonus(s, 'crystal', s.inventory.trainFuel < TRAIN.fuelForDeparture && s.inventory.crystal < 30 ? 3 : 0);
    }
    if (!s.research.current) {
      if (!A.canResearch(s, 'geneMining')) A.startResearch(s, 'geneMining');
    }
    const queued = (id: string) => s.queue.filter((j) => j.recipeId === id).length;
    const partsNeed = s.train.driveRepaired ? 2 : TRAIN.driveRepairParts - s.train.driveRepair;
    if (s.inventory.parts + queued('parts') < partsNeed + 2 && !A.canEnqueue(s, 'parts')) A.enqueue(s, 'parts');
    if (s.inventory.trainFuel + queued('trainFuel') < TRAIN.fuelForDeparture && !A.canEnqueue(s, 'trainFuel')) A.enqueue(s, 'trainFuel');
    if (s.inventory.propellant + queued('propellant') * 6 < 50 && !A.canEnqueue(s, 'propellant')) A.enqueue(s, 'propellant');
    if (!A.canRepairDrive(s)) A.repairDrive(s);
    const ready = s.train.driveRepaired && s.inventory.trainFuel >= TRAIN.fuelForDeparture;
    const st = stage(s);
    if ((opts.recallEarly && ready) || st === 'edge' || st === 'impact') A.setRecall(s, true);
    if (s.recallActive && !A.canDepart(s)) A.depart(s);
  }
  if (s.phase === 'station') {
    if (!A.canBuy(s, 'food', 10)) A.buy(s, 'food', 10);
    if (!A.canRepairHull(s, 10)) A.repairHull(s, 10);
  }
}
