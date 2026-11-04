// 交付结算、贡献点、小组自主购买（运输机升级 / 基因强化）

import { GENE, RAW_BASE_PRICE, SHUTTLE_UPGRADES, TRAIN, type UpgradeSpec } from '../config/balance';
import { ITEM_INFO } from '../config/content';
import { consume, costText, fmt, groupShuttle, log, members, missingItems, newId } from './core';
import { decide, leaderPersonality } from './groups';
import { hasQualifiedMedic } from './staff';
import type { GameState, Group, Passenger, RawId, Shuttle } from './types';

export function unitPrice(s: GameState, r: RawId): number {
  return RAW_BASE_PRICE[r] + s.demandBonus[r];
}

/**
 * 交付结算：货物从运输机货舱转入列车库存，按（基础收购价 + 当前需求奖励）计贡献点。
 * 每个批次只结算一次：结算后批次标记为已结算并换新空批次。
 */
export function settleCargo(s: GameState, g: Group, sh: Shuttle): number {
  const batch = sh.cargo;
  if (batch.settled) return 0;
  let points = 0;
  const parts: string[] = [];
  for (const r of Object.keys(batch.items) as RawId[]) {
    const q = Math.floor((batch.items[r] ?? 0) * 100) / 100;
    if (q <= 0) continue;
    s.inventory[r] += q;
    const pts = q * unitPrice(s, r);
    points += pts;
    s.stats.rawDelivered[r] = (s.stats.rawDelivered[r] ?? 0) + q;
    parts.push(`${ITEM_INFO[r].label} ${fmt(q)}`);
  }
  batch.settled = true;
  if (points > 0) g.exploreStreak = 0;
  sh.cargo = { id: newId(s), items: {}, settled: false };
  if (points > 0) {
    points = Math.round(points * 10) / 10;
    g.points += points;
    g.pointsEarned += points;
    s.pointsIssued += points;
    s.stats.deliveries++;
    if (s.planet) s.planet.deliveries++;
    log(s, 'economy', `${g.name}交付 ${parts.join('、')}，获得贡献点 ${fmt(points, 1)}（批次 #${batch.id}）`);
  }
  return points;
}

export interface PurchaseOption {
  kind: 'upgrade' | 'gene';
  id: string;
  label: string;
  points: number;
  score: number;
  blocked: string; // 不可购买原因，空表示可买
  why: string;
  targetId?: number;
}

export function geneEligibility(s: GameState, p: Passenger): string {
  if (p.genes.length >= GENE.loadLimit) return '序列承载已满';
  if (p.compatibility < GENE.minCompatibility) return `身体适配度 ${p.compatibility} 低于 ${GENE.minCompatibility}`;
  if (p.health < GENE.minHealth) return `健康 ${fmt(p.health)} 低于 ${GENE.minHealth}`;
  if (p.fatigue > GENE.maxFatigue) return `疲劳 ${fmt(p.fatigue)} 高于 ${GENE.maxFatigue}`;
  if (p.recoveringUntil > s.time) return '正在恢复';
  return '';
}

/** 基因强化的列车侧条件（研究、医疗、库存） */
export function geneTrainBlock(s: GameState): string {
  if (!s.research.done.includes(GENE.requiresResearch)) return '尚未完成研究「采掘适应序列解析」';
  if (!hasQualifiedMedic(s)) return '没有达到医疗技能门槛的在岗医护';
  const miss = missingItems(s.inventory, GENE.items);
  if (miss.length) return `列车库存不足：${miss.join('、')}`;
  return '';
}

function partsReserveBlock(s: GameState, u: UpgradeSpec): string {
  const need = u.items.parts ?? 0;
  if (!need) return '';
  if (s.policies.reservePartsForDrive && !s.train.driveRepaired) {
    const reserve = TRAIN.driveRepairParts - s.train.driveRepair;
    if (s.inventory.parts - need < reserve) return `列车政策：维修零件优先用于主驱动（需保留 ${reserve} 件）`;
  }
  return '';
}

export function purchaseOptions(s: GameState, g: Group): PurchaseOption[] {
  const sh = groupShuttle(s, g);
  const bold = leaderPersonality(s, g) === 'bold';
  const opts: PurchaseOption[] = [];
  if (sh) {
    for (const u of SHUTTLE_UPGRADES) {
      if (sh.upgrades.includes(u.id)) continue;
      let score = 1;
      let why = '';
      if (u.id === 'cargoBay') {
        score += g.lastCargoFullRatio > 0.9 ? 1.6 : 0.3;
        score += bold ? 0 : 0.6;
        why = g.lastCargoFullRatio > 0.9 ? '近期货舱总是装满，扩容能减少往返' : '组长稳健，倾向先提升运输机可靠产出';
      } else {
        score += sh.model === 'miner' ? 0.8 : 0.2;
        score += bold ? 0.2 : 0.5;
        why = sh.model === 'miner' ? '采集型运输机配强化钻头收益最高' : '缩短每趟采矿时间';
      }
      const miss = missingItems(s.inventory, u.items);
      const blocked =
        g.points < u.points
          ? `贡献点不足（需 ${u.points}，有 ${fmt(g.points, 1)}）`
          : miss.length
            ? `列车库存不足：${miss.join('、')}`
            : partsReserveBlock(s, u);
      opts.push({ kind: 'upgrade', id: u.id, label: `运输机${u.label}`, points: u.points, score, blocked, why });
    }
  }
  // 基因强化：选出组内适配度最高且合格的成员
  const ms = members(s, g)
    .filter((p) => !geneEligibility(s, p))
    .sort((a, b) => (b.profession === 'miner' ? 10 : 0) + b.compatibility - ((a.profession === 'miner' ? 10 : 0) + a.compatibility));
  const target = ms[0];
  if (target || members(s, g).length) {
    let score = 1.2 + (bold ? 1.4 : 0.2) + (target?.profession === 'miner' ? 0.4 : 0);
    const trainBlock = geneTrainBlock(s);
    const blocked = !target
      ? '组内暂无适配成员'
      : trainBlock
        ? trainBlock
        : g.points < GENE.points
          ? `贡献点不足（需 ${GENE.points}，有 ${fmt(g.points, 1)}）`
          : '';
    if (s.research.done.includes(GENE.requiresResearch)) score += 0.3;
    opts.push({
      kind: 'gene',
      id: GENE.id,
      label: `${GENE.label}${target ? `（${target.name}）` : ''}`,
      points: GENE.points,
      score,
      blocked,
      why: bold ? '组长进取，看重成员长期能力' : '提高组员采掘效率',
      targetId: target?.id,
    });
  }
  return opts.sort((a, b) => b.score - a.score);
}

/** 小组自主决定支出，不需要玩家批准。返回是否购买了东西。 */
export function groupConsiderPurchases(s: GameState, g: Group): boolean {
  const opts = purchaseOptions(s, g);
  if (!opts.length) return false;
  const buyable = opts.filter((o) => !o.blocked);
  if (!buyable.length) return false;
  const top = buyable[0];
  // 如果更想要的选项只差贡献点，则存点不买次优项
  const preferred = opts[0];
  if (preferred !== top && preferred.blocked.startsWith('贡献点不足') && preferred.score - top.score > 0.6) {
    const t = `存贡献点：目标「${preferred.label}」（${preferred.blocked}）`;
    if (g.decisions[0]?.text !== t) decide(s, g, t);
    return false;
  }
  const others = opts.filter((o) => o !== top).map((o) => o.label);
  if (top.kind === 'upgrade') {
    const sh = groupShuttle(s, g)!;
    const u = SHUTTLE_UPGRADES.find((x) => x.id === top.id)!;
    consume(s.inventory, u.items);
    g.points -= u.points;
    g.pointsSpent += u.points;
    sh.upgrades.push(u.id);
    sh.level += 1;
    g.purchases.push(u.label);
    s.stats.upgrades++;
    decide(s, g, `购买${top.label}（${u.desc}）：花费 ${u.points} 贡献点 + 列车库存 ${costText(u.items)}。理由：${top.why}${others.length ? `；暂不选 ${others.join('、')}` : ''}`);
  } else {
    const p = s.passengers.find((x) => x.id === top.targetId)!;
    consume(s.inventory, GENE.items);
    g.points -= GENE.points;
    g.pointsSpent += GENE.points;
    p.genes.push(GENE.id);
    p.skills.mining += GENE.miningBonus;
    p.health = Math.max(5, p.health - 6);
    p.recoveringUntil = s.time + GENE.recovery;
    g.purchases.push(`${GENE.label}·${p.name}`);
    s.stats.genes++;
    decide(
      s,
      g,
      `为 ${p.name} 进行${GENE.label}（适配度 ${p.compatibility}）：花费 ${GENE.points} 贡献点 + 列车库存 ${costText(GENE.items)}，恢复期 ${GENE.recovery} 分钟。理由：${top.why}${others.length ? `；暂不选 ${others.join('、')}` : ''}`,
    );
  }
  return true;
}
