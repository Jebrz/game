// 小组自主行动状态机
// 每个状态一个处理函数；决策（选择目标）与执行分离。

import { GROUPS, SHUTTLE_MAINT, SHUTTLE_MODELS } from '../config/balance';
import { EVENTS, ITEM_INFO } from '../config/content';
import { estimate, stage } from './catastrophe';
import { findDeposit, freeSlots, heldSlot, releaseAllOf, reserveForDelivery, tryClaim, release } from './claims';
import { clamp, dist, fmt, fmtTime, groupShuttle, log, members, rand } from './core';
import { groupConsiderPurchases, settleCargo, unitPrice } from './economy';
import { groupConsiderShuttle } from './hangar';
import { rawShortfall } from './objectives';
import { decide, isHome, leaderPersonality, reformGroups, setState } from './groups';
import { cargoCap, cargoUsed, exploreTime, fuelPerKm, mineRate, speed, tank } from './shuttles';
import type { Deposit, GameState, Group, RawId, Shuttle, Sign } from './types';

const IDLE_FUEL_PER_MIN = 0.03;
const SAFETY_FUEL = 1.5;
const PROPELLANT_ALERT = 30; // 列车推进剂低于此值时小组优先考虑冰晶（原型参数）

export function tickGroups(s: GameState): void {
  for (const g of s.groups) tickGroup(s, g);
}

function tickGroup(s: GameState, g: Group): void {
  const sh = groupShuttle(s, g);
  switch (g.state) {
    case 'docked':
    case 'grounded':
      return tickHome(s, g);
    case 'resting':
      return tickResting(s, g);
    case 'toExplore':
    case 'toSite':
    case 'returning':
      if (sh) tickTravel(s, g, sh);
      return;
    case 'exploring':
      if (sh) tickExploring(s, g, sh);
      return;
    case 'waitingSlot':
      if (sh) tickWaiting(s, g, sh);
      return;
    case 'deploying':
      if (sh) tickDeploying(s, g, sh);
      return;
    case 'mining':
      if (sh) tickMining(s, g, sh);
      return;
    case 'unloading':
      if (sh) tickUnloading(s, g, sh);
      return;
  }
}

// ---------- 在列车上 ----------

function tickHome(s: GameState, g: Group): void {
  g.timer -= 1;
  if (g.timer > 0) return;
  g.timer = 10; // 默认 10 分钟后再评估
  if (g.pendingReform) reformGroups(s);
  thinkAtTrain(s, g);
}

function tickResting(s: GameState, g: Group): void {
  const ms = members(s, g);
  const avg = ms.reduce((a, p) => a + p.fatigue, 0) / Math.max(1, ms.length);
  g.status = `休整中（平均疲劳 ${fmt(avg)}）`;
  if (avg <= GROUPS.restDoneFatigue && ms.every((p) => p.health >= GROUPS.minHealthToSortie)) {
    setState(s, g, 'docked', '休整完毕，待命');
    g.timer = 1;
  }
}

function blockAtTrain(s: GameState, g: Group, sh: Shuttle | null): string {
  if (s.phase !== 'planet') return s.phase === 'travel' ? '列车航行中，随车待命' : '列车停泊中，随车待命';
  if (!g.memberIds.length) return g.missing.length ? `编组不足：缺少 ${g.missing.join('、')}` : '无成员';
  if (!sh) return '没有主运输机可用（已被列车长配属或等待换装）';
  if (s.recallActive) return '召回令生效，留守列车';
  if (!s.planet?.scanned) return '等待列车扫描结果';
  const st = stage(s);
  if (st === 'edge' || st === 'impact') return '灾变临近，不再出勤';
  const rec = members(s, g).filter((p) => p.recoveringUntil > s.time);
  if (rec.length) {
    const left = Math.max(...rec.map((p) => p.recoveringUntil - s.time));
    return `等待成员基因强化恢复（剩余 ${fmtTime(left)}）`;
  }
  if (sh.durability < SHUTTLE_MAINT.groundedBelow) return `运输机耐久 ${fmt(sh.durability)} 过低，等待维修零件`;
  return '';
}

function thinkAtTrain(s: GameState, g: Group): void {
  // 先处理运输机：领取/换装本组新机，或在确有需要时自主订购（小组自主决定，不需审批）
  if (g.memberIds.length) groupConsiderShuttle(s, g);
  const sh = groupShuttle(s, g);
  // 有贡献点时再考虑其他支出
  if (g.memberIds.length) groupConsiderPurchases(s, g);
  const block = blockAtTrain(s, g, sh);
  if (block) {
    if (g.state !== 'grounded' || g.status !== block) setState(s, g, 'grounded', block);
    return;
  }
  const ms = members(s, g);
  const avgFat = ms.reduce((a, p) => a + p.fatigue, 0) / ms.length;
  if (avgFat > GROUPS.restFatigue || ms.some((p) => p.health < GROUPS.minHealthToSortie)) {
    setState(s, g, 'resting', '休整中');
    decide(s, g, avgFat > GROUPS.restFatigue ? `平均疲劳 ${fmt(avgFat)}，先休整再出勤` : '有成员健康不佳，休整治疗');
    return;
  }
  const choice = chooseTarget(s, g, sh!, s.planet!.trainX, s.planet!.trainY, true);
  if (!choice) {
    setState(s, g, 'docked', '暂无合适目标，待命', g.reason);
    return;
  }
  if (choice.blocked) {
    setState(s, g, 'grounded', choice.blocked);
    if (g.decisions[0]?.text !== choice.blocked) decide(s, g, choice.blocked);
    return;
  }
  // 出发：列车承担基本任务的推进剂补给（库存不足时只补到现有量）；超出基本半径由小组额度支付
  const refill = Math.min(tank(sh!) - sh!.fuel, s.inventory.propellant);
  s.inventory.propellant -= refill;
  sh!.fuel += refill;
  if (choice.extraCost > 0) {
    g.points -= choice.extraCost;
    g.pointsSpent += choice.extraCost;
  }
  depart(s, g, sh!, choice);
}

function depart(s: GameState, g: Group, sh: Shuttle, c: Choice): void {
  for (const p of members(s, g)) p.aboard = false;
  sh.docked = false;
  g.recalled = false;
  g.target = c.kind === 'explore' ? { kind: 'explore', signId: c.sign!.id } : { kind: 'mine', depositId: c.deposit!.id };
  if (c.kind === 'explore') {
    c.sign!.exploringGroupId = g.id;
    g.exploreStreak += 1;
    setState(s, g, 'toExplore', `前往探索${c.sign!.label}`);
  } else {
    setState(s, g, 'toSite', `前往${c.deposit!.name}`);
  }
  decide(s, g, c.why);
}

// ---------- 目标选择 ----------

interface Choice {
  kind: 'explore' | 'mine';
  sign?: Sign;
  deposit?: Deposit;
  score: number;
  why: string;
  extraCost: number;
  blocked: string;
  dist: number;
  notes?: string[]; // 评分时得出的具体理由
}

/**
 * 综合收益、航程、燃料、运载空间、成员能力、风险与组长性格选择目标。
 * atTrain=true 时以满油计算（出发前补给）；野外时用当前油量。
 */
function chooseTarget(s: GameState, g: Group, sh: Shuttle, ox: number, oy: number, atTrain: boolean, exclude?: number): Choice | null {
  const P = s.planet!;
  const bold = leaderPersonality(s, g) === 'bold';
  const spd = speed(sh);
  const fpk = fuelPerKm(sh);
  const fuelAvail = atTrain ? Math.min(tank(sh), sh.fuel + s.inventory.propellant) : sh.fuel;
  const fuelLow = s.inventory.propellant < PROPELLANT_ALERT;
  const free = cargoCap(sh) - cargoUsed(sh);
  const est = estimate(s);
  const margin = bold ? 15 : 45;
  const timeLimit = stage(s) === 'warn' ? est.low - margin : Infinity;
  const cands: Choice[] = [];
  const rejected: string[] = [];

  const fuelOk = (tx: number, ty: number, extra: number): boolean => {
    const need = (dist(ox, oy, tx, ty) + dist(tx, ty, P.trainX, P.trainY)) * fpk + extra * IDLE_FUEL_PER_MIN + SAFETY_FUEL;
    return need <= fuelAvail;
  };
  const riskPenalty = (h: number) => h * (bold ? 0.6 : 2.2);
  const needs = trainNeeds(s);
  // 某种资源是否已有可用的已知矿点（已发现、有储量、可进入、有空位或本组保留）
  const knownAvail = (r: RawId): Deposit | undefined =>
    P.deposits.find(
      (d) =>
        d.resource === r &&
        d.discoveredBy != null &&
        d.reserve > 0 &&
        d.zone !== 'hostile' &&
        !(d.zone === 'permit' && !P.natives.permitGranted) &&
        (freeSlots(d) > 0 || heldSlot(d, g.id)),
    );

  // 探索候选（价值 = 信息价值：已知同类可用矿点时大幅降低；列车需要且尚无已知矿点时提高）
  for (const sign of P.signs) {
    if (!sign.revealed || sign.explored) continue;
    if (sign.exploringGroupId != null && sign.exploringGroupId !== g.id) continue;
    if (sign.restricted) {
      rejected.push(`${sign.label}位于${P.natives.name}禁区`);
      continue;
    }
    const d = dist(ox, oy, sign.x, sign.y);
    const back = dist(sign.x, sign.y, P.trainX, P.trainY);
    const et = exploreTime(s, g, sh);
    const t = (d + back) / spd + et;
    if (!fuelOk(sign.x, sign.y, et)) {
      rejected.push(`${sign.label}航程超出油量`);
      continue;
    }
    if (t > timeLimit) {
      rejected.push(`${sign.label}往返 ${fmtTime(t)} 超过灾变安全时限`);
      continue;
    }
    const notes: string[] = [];
    let info: number;
    if (sign.kind === 'resource') {
      const label = ITEM_INFO[sign.guess].label;
      info = 30 + 15 * Math.min(5, unitPrice(s, sign.guess)); // 单价封顶，避免样本类迹象价值虚高
      const known = knownAvail(sign.guess);
      if (known) {
        info *= 0.35;
        notes.push(`已知${known.name}可采${label}，探索价值较低`);
      } else if (needs.has(sign.guess)) {
        info *= 1.4;
        notes.push(`尚未发现可用的${label}矿点，而列车需要${label}（${needs.get(sign.guess)}）`);
      } else notes.push(`尚未发现可用的${label}矿点`);
    } else if (sign.kind === 'natives') {
      info = 90;
      notes.push('人工信号可能是原住民聚落');
    } else {
      info = 80;
      notes.push('异常信号可能有遗留物资');
    }
    if (fuelLow) {
      info *= 0.6;
      notes.push('推进剂紧张，探索带不回原料');
    }
    if (g.exploreStreak >= 2) {
      info *= Math.pow(0.6, g.exploreStreak - 1);
      notes.push(`已连续探索 ${g.exploreStreak} 处未带回原料`);
    }
    let score = info / t;
    if (sh.model === 'scout') score *= 1.3;
    score *= bold ? 1.15 : 0.9;
    score *= 1 - riskPenalty(sign.hazard) * 0.5;
    const extra = atTrain ? extraCost(s, dist(P.trainX, P.trainY, sign.x, sign.y)) : 0;
    cands.push({ kind: 'explore', sign, score, why: '', extraCost: extra, blocked: '', dist: d, notes });
  }

  // 采矿候选
  for (const dep of P.deposits) {
    if (dep.discoveredBy == null || dep.reserve <= 0 || dep.id === exclude) continue;
    if (dep.zone === 'hostile') {
      rejected.push(`${dep.name}位于敌对禁区`);
      continue;
    }
    if (dep.zone === 'permit' && !P.natives.permitGranted) {
      rejected.push(`${dep.name}在${P.natives.name}领地内，需要采矿许可`);
      continue;
    }
    if (free <= 0.5) continue;
    const d = dist(ox, oy, dep.x, dep.y);
    const back = dist(dep.x, dep.y, P.trainX, P.trainY);
    const rate = mineRate(s, g, sh, dep.resource);
    const amount = Math.min(free, dep.reserve);
    const mineT = amount / Math.max(0.05, rate);
    const t = (d + back) / spd + GROUPS.deployTime + mineT + GROUPS.unloadTime;
    if (!fuelOk(dep.x, dep.y, mineT + GROUPS.deployTime)) {
      rejected.push(`${dep.name}航程超出油量`);
      continue;
    }
    if (t > timeLimit) {
      rejected.push(`${dep.name}往返 ${fmtTime(t)} 超过灾变安全时限`);
      continue;
    }
    const own = heldSlot(dep, g.id);
    const enRoute = s.groups.filter((o) => o.id !== g.id && o.target?.depositId === dep.id && !heldSlot(dep, o.id)).length;
    const avail = freeSlots(dep) - enRoute;
    let score = (amount * unitPrice(s, dep.resource) - (d + back) * fpk * 2) / t;
    score *= 1 - clamp(riskPenalty(dep.hazard), 0, 0.8);
    if (!own && avail <= 0) score *= 0.35; // 可能需要等待位置
    if (own) score *= 1.2; // 已保留的位置
    if (fuelLow && dep.resource === 'ice') score *= 2.5; // 推进剂告急关系到本组能否出勤
    const notes: string[] = [];
    if (needs.has(dep.resource) && !(fuelLow && dep.resource === 'ice')) {
      score *= 1.25;
      notes.push(`列车短缺${ITEM_INFO[dep.resource].label}（${needs.get(dep.resource)}）`);
    }
    const extra = atTrain ? extraCost(s, dist(P.trainX, P.trainY, dep.x, dep.y)) : 0;
    cands.push({ kind: 'mine', deposit: dep, score, why: '', extraCost: extra, blocked: '', dist: d, notes });
  }

  if (!cands.length) {
    if (atTrain && fuelAvail < tank(sh) * 0.5 && rejected.some((r) => r.includes('油量'))) {
      return { kind: 'mine', score: 0, why: '', extraCost: 0, dist: 0, blocked: `列车运输机推进剂不足（可用 ${fmt(fuelAvail, 1)}），无法到达任何目标${s.inventory.ice < 3 ? '；冰晶也已耗尽，可用能源应急合成推进剂' : '；可用冰晶制推进剂'}` };
    }
    if (rejected.length) g.reason = `无可行目标：${rejected.slice(0, 2).join('；')}`;
    else g.reason = s.planet!.signs.some((x) => x.revealed && !x.explored) ? '其他迹象已有小组在探索' : '没有已知的可采矿点或待探索迹象';
    return null;
  }
  // 额外费用不足的候选剔除
  const affordable = cands.filter((c) => c.extraCost <= g.points);
  if (!affordable.length) {
    const c = cands.sort((a, b) => b.score - a.score)[0];
    return { ...c, blocked: `目标超出基本任务半径，需小组自付 ${c.extraCost} 贡献点，额度不足` };
  }
  affordable.sort((a, b) => b.score - a.score);
  const best = affordable[0];
  best.why = explain(s, g, sh, best, affordable, bold);
  if (atTrain && fuelAvail < tank(sh) - 0.01) best.why += `，推进剂紧张（可用 ${fmt(fuelAvail, 1)}），只做近程任务`;
  return best;
}

/** 列车当前短缺的原料及用途（维修零件 / 轨道燃料 / 推进剂） */
function trainNeeds(s: GameState): Map<RawId, string> {
  const m = new Map<RawId, string>();
  const short = rawShortfall(s);
  for (const k of Object.keys(short.parts) as RawId[]) m.set(k, '维修零件');
  for (const k of Object.keys(short.fuel) as RawId[]) m.set(k, m.has(k) ? `${m.get(k)}、轨道燃料` : '轨道燃料');
  if (s.inventory.propellant < PROPELLANT_ALERT && !m.has('ice')) m.set('ice', '运输机推进剂');
  return m;
}

function extraCost(s: GameState, d: number): number {
  const over = d - s.policies.basicRadius;
  return over > 0 ? Math.ceil(over * 1.5) : 0;
}

function explain(s: GameState, g: Group, sh: Shuttle, c: Choice, all: Choice[], bold: boolean): string {
  const bits: string[] = [];
  if (c.kind === 'explore') {
    bits.push(`前往探索${c.sign!.label}`);
    bits.push(...(c.notes ?? []));
    const mine = all.find((o) => o.kind === 'mine');
    if (mine) bits.push(`预期价值高于采集${mine.deposit!.name}`);
    if (sh.model === 'scout') bits.push('探索型运输机适合勘察');
    if (c.sign!.hazard > 0.12) bits.push(bold ? '组长进取，接受该区域风险' : '风险可控');
  } else {
    const d = c.deposit!;
    const r = d.resource;
    bits.push(`前往${d.name}采集${ITEM_INFO[r].label}`);
    bits.push(...(c.notes ?? []));
    if (all.some((o) => o.kind === 'explore')) bits.push('已知矿点收益高于继续探索');
    if (s.demandBonus[r] > 0) bits.push(`响应列车需求奖励（${unitPrice(s, r)} 点/单位）`);
    if (r === 'ice' && s.inventory.propellant < PROPELLANT_ALERT) bits.push('列车推进剂告急，关系本组能否出勤，优先采冰晶');
    const richer = all.find((o) => o !== c && o.kind === 'mine' && o.deposit!.resource !== r && o.dist > c.dist + 8);
    if (richer) bits.push('选择较近矿点以降低运输成本');
    if (heldSlot(d, g.id)) bits.push('回到本组保留的作业位置');
    if (d.hazard > 0.12) bits.push(bold ? '组长进取，接受区域风险' : '风险可接受');
    const avoided = all.find((o) => o !== c && o.kind === 'mine' && o.deposit!.hazard > 0.12);
    if (!bold && avoided && d.hazard <= 0.12) bits.push(`避开高风险的${avoided.deposit!.name}`);
  }
  if (c.extraCost > 0) bits.push(`超出基本任务半径，小组自付 ${c.extraCost} 贡献点`);
  return bits.join('，');
}

// ---------- 野外 ----------

function targetPoint(s: GameState, g: Group): { x: number; y: number } {
  const P = s.planet!;
  if (g.state === 'returning') return { x: P.trainX, y: P.trainY };
  if (g.target?.kind === 'explore') {
    const sign = P.signs.find((x) => x.id === g.target!.signId)!;
    return { x: sign.x, y: sign.y };
  }
  const d = findDeposit(s, g.target?.depositId)!;
  return { x: d.x, y: d.y };
}

function tickTravel(s: GameState, g: Group, sh: Shuttle): void {
  const P = s.planet!;
  if (g.state !== 'returning' && s.recallActive) return startReturn(s, g, sh, '接到紧急召回令，立即返航');
  const tp = targetPoint(s, g);
  const d = dist(sh.x, sh.y, tp.x, tp.y);
  const step = Math.min(d, speed(sh));
  const fuelUse = step * fuelPerKm(sh);
  if (d > 0.001) {
    sh.x += ((tp.x - sh.x) / d) * step;
    sh.y += ((tp.y - sh.y) / d) * step;
  }
  sh.fuel = Math.max(0, sh.fuel - fuelUse);
  if (g.state !== 'returning') {
    const back = dist(sh.x, sh.y, P.trainX, P.trainY) * fuelPerKm(sh);
    if (sh.fuel < back + 0.5) return startReturn(s, g, sh, '因燃料不足返航');
  }
  if (d - step > 0.01) {
    const left = (d - step) / speed(sh);
    g.status = g.state === 'returning' ? `返航中（约 ${fmtTime(left)}）` : `${g.status.split('（')[0]}（约 ${fmtTime(left)}）`;
    return;
  }
  // 抵达
  if (g.state === 'returning') return arriveTrain(s, g, sh);
  if (g.state === 'toExplore') {
    const sign = P.signs.find((x) => x.id === g.target!.signId)!;
    setState(s, g, 'exploring', `正在探索${sign.label}`);
    g.timer = exploreTime(s, g, sh);
    return;
  }
  arriveDeposit(s, g, sh);
}

function arriveDeposit(s: GameState, g: Group, sh: Shuttle): void {
  const d = findDeposit(s, g.target!.depositId)!;
  if (d.reserve <= 0) return reconsiderInField(s, g, sh, `${d.name}已采空`);
  const had = heldSlot(d, g.id);
  const slot = tryClaim(s, d, g.id);
  if (slot) {
    g.target!.slotId = slot.id;
    setState(s, g, 'deploying', had ? `恢复${d.name}作业` : `在${d.name}部署`);
    g.timer = had ? 2 : GROUPS.deployTime;
    if (!had) log(s, 'group', `${g.name}抵达${d.name}，取得作业位置（${d.slots.indexOf(slot) + 1}/${d.slots.length}）。`);
    return;
  }
  setState(s, g, 'waitingSlot', `等待其他位置释放（${d.name}）`);
  g.timer = GROUPS.waitSlotMax;
  decide(s, g, `${d.name}的作业位置均被占用，等待其他位置释放`);
}

function tickWaiting(s: GameState, g: Group, sh: Shuttle): void {
  if (s.recallActive) return startReturn(s, g, sh, '接到紧急召回令，立即返航');
  const d = findDeposit(s, g.target!.depositId)!;
  sh.fuel = Math.max(0, sh.fuel - IDLE_FUEL_PER_MIN);
  if (d.reserve <= 0) return reconsiderInField(s, g, sh, `${d.name}已采空`);
  const slot = tryClaim(s, d, g.id);
  if (slot) {
    g.target!.slotId = slot.id;
    setState(s, g, 'deploying', `在${d.name}部署`);
    g.timer = GROUPS.deployTime;
    decide(s, g, `${d.name}有位置释放，开始部署`);
    return;
  }
  g.timer -= 1;
  const soonest = Math.min(...d.slots.filter((x) => x.status === 'reserved').map((x) => x.reservedUntil - s.time), Infinity);
  g.status = `等待其他位置释放（${d.name}${isFinite(soonest) ? `，最早保留到期 ${fmtTime(soonest)}` : ''}，最多再等 ${g.timer} 分）`;
  const back = dist(sh.x, sh.y, s.planet!.trainX, s.planet!.trainY) * fuelPerKm(sh);
  if (sh.fuel < back + 0.8) return startReturn(s, g, sh, '等待中燃料见底，因燃料不足返航');
  if (g.timer <= 0) reconsiderInField(s, g, sh, '等待超时', d.id);
}

function tickDeploying(s: GameState, g: Group, sh: Shuttle): void {
  if (s.recallActive) return startReturn(s, g, sh, '接到紧急召回令，立即返航');
  g.timer -= 1;
  if (g.timer <= 0) {
    const d = findDeposit(s, g.target!.depositId)!;
    setState(s, g, 'mining', `正在${d.name}采集${ITEM_INFO[d.resource].label}`);
  }
}

function tickMining(s: GameState, g: Group, sh: Shuttle): void {
  const d = findDeposit(s, g.target!.depositId)!;
  if (s.recallActive) return startReturn(s, g, sh, '接到紧急召回令，携带已采原料返航');
  const cap = cargoCap(sh);
  const rate = mineRate(s, g, sh, d.resource);
  const amount = Math.min(rate, d.reserve, cap - cargoUsed(sh));
  if (amount > 0) {
    // 储量直接从矿点扣除，每分钟一次，避免重复扣矿
    d.reserve = Math.max(0, d.reserve - amount);
    sh.cargo.items[d.resource] = (sh.cargo.items[d.resource] ?? 0) + amount;
  }
  sh.fuel = Math.max(0, sh.fuel - IDLE_FUEL_PER_MIN);
  // 风险区事件
  if (d.hazard > 0 && rand(s) < d.hazard * 0.004) {
    sh.durability = Math.max(0, sh.durability - 5);
    const ms = members(s, g);
    const victim = ms[Math.floor(rand(s) * ms.length)];
    victim.health = Math.max(5, victim.health - 8);
    log(s, 'danger', `${g.name}在${d.name}遭遇落石，运输机耐久 -5，${victim.name}受轻伤。`);
  }
  const N = s.planet!.natives;
  if (N.kind === 'hostile' && dist(d.x, d.y, N.x, N.y) < N.r + 6 && rand(s) < 0.01) {
    sh.durability = Math.max(0, sh.durability - 4);
    log(s, 'danger', `${g.name}在${d.name}收到${N.name}的驱逐警告射击，运输机耐久 -4，撤离返航。`);
    return startReturn(s, g, sh, `遭到${N.name}驱逐警告，撤离`);
  }
  const used = cargoUsed(sh);
  g.status = `正在${d.name}采集${ITEM_INFO[d.resource].label}（货舱 ${fmt(used)}/${cap}）`;
  const back = dist(sh.x, sh.y, s.planet!.trainX, s.planet!.trainY) * fuelPerKm(sh);
  if (sh.fuel < back + 0.8) return startReturn(s, g, sh, '因燃料不足返航');
  if (d.reserve <= 0) {
    const slot = heldSlot(d, g.id);
    if (slot) release(slot);
    log(s, 'group', `${d.name}已采空，作业位置全部释放。`);
    if (used >= cap * 0.6) return startReturn(s, g, sh, `${d.name}采空，带回 ${fmt(used)} 单位返航`);
    return reconsiderInField(s, g, sh, `${d.name}已采空`);
  }
  if (used >= cap - 0.01) return startReturn(s, g, sh, '货舱已满，返航交付');
  // 灾变进入危险边缘时提前返航
  if (stage(s) === 'edge' || stage(s) === 'impact') return startReturn(s, g, sh, '灾变临近，提前返航');
}

function tickExploring(s: GameState, g: Group, sh: Shuttle): void {
  if (s.recallActive) {
    const sign = s.planet!.signs.find((x) => x.id === g.target!.signId)!;
    sign.exploringGroupId = null;
    return startReturn(s, g, sh, '接到紧急召回令，中止探索返航');
  }
  sh.fuel = Math.max(0, sh.fuel - IDLE_FUEL_PER_MIN);
  g.timer -= 1;
  g.status = `正在探索（剩余 ${g.timer} 分）`;
  if (g.timer > 0) return;
  const P = s.planet!;
  const sign = P.signs.find((x) => x.id === g.target!.signId)!;
  sign.explored = true;
  sign.exploringGroupId = null;
  if (sign.kind === 'natives') {
    P.natives.contacted = true;
    sign.resultText = `${P.natives.name}的聚落。双方以手势和图形完成了初步交流。`;
    log(s, 'group', `${g.name}与${P.natives.name}建立联系！可在「航线」面板进行物资交易，或协商领地内的采矿许可。`);
    s.toasts.push({ t: s.time, title: `与${P.natives.name}建立联系`, text: '可交易物资、协商采矿许可（「航线」面板）。' });
    return reconsiderInField(s, g, sh, '接触完成');
  }
  if (sign.kind === 'ruin') {
    const items = Object.entries(sign.loot).filter(([, v]) => (v ?? 0) > 0);
    if (!sign.lootTaken && (items.length || sign.research > 0)) {
      sign.lootTaken = true; // 只发一次
      for (const [k, v] of items) g.loot[k as keyof typeof g.loot] = (g.loot[k as keyof typeof g.loot] ?? 0) + (v ?? 0);
      g.lootResearch += sign.research;
      const what = [...items.map(([k, v]) => `${ITEM_INFO[k as keyof typeof ITEM_INFO].label} ${v}`), ...(sign.research ? [`调查数据 ${sign.research} 研究点`] : [])].join('、');
      log(s, 'group', `${g.name}调查${sign.label}：${sign.resultText} 取得 ${what}，返航后入库。`);
      s.toasts.push({ t: s.time, title: '遗迹调查', text: `${g.name}找到：${what}` });
      return startReturn(s, g, sh, '带着遗留物资返航');
    }
    log(s, 'group', `${g.name}调查${sign.label}：${sign.resultText}`);
    return reconsiderInField(s, g, sh, '调查完成');
  }
  const found = P.deposits.filter((d) => d.signId === sign.id);
  for (const d of found) {
    d.discoveredBy = g.id;
    d.discoveredAt = s.time;
  }
  if (found.length) {
    sign.resultText = found.map((d) => `${d.name}（${ITEM_INFO[d.resource].label}，储量 ${d.initialReserve}，${d.slots.length} 个作业位置）`).join('；');
    log(s, 'group', `${g.name}确认${sign.label}：${sign.resultText}。结果已同步给列车长与全部小组。`);
  } else {
    log(s, 'group', `${g.name}探索${sign.label}：${sign.resultText}`);
  }
  if (sign.eventId) {
    const ev = EVENTS[sign.eventId];
    for (const [r, q] of Object.entries(ev.reward) as [RawId, number][]) {
      sh.cargo.items[r] = (sh.cargo.items[r] ?? 0) + q;
    }
    s.toasts.push({ t: s.time, title: ev.title, text: `${g.name}：${ev.text}` });
    log(s, 'research', `【${ev.title}】${ev.text}`);
  }
  reconsiderInField(s, g, sh, '探索完成');
}

/** 在野外重新评估：就近选择新目标，否则返航 */
function reconsiderInField(s: GameState, g: Group, sh: Shuttle, why: string, exclude?: number): void {
  if (g.target?.depositId != null) {
    const d = findDeposit(s, g.target.depositId);
    // 等待超时/采空时不保留位置（并未持有）
    if (d && d.reserve <= 0) {
      const slot = heldSlot(d, g.id);
      if (slot) release(slot);
    }
  }
  if (s.recallActive) return startReturn(s, g, sh, '召回令生效，返航');
  const c = chooseTarget(s, g, sh, sh.x, sh.y, false, exclude);
  if (!c || c.blocked) return startReturn(s, g, sh, `${why}，附近没有合适目标，返航`);
  g.target = c.kind === 'explore' ? { kind: 'explore', signId: c.sign!.id } : { kind: 'mine', depositId: c.deposit!.id };
  if (c.kind === 'explore') {
    c.sign!.exploringGroupId = g.id;
    g.exploreStreak += 1;
    setState(s, g, 'toExplore', `前往探索${c.sign!.label}`);
  } else setState(s, g, 'toSite', `前往${c.deposit!.name}`);
  decide(s, g, `${why} → 下一步：${c.why}`);
}

function startReturn(s: GameState, g: Group, sh: Shuttle, why: string): void {
  // 正常返航交货期间保留作业位置
  if (g.target?.kind === 'mine' && g.target.depositId != null) {
    const d = findDeposit(s, g.target.depositId);
    if (d) reserveForDelivery(s, d, g.id);
  }
  if (g.target?.kind === 'explore') {
    const sign = s.planet!.signs.find((x) => x.id === g.target!.signId);
    if (sign && sign.exploringGroupId === g.id) sign.exploringGroupId = null;
  }
  const used = cargoUsed(sh);
  g.lastCargoFullRatio = used / cargoCap(sh);
  g.returnReason = why;
  if (why.startsWith('接到紧急召回令')) g.recalled = true;
  setState(s, g, 'returning', '返航中');
  decide(s, g, why);
}

function arriveTrain(s: GameState, g: Group, sh: Shuttle): void {
  sh.docked = true;
  sh.x = s.planet!.trainX;
  sh.y = s.planet!.trainY;
  for (const p of members(s, g)) p.aboard = true;
  g.trips++;
  const loot = Object.entries(g.loot).filter(([, v]) => (v ?? 0) > 0);
  if (loot.length || g.lootResearch > 0) {
    for (const [k, v] of loot) s.inventory[k as keyof typeof s.inventory] += v ?? 0;
    s.research.bank += g.lootResearch;
    log(s, 'economy', `${g.name}带回遗留物资入库：${[...loot.map(([k, v]) => `${ITEM_INFO[k as keyof typeof ITEM_INFO].label} ${v}`), ...(g.lootResearch ? [`调查数据 ${g.lootResearch} 研究点（自动投入研究）`] : [])].join('、')}`);
    g.loot = {};
    g.lootResearch = 0;
  }
  if (cargoUsed(sh) > 0 && !sh.cargo.settled) {
    setState(s, g, 'unloading', '卸货中');
    g.timer = GROUPS.unloadTime;
    return;
  }
  afterReturn(s, g, sh);
}

function tickUnloading(s: GameState, g: Group, sh: Shuttle): void {
  g.timer -= 1;
  g.status = `卸货中（剩余 ${g.timer} 分）`;
  if (g.timer > 0) return;
  settleCargo(s, g, sh);
  afterReturn(s, g, sh);
}

function afterReturn(s: GameState, g: Group, sh: Shuttle): void {
  // 每趟磨损；耐久偏低时列车承担例行维修（消耗维修零件）
  sh.durability = Math.max(0, sh.durability - SHUTTLE_MODELS[sh.model].wearPerTrip);
  maintain(s, g, sh);
  if (g.recalled || s.phase !== 'planet') releaseAllOf(s, g.id);
  g.target = null;
  setState(s, g, 'docked', '已返回列车，待命');
  g.timer = 2;
}

export function maintain(s: GameState, g: Group | null, sh: Shuttle): void {
  if (sh.durability >= SHUTTLE_MAINT.autoRepairBelow) return;
  const reserve = s.policies.reservePartsForDrive && !s.train.driveRepaired ? 8 - s.train.driveRepair : 0;
  if (s.inventory.parts - 1 < reserve) {
    if (g) g.reason = `运输机耐久 ${fmt(sh.durability)}，零件优先保障主驱动，暂缓维护`;
    return;
  }
  s.inventory.parts -= 1;
  sh.durability = Math.min(100, sh.durability + SHUTTLE_MAINT.repairPerPart);
  log(s, 'economy', `列车为${sh.name}进行例行维护：消耗维修零件 1，耐久 → ${fmt(sh.durability)}`);
}

/** 召回总览（UI 用） */
export function recallInfo(s: GameState, g: Group): { where: string; eta: number; cargo: number; fuel: number; outside: string[] } {
  const sh = groupShuttle(s, g);
  const P = s.planet;
  const outside = members(s, g).filter((p) => !p.aboard).map((p) => p.name);
  if (!sh || !P || sh.docked) return { where: '列车上', eta: 0, cargo: sh ? cargoUsed(sh) : 0, fuel: sh?.fuel ?? 0, outside };
  const d = dist(sh.x, sh.y, P.trainX, P.trainY);
  return { where: `距列车 ${fmt(d, 1)} km · ${g.status}`, eta: d / speed(sh) + (cargoUsed(sh) > 0 ? GROUPS.unloadTime : 0), cargo: cargoUsed(sh), fuel: sh.fuel, outside };
}

export { isHome };
