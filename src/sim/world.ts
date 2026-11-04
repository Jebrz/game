// 航线与星球生成（开局时按种子一次性生成全部节点并保存在状态中，读档不会刷新）
//
// - 资源情况（rich / poor / barren）与原住民情况（none / friendly / hostile）分别随机，互不排斥。
// - 起始星球固定为相对安全的富矿星球（模板），保证基础维修与第一段航程燃料可获得。
// - 保底：每颗后续星球都至少有一种可获得「下一段航程燃料」的途径（敌对禁区外的辉晶+冰晶、遗留燃料舱或可交流原住民），
//   且不需要先去下一颗星球才能取得当前起飞燃料。

import { ROUTE } from '../config/balance';
import { PLANET_TEMPLATE } from '../config/content';
import { rand } from './core';
import type { Deposit, GameState, ItemId, NativeKind, NativesState, PlanetState, RawId, ResourceProfile, RouteNode, Sign } from './types';

export interface DepositSpec {
  resource: RawId;
  name: string;
  reserve: number;
  slots: number;
  zone?: Deposit['zone']; // 指定作业区（原住民相关矿点），不依赖随机落点
}

export interface SignSpec {
  label: string;
  guess: RawId;
  kind?: Sign['kind'];
  dist: number;
  angle: number; // 度
  hazard: number;
  deposits: DepositSpec[];
  eventId?: string;
  emptyText?: string;
  loot?: Partial<Record<ItemId, number>>;
  research?: number;
  restricted?: boolean; // 指定位于敌对禁区
}

const W = 140;
const H = 90;

export function legFuel(dist: number): number {
  return Math.ceil(dist / ROUTE.mmPerFuel);
}

function pick<T>(s: GameState, arr: T[]): T {
  return arr[Math.floor(rand(s) * arr.length)];
}

function between(s: GameState, lo: number, hi: number): number {
  return lo + rand(s) * (hi - lo);
}

function emptyNatives(): NativesState {
  return { kind: 'none', name: '', x: 0, y: 0, r: 0, detected: false, contacted: false, permitGranted: false, permitCost: {}, trades: [] };
}

/** 按规格构建一颗星球的地图 */
export function buildPlanet(s: GameState, name: string, profile: ResourceProfile, specs: SignSpec[], natives: NativesState): PlanetState {
  const p: PlanetState = {
    name,
    width: W,
    height: H,
    trainX: W / 2,
    trainY: H / 2,
    scanned: false,
    scanProgress: -1,
    signs: [],
    deposits: [],
    hazardZones: [],
    resourceProfile: profile,
    natives,
    warned: false,
    edgeWarned: false,
    deliveries: 0,
  };
  for (const tpl of specs) {
    const ang = ((tpl.angle + (rand(s) - 0.5) * 16) * Math.PI) / 180;
    const d = tpl.dist * (0.92 + rand(s) * 0.16);
    const x = clampTo(p.trainX + Math.cos(ang) * d, 6, W - 6);
    const y = clampTo(p.trainY + Math.sin(ang) * d * 0.85, 6, H - 6);
    const inHostile = tpl.restricted ?? (natives.kind === 'hostile' && Math.hypot(x - natives.x, y - natives.y) < natives.r);
    const sign: Sign = {
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
      kind: tpl.kind ?? 'resource',
      restricted: inHostile,
      loot: tpl.loot ?? {},
      research: tpl.research ?? 0,
      lootTaken: false,
    };
    p.signs.push(sign);
    if (tpl.hazard >= 0.15) p.hazardZones.push({ x, y, r: 9 });
    tpl.deposits.forEach((dt, i) => {
      const a = rand(s) * Math.PI * 2;
      const r = 2 + rand(s) * 3.5 + i * 2;
      const dx = x + Math.cos(a) * r;
      const dy = y + Math.sin(a) * r;
      const inZone = natives.kind !== 'none' && Math.hypot(dx - natives.x, dy - natives.y) < natives.r;
      const dep: Deposit = {
        id: s.nextId++,
        signId: sign.id,
        resource: dt.resource,
        name: dt.name,
        x: dx,
        y: dy,
        reserve: dt.reserve,
        initialReserve: dt.reserve,
        slots: Array.from({ length: dt.slots }, () => ({ id: s.nextId++, holderGroupId: null, status: 'free' as const, reservedUntil: -1 })),
        hazard: tpl.hazard,
        discoveredBy: null,
        discoveredAt: -1,
        zone: dt.zone ?? (inZone ? (natives.kind === 'hostile' ? 'hostile' : 'permit') : 'open'),
      };
      p.deposits.push(dep);
    });
  }
  return p;
}

function clampTo(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 起始星球：固定模板（相对安全、富矿、无原住民） */
export function startPlanet(s: GameState): PlanetState {
  return buildPlanet(s, PLANET_TEMPLATE.name, 'rich', PLANET_TEMPLATE.signs, emptyNatives());
}

const PLANET_NAMES = ['赤砂星 R-2', '寂铁星 M-9', '霜纹星 C-4', '琥珀星 A-6', '回廊星 V-3', '静湖星 L-1', '锈环星 K-5'];
const FRIENDLY = ['岩栖族', '织光族', '穴歌者'];
const HOSTILE = ['鸣钟哨所', '黑曜守望', '无名防线'];

/** 随机星球：资源情况与原住民情况分别生成 */
function randomPlanet(s: GameState, name: string, profile: ResourceProfile, nk: NativeKind, nextFuel: number): { planet: PlanetState; variant: string } {
  // 原住民位置与领地（先定位置，其余迹象避开敌对禁区）
  const nat = emptyNatives();
  const natAng = rand(s) * 360;
  if (nk !== 'none') {
    const d = between(s, 26, 36);
    nat.kind = nk;
    nat.x = clampTo(W / 2 + Math.cos((natAng * Math.PI) / 180) * d, 14, W - 14);
    nat.y = clampTo(H / 2 + Math.sin((natAng * Math.PI) / 180) * d * 0.85, 14, H - 14);
    nat.r = 13;
    if (nk === 'friendly') {
      nat.name = pick(s, FRIENDLY);
      nat.permitCost = { food: 12, parts: 1 };
      nat.trades = [
        { id: 'fuel', give: { food: 15 }, get: { trainFuel: 3 }, stock: 3 },
        { id: 'crystal', give: { parts: 2 }, get: { crystal: 18 }, stock: 2 },
        { id: 'propellant', give: { iron: 20 }, get: { propellant: 20 }, stock: 3 },
        { id: 'bio', give: { food: 10 }, get: { bio: 2 }, stock: 1 },
      ];
    } else nat.name = pick(s, HOSTILE);
  }
  // 普通迹象的方向避开原住民方向 ±45°
  const angles: number[] = [];
  const freeAngle = (): number => {
    for (let k = 0; k < 40; k++) {
      const a = rand(s) * 360;
      const diff = Math.abs(((a - natAng + 540) % 360) - 180);
      if (nk !== 'none' && diff < 45) continue;
      if (angles.some((b) => Math.abs(((a - b + 540) % 360) - 180) < 28)) continue;
      angles.push(a);
      return a;
    }
    const a = rand(s) * 360;
    angles.push(a);
    return a;
  };
  const r = (lo: number, hi: number) => Math.round(between(s, lo, hi));
  const specs: SignSpec[] = [];
  let variant = '';
  if (profile === 'rich') {
    variant = '富矿';
    specs.push(
      { label: '铁矿迹象', guess: 'iron', dist: r(18, 30), angle: freeAngle(), hazard: 0.05, deposits: [{ resource: 'iron', name: '褐铁台地', reserve: r(260, 340), slots: 2 }] },
      { label: '铜矿迹象', guess: 'copper', dist: r(22, 34), angle: freeAngle(), hazard: 0.05, deposits: [{ resource: 'copper', name: '青铜裂隙', reserve: r(140, 200), slots: 2 }] },
      { label: '冰晶迹象', guess: 'ice', dist: r(14, 24), angle: freeAngle(), hazard: 0, deposits: [{ resource: 'ice', name: '冻土冰层', reserve: r(260, 360), slots: 2 }] },
      { label: '辉晶迹象', guess: 'crystal', dist: r(24, 38), angle: freeAngle(), hazard: 0.12, deposits: [{ resource: 'crystal', name: '辉晶岩脊', reserve: r(200, 260), slots: 2 }] },
      { label: '铁矿迹象', guess: 'iron', dist: r(30, 44), angle: freeAngle(), hazard: 0, deposits: [], emptyText: '只有零散铁屑，没有可采矿点。' },
    );
  } else if (profile === 'poor') {
    const fuelSide = rand(s) < 0.5;
    if (fuelSide) {
      variant = '贫矿·偏冰晶与辉晶';
      specs.push(
        { label: '冰晶迹象', guess: 'ice', dist: r(16, 26), angle: freeAngle(), hazard: 0, deposits: [{ resource: 'ice', name: '浅冰坑', reserve: r(90, 130), slots: 1 }] },
        { label: '辉晶迹象', guess: 'crystal', dist: r(24, 36), angle: freeAngle(), hazard: 0.08, deposits: [{ resource: 'crystal', name: '碎晶带', reserve: Math.max(r(70, 100), nextFuel * 3 + 15), slots: 1 }] },
      );
    } else {
      variant = '贫矿·偏金属';
      specs.push(
        { label: '铁矿迹象', guess: 'iron', dist: r(18, 28), angle: freeAngle(), hazard: 0, deposits: [{ resource: 'iron', name: '风化铁脊', reserve: r(110, 150), slots: 1 }] },
        { label: '铜矿迹象', guess: 'copper', dist: r(24, 34), angle: freeAngle(), hazard: 0.05, deposits: [{ resource: 'copper', name: '浅铜斑', reserve: r(60, 90), slots: 1 }] },
        // 保底：遗留燃料舱（不依赖下一颗星球）
        { label: '异常信号', guess: 'iron', kind: 'ruin', dist: r(20, 32), angle: freeAngle(), hazard: 0, deposits: [], loot: { trainFuel: nextFuel }, emptyText: '旧时代的补给站残骸，燃料舱仍密封完好。' },
      );
    }
    specs.push(
      { label: '辉晶迹象', guess: 'crystal', dist: r(34, 46), angle: freeAngle(), hazard: 0, deposits: [], emptyText: '反射来自玻璃化岩层，没有可采矿点。' },
      { label: '铜矿迹象', guess: 'copper', dist: r(30, 44), angle: freeAngle(), hazard: 0, deposits: [], emptyText: '迹象微弱，没有可采矿点。' },
    );
  } else {
    variant = '无矿';
    specs.push(
      { label: '异常信号', guess: 'iron', kind: 'ruin', dist: r(16, 26), angle: freeAngle(), hazard: 0, deposits: [], loot: { trainFuel: nextFuel, parts: 2 }, emptyText: '一座被遗弃的轨道补给站，燃料舱与零件箱仍可使用。' },
      { label: '异常信号', guess: 'iron', kind: 'ruin', dist: r(24, 36), angle: freeAngle(), hazard: 0.05, deposits: [], research: 10, emptyText: '古代观测站的数据核心，记录了灰烬潮的早期观测。' },
      { label: '异常信号', guess: 'iron', kind: 'ruin', dist: r(30, 42), angle: freeAngle(), hazard: 0, deposits: [], emptyText: '只有风化的残骸，没有可用之物。' },
      { label: '铁矿迹象', guess: 'iron', dist: r(20, 34), angle: freeAngle(), hazard: 0, deposits: [], emptyText: '金属反射来自地表碎屑，确认无可采矿产。' },
    );
  }
  // 原住民相关迹象
  if (nk === 'friendly') {
    specs.push({ label: '人工信号', guess: 'bio', kind: 'natives', dist: Math.hypot(nat.x - W / 2, (nat.y - H / 2) / 0.85), angle: natAng, hazard: 0, deposits: [], emptyText: `${nat.name}的聚落。` });
    // 领地内的矿点：需要协商采矿许可
    specs.push({ label: '辉晶迹象', guess: 'crystal', dist: Math.hypot(nat.x - W / 2, (nat.y - H / 2) / 0.85) + 4, angle: natAng + 10, hazard: 0, deposits: [{ resource: 'crystal', name: '圣地晶簇', reserve: r(150, 200), slots: 2, zone: 'permit' }] });
  } else if (nk === 'hostile') {
    // 禁区内诱人的矿点：不可作业
    specs.push({ label: '辉晶迹象', guess: 'crystal', dist: Math.hypot(nat.x - W / 2, (nat.y - H / 2) / 0.85), angle: natAng, hazard: 0.3, restricted: true, deposits: [{ resource: 'crystal', name: '禁区晶脉', reserve: r(220, 300), slots: 2, zone: 'hostile' }] });
  }
  return { planet: buildPlanet(s, name, profile, specs, nat), variant };
}

function intelText(profile: ResourceProfile, variant: string, nk: NativeKind): string {
  const res =
    profile === 'rich'
      ? '矿物光谱信号强，金属与晶体反射都很明显'
      : profile === 'poor'
        ? variant.includes('金属')
          ? '矿物信号弱，主要为金属；另有零星人工遗迹回波'
          : '矿物信号弱，主要为冰与晶体'
        : '几乎没有矿物信号；检测到人工遗迹回波';
  const nat = nk === 'none' ? '未检测到持续人工信号' : nk === 'friendly' ? '检测到持续人工信号（性质不明）' : '检测到持续人工信号，含疑似防御雷达的扫描脉冲';
  return `${res}。${nat}。（远程情报，可能不准确）`;
}

/** 生成整条航线（开局调用一次） */
export function generateRoute(s: GameState): { nodes: RouteNode[]; first: PlanetState } {
  const first = startPlanet(s);
  const nodes: RouteNode[] = [];
  nodes.push({ id: s.nextId++, kind: 'planet', name: first.name, pos: 0, intel: '起始星球：低活性岩石星球，资源较丰富，未发现原住民。', planet: null, status: 'current', arrivedAt: 0, departedAt: -1, notes: [] });
  const [lo, hi] = ROUTE.extraPlanets;
  const count = lo + Math.floor(rand(s) * (hi - lo + 1));
  const names = [...PLANET_NAMES];
  const legs: number[] = [];
  for (let i = 0; i <= count; i++) legs.push(Math.round(between(s, ROUTE.legDistance[0], ROUTE.legDistance[1])));
  let pos = 0;
  for (let i = 0; i < count; i++) {
    pos += legs[i];
    const profile: ResourceProfile = pick(s, ['rich', 'poor', 'poor', 'barren'] as ResourceProfile[]);
    const nk: NativeKind = pick(s, ['none', 'none', 'friendly', 'hostile'] as NativeKind[]);
    const name = names.splice(Math.floor(rand(s) * names.length), 1)[0];
    const { planet, variant } = randomPlanet(s, name, profile, nk, legFuel(legs[i + 1]));
    nodes.push({ id: s.nextId++, kind: 'planet', name, pos, intel: intelText(profile, variant, nk), planet, status: 'unvisited', arrivedAt: -1, departedAt: -1, notes: [] });
  }
  pos += legs[count];
  nodes.push({ id: s.nextId++, kind: 'station', name: '回声交易站', pos, intel: '公共交易站：补给、维修、买卖；站内禁止暴力；停泊期间灾变追赶暂停。', planet: null, status: 'unvisited', arrivedAt: -1, departedAt: -1, notes: [] });
  return { nodes, first };
}

/** 某颗星球上可获得的轨道燃料（保底校验与界面估算用；不计敌对禁区与未许可领地） */
export function obtainableFuel(p: PlanetState, ice0 = 0): number {
  let crystal = 0;
  let ice = ice0;
  let fuel = 0;
  for (const d of p.deposits) {
    if (d.zone === 'hostile') continue;
    if (d.zone === 'permit' && p.natives.kind !== 'friendly') continue;
    if (d.resource === 'crystal') crystal += d.reserve;
    if (d.resource === 'ice') ice += d.reserve;
  }
  fuel += Math.floor(Math.min(crystal / 3, ice));
  for (const sg of p.signs) if (!sg.restricted && !sg.lootTaken) fuel += sg.loot.trainFuel ?? 0;
  if (p.natives.kind === 'friendly') for (const t of p.natives.trades) fuel += (t.get.trainFuel ?? 0) * t.stock;
  return fuel;
}
