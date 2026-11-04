// 模拟主循环：固定步长 1 游戏分钟。加速只增加步数，不放大单步，因此不会重复结算。

import { STATION, CATASTROPHE } from '../config/balance';
import { log } from './core';
import { tickCatastrophe } from './catastrophe';
import { tickClaims } from './claims';
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
  if (s.phase === 'planet') {
    tickScan(s);
    tickClaims(s);
    tickGroups(s);
    tickCatastrophe(s);
  } else if (s.phase === 'travel') {
    tickTravel(s);
    tickGroups(s);
  } else if (s.phase === 'station') {
    tickStation(s);
    tickGroups(s);
  }
  if (s.time % 60 === 0) {
    tickPeopleHourly(s);
    tickMoodHourly(s);
  }
  if (s.toasts.length > 20) s.toasts.splice(0, s.toasts.length - 20);
}

function tickTravel(s: GameState): void {
  const t = s.travel!;
  t.progress += 1;
  s.catastrophe.chase = Math.min(100, s.catastrophe.chase + CATASTROPHE.chasePerMinTravel);
  if (t.progress >= t.duration) arriveStation(s);
}

function arriveStation(s: GameState): void {
  s.phase = 'station';
  s.travel = null;
  s.station.docked = true;
  s.station.arrivalTime = s.time;
  if (s.credits >= STATION.dockingFee) {
    s.credits -= STATION.dockingFee;
    s.station.feePaid = true;
    log(s, 'station', `抵达${STATION.name}。支付停泊费 ${STATION.dockingFee} 星币。站内禁止暴力，私人武装机器人已封存。灾变追赶进度暂停。`);
  } else {
    s.inventory.energy = Math.max(0, s.inventory.energy - STATION.dockingFee * 10);
    s.station.feePaid = true;
    log(s, 'station', `抵达${STATION.name}。星币不足，以 ${STATION.dockingFee * 10} kWh 能源抵付停泊费。灾变追赶进度暂停。`);
  }
  s.boosts.push({ label: '抵达交易站', until: s.time + 720, morale: 10 });
  s.toasts.push({ t: s.time, title: `抵达${STATION.name}`, text: '可以买卖、补给与维修。完成一次补给或维修后可查看阶段总结。' });
  s.paused = true;
}

function tickStation(s: GameState): void {
  // 灾变追赶进度在站内冻结（不增长、不清零）
  if ((s.time - s.station.arrivalTime) % 60 === 0) {
    if (s.credits >= STATION.hourlyFee) s.credits -= STATION.hourlyFee;
    else s.inventory.energy = Math.max(0, s.inventory.energy - STATION.hourlyFee * 10);
  }
}
