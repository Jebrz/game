// 原住民：每颗星球独立的关系、物资交易与采矿许可协议（不涉及战斗）
//
// - 态度：尚未接触 / 可交流 / 合作（关系 ≥ 30）/ 警惕（关系 ≤ -30）/ 敌对（敌对势力固定）。
// - 关系只因具体行为变化：初次接触、公平交易、按约支付许可、按约分享产出；每次变化都记录原因。
// - 未研究「基础图形语言翻译」时只能以物易物；协商采矿许可需要翻译。
// - 采矿许可限定矿点、有效期与开采上限；小组只在有效许可内作业，不会自动越界。

import { ITEM_INFO } from '../config/content';
import { PERMIT, RELATION } from '../config/balance';
import { add, consume, costText, fmtTime, log, missingItems, newId } from './core';
import type { Deposit, GameState, NativeTrade, NativesState, Permit } from './types';

export type Attitude = 'none' | 'unknown' | 'communicable' | 'cooperative' | 'wary' | 'hostile';

export const ATTITUDE_LABEL: Record<Attitude, string> = {
  none: '无原住民',
  unknown: '尚未接触',
  communicable: '可交流',
  cooperative: '合作',
  wary: '警惕',
  hostile: '敌对',
};

export function attitude(N: NativesState): Attitude {
  if (N.kind === 'none') return 'none';
  if (N.kind === 'hostile') return 'hostile';
  if (!N.contacted) return 'unknown';
  if (N.relation >= RELATION.cooperativeAt) return 'cooperative';
  if (N.relation <= RELATION.waryAt) return 'wary';
  return 'communicable';
}

export function hasTranslation(s: GameState): boolean {
  return s.research.done.includes('translation');
}

export function changeRelation(s: GameState, delta: number, reason: string): void {
  const N = s.planet?.natives;
  if (!N || N.kind !== 'friendly' || !delta) return;
  const before = attitude(N);
  N.relation = Math.max(-100, Math.min(100, N.relation + delta));
  N.relationLog.unshift({ t: s.time, delta, reason });
  if (N.relationLog.length > 12) N.relationLog.length = 12;
  const after = attitude(N);
  log(s, 'station', `与${N.name}的关系 ${delta > 0 ? '+' : ''}${delta}（${reason}），当前 ${N.relation}，态度：${ATTITUDE_LABEL[after]}${after !== before ? '（变化）' : ''}。`);
}

function friendly(s: GameState): string {
  const N = s.planet?.natives;
  if (s.phase !== 'planet' || !N || N.kind !== 'friendly') return '这颗星球没有可交流的原住民';
  if (!N.contacted) return `尚未与${N.name}建立联系（需小组先调查「人工信号」）`;
  return '';
}

// ---------------- 交易（以物易物，不需要翻译） ----------------

export function canTrade(s: GameState, id: string): string {
  const f = friendly(s);
  if (f) return f;
  const N = s.planet!.natives;
  if (attitude(N) === 'wary') return `${N.name}态度警惕，暂不交易`;
  const t = N.trades.find((x) => x.id === id);
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
  changeRelation(s, RELATION.trade, '公平交易');
}

export function tradeText(t: NativeTrade): string {
  const f = (o: NativeTrade['give']) => Object.entries(o).map(([k, v]) => `${ITEM_INFO[k as keyof typeof ITEM_INFO].label} ${v}`).join('、');
  return `${f(t.give)} → ${f(t.get)}`;
}

// ---------------- 采矿许可 ----------------

export function activePermit(s: GameState, dep: Deposit): Permit | null {
  const N = s.planet?.natives;
  if (!N) return null;
  return N.permits.find((p) => p.depositId === dep.id && p.expiresAt > s.time && p.extracted < p.cap) ?? null;
}

/** 小组能否在该矿点作业（空字符串表示可以） */
export function depositAccess(s: GameState, dep: Deposit): string {
  if (dep.zone === 'open') return '';
  const N = s.planet!.natives;
  if (dep.zone === 'hostile') return `${dep.name}位于${N.name}禁区`;
  if (N.permitGranted) return ''; // 旧存档的整片领地许可
  if (activePermit(s, dep)) return '';
  const old = N.permits.find((p) => p.depositId === dep.id);
  if (old) return `${dep.name}的许可已${old.expiresAt <= s.time ? '到期' : '用完开采额度'}，需要重新协商`;
  return `${dep.name}在${N.name}领地内，需要采矿许可`;
}

export function permitTerms(s: GameState, kind: 'pay' | 'share'): { cost: Partial<Record<keyof typeof ITEM_INFO, number>>; pct: number; cap: number; duration: number } {
  const coop = s.planet && attitude(s.planet.natives) === 'cooperative';
  if (kind === 'pay') {
    const cost = { ...PERMIT.payCost };
    if (coop && cost.food) cost.food = Math.ceil(cost.food * PERMIT.cooperative.payFoodMult);
    return { cost, pct: 0, cap: PERMIT.payCap, duration: PERMIT.duration };
  }
  return { cost: {}, pct: coop ? PERMIT.cooperative.sharePct : PERMIT.sharePct, cap: PERMIT.shareCap, duration: PERMIT.duration };
}

export function canNegotiate(s: GameState, dep: Deposit, kind: 'pay' | 'share'): string {
  const f = friendly(s);
  if (f) return f;
  const N = s.planet!.natives;
  if (dep.zone !== 'permit') return '该矿点不需要许可';
  if (!hasTranslation(s)) return '需要先完成研究「基础图形语言翻译」才能协商条款（目前只能以物易物）';
  if (attitude(N) === 'wary') return `${N.name}态度警惕，拒绝新的协议`;
  if (activePermit(s, dep)) return '已有有效许可';
  if (kind === 'pay') {
    const miss = missingItems(s.inventory, permitTerms(s, 'pay').cost);
    if (miss.length) return `库存不足：${miss.join('、')}`;
  }
  return '';
}

export function grantPermit(s: GameState, dep: Deposit, kind: 'pay' | 'share'): Permit | null {
  if (canNegotiate(s, dep, kind)) return null;
  const N = s.planet!.natives;
  const t = permitTerms(s, kind);
  if (kind === 'pay') consume(s.inventory, t.cost);
  const p: Permit = {
    id: newId(s),
    depositId: dep.id,
    kind,
    sharePct: t.pct,
    grantedAt: s.time,
    expiresAt: s.time + t.duration,
    cap: t.cap,
    extracted: 0,
    paid: kind === 'pay' ? { ...t.cost } : {},
  };
  N.permits.push(p);
  log(
    s,
    'station',
    `与${N.name}签订${dep.name}采矿许可：${kind === 'pay' ? `支付 ${costText(t.cost)}` : `交出该矿点产出的 ${Math.round(t.pct * 100)}%`}；有效 ${fmtTime(t.duration)}，最多开采 ${t.cap} 单位。`,
  );
  if (kind === 'pay') changeRelation(s, RELATION.permitPaid, '按约支付许可物资');
  return p;
}

/** 每分钟：到期的许可记录日志（只记录一次） */
export function tickPermits(s: GameState): void {
  const N = s.planet?.natives;
  if (!N || N.kind !== 'friendly') return;
  for (const p of N.permits) {
    if (p.expiresAt === s.time) {
      const dep = s.planet!.deposits.find((d) => d.id === p.depositId);
      log(s, 'station', `${dep?.name ?? '矿点'}的采矿许可到期（已开采 ${Math.round(p.extracted)}/${p.cap}）。小组将停止在该处作业。`);
    }
  }
}
