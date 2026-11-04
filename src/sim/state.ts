// 初始状态构建

import { CATASTROPHE, GROUPS, POPULATION, ROBOTS, SAVE_VERSION, SHUTTLE_COUNT, SHUTTLE_MODELS, START, TRAIN } from '../config/balance';
import { GROUP_NAMES, PLANET_TEMPLATE, ROSTER } from '../config/content';
import { log, rand } from './core';
import { reformGroups } from './groups';
import type { GameState, Passenger, PlanetState, RawId, Shuttle, ShuttleModel, SkillId } from './types';

const SKILLS: SkillId[] = ['piloting', 'survey', 'mining', 'engineering', 'medical', 'research', 'logistics'];

export function createInitialState(seed = 20261104): GameState {
  const s: GameState = {
    version: SAVE_VERSION,
    seed,
    rng: seed,
    time: 0,
    paused: true,
    speed: 1,
    phase: 'intro',
    nextId: 1,
    passengers: [],
    groups: [],
    shuttles: [],
    groupRequirement: { ...GROUPS.defaultRequirement },
    planet: null,
    inventory: { ...START.inventory },
    credits: START.credits,
    demandBonus: { iron: 0, copper: 0, ice: 0, crystal: 0, bio: 0 },
    pointsIssued: 0,
    queue: [],
    train: { hull: TRAIN.startHull, driveRepair: 0, driveRepaired: false, driveRepairTimer: 0, lifeSupport: 0.85 },
    research: { done: [], current: null, progress: 0 },
    policies: { rations: 'normal', workload: 'normal', reservePartsForDrive: true, basicRadius: 45, security: 'standby' },
    robots: { count: ROBOTS.count, condition: 90 },
    catastrophe: { trueArrival: CATASTROPHE.trueArrival, bias: 0, warned: false, edgeWarned: false, arrived: false, chase: 0 },
    recallActive: false,
    travel: null,
    station: { docked: false, feePaid: false, trades: 0, repairs: 0, summaryShown: false, arrivalTime: -1 },
    moodFactors: [],
    boosts: [],
    log: [],
    toasts: [],
    objectivesDone: [],
    stats: { deliveries: 0, rawDelivered: {}, upgrades: 0, genes: 0, leftBehind: 0, departedAt: -1 },
    failReason: '',
    edgePauseTriggered: false,
  };
  s.catastrophe.bias = Math.round((rand(s) * 2 - 1) * CATASTROPHE.biasRange);

  // 乘客：列车长 + 名单（5 名负责人 + 24 名乘客）
  const captain = makePassenger(s, '列车长（你）', 'general', {}, null, 70);
  captain.isCaptain = true;
  s.passengers.push(captain);
  ROSTER.forEach((r, i) => {
    const p = makePassenger(s, r.name, r.profession, r.skills, r.head ?? null, r.compatibility);
    if (r.personality) p.personality = r.personality;
    p.carId = i % 2 === 0 ? 'dorm1' : 'dorm2';
    s.passengers.push(p);
  });
  if (s.passengers.length !== POPULATION.total) throw new Error('人口配置不一致');

  // 运输机：总数固定，不凭空生成
  const models: ShuttleModel[] = ['miner', 'scout', 'hauler'];
  const names = ['隼一号', '长明号', '备用号'];
  for (let i = 0; i < SHUTTLE_COUNT; i++) s.shuttles.push(makeShuttle(s, names[i], models[i], 74 + i * 8));

  for (let i = 0; i < GROUPS.count; i++) {
    s.groups.push({
      id: newGroupId(s),
      name: GROUP_NAMES[i],
      leaderId: null,
      memberIds: [],
      shuttleId: s.shuttles[i]?.id ?? null,
      points: 0,
      pointsEarned: 0,
      pointsSpent: 0,
      state: 'docked',
      stateSince: 0,
      timer: 0,
      target: null,
      status: '待命',
      reason: '',
      decisions: [],
      missing: [],
      pendingReform: false,
      recalled: false,
      returnReason: '',
      lastCargoFullRatio: 0,
      trips: 0,
      purchases: [],
    });
  }
  s.planet = generatePlanet(s);
  for (const sh of s.shuttles) {
    sh.x = s.planet.trainX;
    sh.y = s.planet.trainY;
  }
  reformGroups(s);
  log(s, 'system', '列车在古老轨道锚点上苏醒。灰岩星 K-7 就在窗外。');
  return s;
}

function newGroupId(s: GameState): number {
  return s.nextId++;
}

function makePassenger(
  s: GameState,
  name: string,
  profession: Passenger['profession'],
  skills: Partial<Record<SkillId, number>>,
  head: Passenger['headRole'],
  compatibility: number,
): Passenger {
  const full = {} as Record<SkillId, number>;
  for (const k of SKILLS) full[k] = skills[k] ?? Math.round(10 + rand(s) * 15);
  return {
    id: s.nextId++,
    name,
    profession,
    skills: full,
    health: Math.round(78 + rand(s) * 18),
    fatigue: Math.round(10 + rand(s) * 20),
    morale: 58,
    disappointment: 18,
    hostility: 0,
    sensitivity: 0.7 + rand(s) * 0.6,
    personality: rand(s) < 0.5 ? 'steady' : 'bold',
    compatibility,
    isCaptain: false,
    headRole: head,
    groupId: null,
    carId: 'dorm1',
    genes: [],
    recoveringUntil: -1,
    aboard: true,
    leftBehind: false,
  };
}

function makeShuttle(s: GameState, name: string, model: ShuttleModel, durability: number): Shuttle {
  return {
    id: s.nextId++,
    name,
    model,
    level: 1,
    upgrades: [],
    fuel: SHUTTLE_MODELS[model].tank,
    durability,
    x: 0,
    y: 0,
    docked: true,
    assignedTo: 'group',
    cargo: { id: s.nextId++, items: {}, settled: false },
  };
}

function generatePlanet(s: GameState): PlanetState {
  const T = PLANET_TEMPLATE;
  const p: PlanetState = {
    name: T.name,
    width: T.width,
    height: T.height,
    trainX: T.width / 2,
    trainY: T.height / 2,
    scanned: false,
    scanProgress: -1,
    signs: [],
    deposits: [],
    hazardZones: [],
  };
  for (const tpl of T.signs) {
    const ang = ((tpl.angle + (rand(s) - 0.5) * 16) * Math.PI) / 180;
    const d = tpl.dist * (0.92 + rand(s) * 0.16);
    const x = clampTo(p.trainX + Math.cos(ang) * d, 6, T.width - 6);
    const y = clampTo(p.trainY + Math.sin(ang) * d * 0.85, 6, T.height - 6);
    const sign = {
      id: s.nextId++,
      label: tpl.label,
      guess: tpl.guess,
      x,
      y,
      radius: 7,
      revealed: false,
      explored: false,
      exploringGroupId: null,
      hazard: tpl.hazard,
      eventId: tpl.eventId ?? null,
      resultText: tpl.emptyText ?? '',
    };
    p.signs.push(sign);
    if (tpl.hazard >= 0.15) p.hazardZones.push({ x, y, r: 9 });
    tpl.deposits.forEach((dt, i) => {
      const a = rand(s) * Math.PI * 2;
      const r = 2 + rand(s) * 3.5 + i * 2;
      p.deposits.push({
        id: s.nextId++,
        signId: sign.id,
        resource: dt.resource as RawId,
        name: dt.name,
        x: x + Math.cos(a) * r,
        y: y + Math.sin(a) * r,
        reserve: dt.reserve,
        initialReserve: dt.reserve,
        slots: Array.from({ length: dt.slots }, () => ({ id: s.nextId++, holderGroupId: null, status: 'free' as const, reservedUntil: -1 })),
        hazard: tpl.hazard,
        discoveredBy: null,
        discoveredAt: -1,
      });
    });
  }
  return p;
}

function clampTo(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
