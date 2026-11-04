// 探索事件：发现时生成待决事件，列车长选择方案后由小组到现场执行。
//
// 规则（界面会显示）：
// - 发现事件时暂停全部模拟一次；可以选择「稍后处理」，发现事件的小组不会停在现场等待，会继续其他工作。
// - 同一地点只生成一个事件（按迹象 / 矿点 id 判重），多个小组同时发现也不会重复。
// - 选择方案时立即扣除投入；执行小组到现场作业，完成后带着成果返航，返航卸货时入库（只发一次）。
// - 召回或灾变迫近时中断：保留剩余进度，回到「待执行」，之后可再派出；已投入的物资不退。
// - 尚未开始作业前取消：原样退还投入。离开星球时，未完成的事件作废，已投入的物资不退。
// - 一次性地点：完成、放弃或作废后不会再次生成。

import { EVENT_DEFS, type EventOptionDef } from '../config/balance';
import { ITEM_INFO } from '../config/content';
import { add, consume, costText, fmtTime, log, members, missingItems, newId } from './core';
import { decide } from './groups';
import { canNegotiate, grantPermit } from './natives';
import type { Deposit, ExploreEvent, GameState, Group, ItemId, Sign } from './types';

export const DEFER_TEXT = '稍后处理：事件留在待办列表，发现它的小组继续其他工作；离开本星球时作废。';

export function eventOptions(ev: ExploreEvent): EventOptionDef[] {
  if (ev.kind === 'facility' || ev.kind === 'beacon') return EVENT_DEFS[ev.kind].options;
  return [];
}

function exists(s: GameState, kind: ExploreEvent['kind'], siteId: number): boolean {
  return s.events.some((e) => e.kind === kind && e.siteId === siteId && e.nodeIndex === s.journey.current);
}

function make(s: GameState, kind: ExploreEvent['kind'], siteId: number, x: number, y: number, title: string, g: Group | null, rolls: Record<string, number>): ExploreEvent {
  const ev: ExploreEvent = {
    id: newId(s),
    kind,
    nodeIndex: s.journey.current,
    planetName: s.planet!.name,
    siteId,
    x,
    y,
    title,
    finderGroupId: g?.id ?? null,
    discoveredAt: s.time,
    status: 'pending',
    choice: null,
    assignedGroupId: null,
    work: 0,
    remaining: 0,
    paid: {},
    rolls,
    result: '',
    rewardGiven: false,
    log: [`${g ? g.name : '列车'}发现`],
  };
  s.events.push(ev);
  log(s, 'research', `【事件】${s.planet!.name}：${title}（${g ? `${g.name}发现` : '列车侦测'}）。等待列车长决定——见「事件」面板。`);
  s.toasts.push({ t: s.time, title: `事件：${title}`, text: '模拟已暂停。可在「事件」面板选择方案，或稍后处理。' });
  s.paused = true; // 重大事件提交决策时暂停全部模拟
  return ev;
}

/** 小组调查迹象时调用：设施 / 信标 */
export function discoverSignEvent(s: GameState, g: Group, sign: Sign): ExploreEvent | null {
  if (!sign.eventKind || exists(s, sign.eventKind, sign.id)) return null;
  return make(s, sign.eventKind, sign.id, sign.x, sign.y, EVENT_DEFS[sign.eventKind].title, g, sign.eventRolls ?? {});
}

/** 原住民领地内的矿点被确认时调用 */
export function discoverNativeMine(s: GameState, g: Group | null, dep: Deposit): ExploreEvent | null {
  if (dep.zone !== 'permit' || exists(s, 'nativeMine', dep.id)) return null;
  return make(s, 'nativeMine', dep.id, dep.x, dep.y, `${EVENT_DEFS.nativeMine.title}：${dep.name}`, g, {});
}

export function pendingEvents(s: GameState): ExploreEvent[] {
  return s.events.filter((e) => e.nodeIndex === s.journey.current && (e.status === 'pending' || e.status === 'assigned' || e.status === 'active'));
}

function rewardText(ev: ExploreEvent, opt: EventOptionDef, exact: boolean): string {
  const bits: string[] = [];
  for (const [k, range] of Object.entries(opt.reward) as [ItemId, [number, number]][]) {
    bits.push(`${ITEM_INFO[k].label} ${exact ? ev.rolls[`${opt.id}.${k}`] : `${range[0]}～${range[1]}`}`);
  }
  if (opt.research) bits.push(`研究点 ${exact ? ev.rolls[`${opt.id}.research`] : `${opt.research[0]}～${opt.research[1]}`}`);
  return bits.join('、') || '无';
}

export function optionSummary(ev: ExploreEvent, opt: EventOptionDef): string {
  return `投入：${Object.keys(opt.cost).length ? costText(opt.cost) : '无'}；现场作业约 ${fmtTime(opt.work)}${opt.fatigue ? `；成员疲劳 +${opt.fatigue}` : ''}；预计收益：${rewardText(ev, opt, false)}`;
}

/** 选择可用性（空字符串表示可选） */
export function canChoose(s: GameState, ev: ExploreEvent, optId: string): string {
  if (ev.status !== 'pending') return '事件已处理';
  if (ev.nodeIndex !== s.journey.current || s.phase !== 'planet') return '已离开该星球';
  if (ev.kind === 'nativeMine') {
    const dep = s.planet!.deposits.find((d) => d.id === ev.siteId)!;
    if (optId === 'decline') return '';
    return canNegotiate(s, dep, optId as 'pay' | 'share');
  }
  const opt = eventOptions(ev).find((o) => o.id === optId);
  if (!opt) return '无此方案';
  const miss = missingItems(s.inventory, opt.cost);
  if (miss.length) return `库存不足：${miss.join('、')}`;
  if (!executorFor(s, ev)) return '没有可执行的小组（需要有成员和运输机）';
  return '';
}

function executorFor(s: GameState, ev: ExploreEvent): Group | null {
  const ok = (g: Group) => g.memberIds.length > 0 && g.shuttleId != null;
  const finder = s.groups.find((g) => g.id === ev.finderGroupId);
  if (finder && ok(finder)) return finder;
  return s.groups.find(ok) ?? null;
}

export function choose(s: GameState, ev: ExploreEvent, optId: string): void {
  if (canChoose(s, ev, optId)) return;
  if (ev.kind === 'nativeMine') {
    const dep = s.planet!.deposits.find((d) => d.id === ev.siteId)!;
    if (optId === 'decline') {
      ev.status = 'declined';
      ev.choice = 'decline';
      ev.result = '拒绝条件并离开：该矿点仍不可作业，小组不会进入。可在「航线」面板重新协商。';
      log(s, 'station', `列车长拒绝了${s.planet!.natives.name}关于${dep.name}的条件，小组不会进入该矿点。`);
      return;
    }
    const p = grantPermit(s, dep, optId as 'pay' | 'share');
    if (!p) return;
    ev.status = 'done';
    ev.choice = optId;
    ev.rewardGiven = true;
    ev.result = optId === 'pay' ? `已支付 ${costText(p.paid)}，取得许可（${fmtTime(p.expiresAt - s.time)}，上限 ${p.cap} 单位）。` : `约定交出 ${Math.round(p.sharePct * 100)}% 产出，取得许可（${fmtTime(p.expiresAt - s.time)}，上限 ${p.cap} 单位）。`;
    return;
  }
  const opt = eventOptions(ev).find((o) => o.id === optId)!;
  consume(s.inventory, opt.cost);
  const g = executorFor(s, ev)!;
  ev.status = 'assigned';
  ev.choice = optId;
  ev.paid = { ...opt.cost };
  ev.work = opt.work;
  ev.remaining = opt.work;
  ev.assignedGroupId = g.id;
  ev.log.push(`${fmtTime(s.time)} 选择「${opt.label}」，由${g.name}执行`);
  log(s, 'research', `${ev.title}：列车长选择「${opt.label}」（投入 ${Object.keys(opt.cost).length ? costText(opt.cost) : '无'}），由${g.name}执行${g.state === 'docked' || g.state === 'grounded' || g.state === 'resting' ? '' : '（返航后前往）'}。`);
}

export function decline(s: GameState, ev: ExploreEvent): void {
  if (ev.status !== 'pending') return;
  ev.status = 'declined';
  ev.result = '放弃：该地点不再处理。';
  log(s, 'research', `${ev.title}：列车长决定放弃。`);
}

/** 尚未开始作业时取消：原样退还投入 */
export function canCancel(ev: ExploreEvent): string {
  if (ev.status !== 'assigned') return ev.status === 'active' ? '正在现场作业，可用召回中断（进度保留，投入不退）' : '没有可取消的执行';
  if (ev.remaining < ev.work) return '已开始作业，投入不退（可召回中断，进度保留）';
  return '';
}

export function cancelEvent(s: GameState, ev: ExploreEvent): void {
  if (canCancel(ev)) return;
  add(s.inventory, ev.paid);
  log(s, 'research', `${ev.title}：取消执行，退还 ${Object.keys(ev.paid).length ? costText(ev.paid) : '（无投入）'}。`);
  ev.paid = {};
  ev.status = 'pending';
  ev.choice = null;
  ev.assignedGroupId = null;
}

/** 分配给该小组、等待执行的事件 */
export function assignedEvent(s: GameState, g: Group): ExploreEvent | null {
  return s.events.find((e) => e.assignedGroupId === g.id && e.status === 'assigned' && e.nodeIndex === s.journey.current) ?? null;
}

/** 现场作业完成：成果交给小组带回（返航卸货时入库，只发一次） */
export function completeEvent(s: GameState, g: Group, ev: ExploreEvent): void {
  if (ev.rewardGiven) return;
  const opt = eventOptions(ev).find((o) => o.id === ev.choice)!;
  for (const k of Object.keys(opt.reward) as ItemId[]) g.loot[k] = (g.loot[k] ?? 0) + (ev.rolls[`${opt.id}.${k}`] ?? 0);
  if (opt.research) g.lootResearch += ev.rolls[`${opt.id}.research`] ?? 0;
  if (opt.fatigue) for (const p of members(s, g)) p.fatigue = Math.min(100, p.fatigue + opt.fatigue);
  ev.rewardGiven = true;
  ev.status = 'done';
  ev.remaining = 0;
  const clue = ev.kind === 'beacon' ? beaconClue(ev) : '';
  ev.result = `${opt.label}完成：取得 ${rewardText(ev, opt, true)}（随${g.name}返航入库）。${clue}`;
  log(s, 'research', `${ev.title}：${g.name}完成「${opt.label}」，取得 ${rewardText(ev, opt, true)}，返航后入库。${clue}`);
  decide(s, g, `完成${ev.title}「${opt.label}」，带回成果`, false);
}

function beaconClue(ev: ExploreEvent): string {
  return ev.choice === 'deep'
    ? '线索：信标的编码结构与列车车头的纹路高度相似；记录中有一段反复出现的「潮汐」符号，含义尚不明确。'
    : '线索：信号片段中夹杂着与列车纹路相似的符号。';
}

/** 离开星球：未完成的事件作废（已投入不退） */
export function expireEventsOnDeparture(s: GameState, nodeIndex: number): void {
  for (const ev of s.events) {
    if (ev.nodeIndex !== nodeIndex) continue;
    if (ev.status === 'pending' || ev.status === 'assigned' || ev.status === 'active') {
      ev.status = 'expired';
      ev.result = `离开${ev.planetName}，事件作废${Object.keys(ev.paid).length ? `（已投入 ${costText(ev.paid)} 不退）` : ''}。`;
      ev.assignedGroupId = null;
      log(s, 'research', `${ev.title}：${ev.result}`);
    }
  }
}

export function groupOnEvent(s: GameState, g: Group): ExploreEvent | null {
  return s.events.find((e) => e.assignedGroupId === g.id && (e.status === 'active' || e.status === 'assigned') && e.nodeIndex === s.journey.current) ?? null;
}
