// 节奏测量：两种首站走法 → 第二站可用时间。只调用与界面按钮相同的操作函数（脚本玩家）。
import { minutesUntil, stage } from '../src/sim/catastrophe';
import { nextLegFuel } from '../src/sim/objectives';
import { createInitialState } from '../src/sim/state';
import { step } from '../src/sim/step';
import type { GameState } from '../src/sim/types';
import { autoPlayer, type BotOpts } from './autoplay';

export type Style = 'quick' | 'builder';
export type Second = 'edge' | 'greedy';

export interface PaceResult {
  seed: number;
  style: Style;
  second: Second;
  /** 首站离开（发令离站时刻） */
  leave0: number;
  /** 第三组首次交付时刻（builder） */
  g3First: number;
  arrive1: number;
  warn1: number; // 首次预警（逼近）
  edge1: number; // 危险边缘
  impact1: number; // 灰烬潮抵达第二站 = 最晚安全离站时刻
  recall1: number; // 第二站发出召回
  allAboard1: number; // 召回后全员回车
  leave1: number; // 第二站离开
  margin1: number; // 离站时距灰烬潮抵达的余量
  firstSurvey1: number; // 第二站首个完成的调查（迹象被确认）
  firstEvent1: number; // 第二站首个事件被发现
  contact1: number;
  permitDiscovered1: number; // 原住民领地矿点被确认
  reachedStation: boolean;
  failed: boolean;
}

export function measurePace(seed: number, style: Style, second: Second = 'edge', bot: 'expert' | 'novice' = 'expert', maxMin = 4200): PaceResult {
  const s = createInitialState(seed);
  const r: PaceResult = { seed, style, second, leave0: -1, g3First: -1, arrive1: -1, warn1: -1, edge1: -1, impact1: -1, recall1: -1, allAboard1: -1, leave1: -1, margin1: NaN, firstSurvey1: -1, firstEvent1: -1, contact1: -1, permitDiscovered1: -1, reachedStation: false, failed: false };
  const ready = (x: GameState) => x.train.driveRepaired && x.inventory.trainFuel >= nextLegFuel(x);
  const g3Delivered = (x: GameState) => x.groups.length >= 3 && x.groups[2].pointsEarned > 0;
  const leaveWhen = (x: GameState): boolean => {
    const st = stage(x);
    if (x.journey.current === 0) {
      if (st === 'edge' || st === 'impact') return true;
      return style === 'quick' ? ready(x) : ready(x) && g3Delivered(x);
    }
    if (x.journey.current === 1) {
      if (second === 'edge') return st === 'edge' || st === 'impact';
      // 贪采：一直留到灰烬潮抵达前 40 分钟才召回
      const node = x.journey.nodes[1];
      return minutesUntil(x.catastrophe.front, x.time, node.pos) <= 40 || st === 'impact';
    }
    return st !== 'far';
  };
  const opts: BotOpts = style === 'quick' ? { style: bot, leaveWhen } : { style: bot, train: true, buildShuttle: true, keepSpare: true, leaveWhen };
  let signs0 = 0;
  let events0 = 0;
  for (let i = 0; i < maxMin && s.phase !== 'station' && s.phase !== 'failed'; i++) {
    if (i % (bot === 'novice' ? 30 : 5) === 0) autoPlayer(s, opts);
    const node = s.journey.current;
    const travel = s.phase === 'travel';
    step(s);
    if (s.paused) s.paused = false; // 脚本玩家读完提示继续
    if (r.g3First < 0 && g3Delivered(s)) r.g3First = s.time;
    if (node === 0 && s.phase === 'travel' && r.leave0 < 0) r.leave0 = s.time - 1;
    if (s.journey.current === 1 && s.phase === 'planet') {
      if (r.arrive1 < 0) {
        r.arrive1 = s.time;
        r.impact1 = s.time + Math.round(minutesUntil(s.catastrophe.front, s.time, s.journey.nodes[1].pos));
        signs0 = s.planet!.signs.filter((x) => x.explored).length;
        events0 = s.events.length;
      }
      const st = stage(s);
      if (r.warn1 < 0 && st !== 'far') r.warn1 = s.time;
      if (r.edge1 < 0 && (st === 'edge' || st === 'impact')) r.edge1 = s.time;
      if (r.firstSurvey1 < 0 && s.planet!.signs.filter((x) => x.explored).length > signs0) r.firstSurvey1 = s.time;
      if (r.firstEvent1 < 0 && s.events.length > events0) r.firstEvent1 = s.time;
      if (r.contact1 < 0 && s.planet!.natives.contacted) r.contact1 = s.time;
      if (r.permitDiscovered1 < 0 && s.planet!.deposits.some((d) => d.zone === 'permit' && d.discoveredBy != null)) r.permitDiscovered1 = s.time;
      if (r.recall1 < 0 && s.recallActive) r.recall1 = s.time;
      if (r.recall1 >= 0 && r.allAboard1 < 0 && s.passengers.every((p) => p.aboard || p.leftBehind)) r.allAboard1 = s.time;
    }
    void node;
    void travel;
    if (r.arrive1 > 0 && s.journey.current === 1 && s.phase === 'travel' && r.leave1 < 0) {
      r.leave1 = s.time - 1;
      r.margin1 = r.impact1 - r.leave1;
    }
  }
  r.reachedStation = s.phase === 'station';
  r.failed = s.phase === 'failed';
  return r;
}

/** 1× 下游戏分钟 → 现实分钟（1× = 每真实秒 2 游戏分钟） */
export const realMin = (gameMin: number) => Math.round((gameMin / 120) * 10) / 10;
