// 模拟主循环：固定步长 1 游戏分钟。加速只增加步数，不放大单步，因此不会重复结算。

import { STATION } from '../config/balance';
import { tickCatastrophe } from './catastrophe';
import { tickClaims } from './claims';
import { tickJourney } from './journey';
import { tickTraining } from './training';
import { tickPermits } from './natives';
import { tryFormNewGroup } from './groups';
import { tickGroups } from './groupAI';
import { tickMoodHourly, tickPeopleHourly, tickResources } from './survival';
import { tickDriveRepair, tickProcessing, tickResearch, tickScan } from './train';
import type { GameState } from './types';

export function step(s: GameState): void {
  if (s.phase === 'intro' || s.phase === 'failed') return;
  s.time += 1;
  tickResources(s);
  tickProcessing(s);
  tickDriveRepair(s);
  tickResearch(s);
  tickTraining(s); // 列车内的培训在星球、航行与停泊期间都可进行
  if (s.phase === 'planet') {
    tickScan(s);
    tickClaims(s);
    tickPermits(s);
    tickGroups(s);
    tickCatastrophe(s);
  } else if (s.phase === 'travel') {
    tickJourney(s);
    tickCatastrophe(s);
    tickGroups(s);
  } else if (s.phase === 'station') {
    tickStation(s);
    tickGroups(s);
  }
  // 每 10 分钟检查是否能自动成立新小组（需有公共备用机与足够的空闲合格人员）
  if (s.time % 10 === 0) tryFormNewGroup(s);
  if (s.time % 60 === 0) {
    tickPeopleHourly(s);
    tickMoodHourly(s);
  }
  if (s.toasts.length > 20) s.toasts.splice(0, s.toasts.length - 20);
}

function tickStation(s: GameState): void {
  // 灾变追赶进度在站内冻结（不增长、不清零）
  if ((s.time - s.station.arrivalTime) % 60 === 0) {
    if (s.credits >= STATION.hourlyFee) s.credits -= STATION.hourlyFee;
    else s.inventory.energy = Math.max(0, s.inventory.energy - STATION.hourlyFee * 10);
  }
}
