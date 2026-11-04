// 可交流原住民：物资交易与协商采矿许可（不涉及战斗）

import { ITEM_INFO } from '../config/content';
import { add, consume, costText, log, missingItems } from './core';
import type { GameState, NativeTrade } from './types';

function friendly(s: GameState): string {
  const N = s.planet?.natives;
  if (s.phase !== 'planet' || !N || N.kind !== 'friendly') return '这颗星球没有可交流的原住民';
  if (!N.contacted) return `尚未与${N.name}建立联系（需小组先调查「人工信号」）`;
  return '';
}

export function canTrade(s: GameState, id: string): string {
  const f = friendly(s);
  if (f) return f;
  const t = s.planet!.natives.trades.find((x) => x.id === id);
  if (!t) return '无此交易';
  if (t.stock <= 0) return '对方已没有可交换的存货';
  const miss = missingItems(s.inventory, t.give);
  return miss.length ? `库存不足：${miss.join('、')}` : '';
}

export function trade(s: GameState, id: string): void {
  if (canTrade(s, id)) return;
  const N = s.planet!.natives;
  const t = N.trades.find((x) => x.id === id)!;
  consume(s.inventory, t.give);
  add(s.inventory, t.get);
  t.stock -= 1;
  log(s, 'station', `与${N.name}交易：付出 ${costText(t.give)}，换得 ${costText(t.get)}（对方剩余 ${t.stock} 次）。`);
}

export function canPermit(s: GameState): string {
  const f = friendly(s);
  if (f) return f;
  const N = s.planet!.natives;
  if (N.permitGranted) return '已取得采矿许可';
  const miss = missingItems(s.inventory, N.permitCost);
  return miss.length ? `库存不足：${miss.join('、')}` : '';
}

export function grantPermit(s: GameState): void {
  if (canPermit(s)) return;
  const N = s.planet!.natives;
  consume(s.inventory, N.permitCost);
  N.permitGranted = true;
  log(s, 'station', `与${N.name}协商成功：付出 ${costText(N.permitCost)}，取得领地内的采矿许可。小组可以前往领地内的矿点作业。`);
}

export function tradeText(t: NativeTrade): string {
  const f = (o: NativeTrade['give']) => Object.entries(o).map(([k, v]) => `${ITEM_INFO[k as keyof typeof ITEM_INFO].label} ${v}`).join('、');
  return `${f(t.give)} → ${f(t.get)}`;
}
