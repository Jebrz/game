// 原型数值参数 —— 全部为可调整的测试值，不是最终平衡设定。
// 时间单位：游戏分钟；距离单位：km；速度 km/分钟。

import type { ItemId, Profession, RawId, ShuttleModel } from '../sim/types';

export const SAVE_VERSION = 3; // v3：多星球航线与灾变前锋；v2 运输机制造与机库（旧存档读取时自动升级）

export const TIME = {
  minutesPerRealSecond: 2, // 1× 速度下每真实秒推进的游戏分钟
  speeds: [1, 2, 4, 8],
  maxStepsPerFrame: 80,
  autosaveEveryMinutes: 60,
};

export const POPULATION = {
  total: 30,
};

export const GROUPS = {
  count: 2, // 可出勤小组数量
  defaultRequirement: { pilot: 1, surveyor: 1, miner: 2 } as Partial<Record<Profession, number>>,
  maxRequirementPerProfession: 3,
  minHealthToSortie: 45,
  restFatigue: 65, // 平均疲劳高于此值时休整
  restDoneFatigue: 25,
  waitSlotMax: 40, // 等待作业位置最长分钟，之后重新评估
  deployTime: 5,
  unloadTime: 6,
  prepTime: 4,
  decisionLogMax: 8,
};

// 列车必须保留的基本运营人员（按职业）
export const TRAIN_MIN_STAFF: Partial<Record<Profession, number>> = {
  engineer: 2,
  logistics: 2,
  medic: 1,
};

export const SHUTTLE_COUNT = 2; // 本阶段运输机总数（不会凭空生成）

export interface ShuttleModelSpec {
  label: string;
  cargo: number; // 运载量（单位）
  mineRate: number; // 每分钟采矿量（基础）
  speed: number; // km/分钟
  fuelPerKm: number; // 推进剂/km
  tank: number; // 推进剂容量
  exploreTime: number; // 探索所需分钟
  wearPerTrip: number;
}

export const SHUTTLE_MODELS: Record<ShuttleModel, ShuttleModelSpec> = {
  hauler: { label: '运输型', cargo: 60, mineRate: 1.0, speed: 2.0, fuelPerKm: 0.12, tank: 20, exploreTime: 30, wearPerTrip: 3 },
  miner: { label: '采集型', cargo: 45, mineRate: 1.5, speed: 1.6, fuelPerKm: 0.14, tank: 20, exploreTime: 32, wearPerTrip: 3 },
  scout: { label: '探索型', cargo: 32, mineRate: 0.8, speed: 2.6, fuelPerKm: 0.10, tank: 22, exploreTime: 18, wearPerTrip: 2.5 },
};

export interface UpgradeSpec {
  id: string;
  label: string;
  desc: string;
  points: number; // 贡献点（小组支付）
  items: Partial<Record<ItemId, number>>; // 消耗列车库存
  cargoBonus?: number;
  mineRateMult?: number;
}

// 运输机升级（小组以贡献点购买，同时消耗列车实际库存）
export const SHUTTLE_UPGRADES: UpgradeSpec[] = [
  { id: 'cargoBay', label: '扩容货舱', desc: '运载量 +20', points: 110, items: { parts: 2 }, cargoBonus: 20 },
  { id: 'drill', label: '强化钻头', desc: '采矿效率 ×1.3', points: 130, items: { parts: 2 }, mineRateMult: 1.3 },
];

// 运输机制造（原型参数）。材料从列车公共库存扣除；小组订单另付贡献点，贡献点不能替代材料。
// 工时按标准效率计，实际速度 = 工时 / 加工速度倍率（工程人员），与其他加工共用同一条生产线和能耗。
export const SHUTTLE_BUILD = {
  model: 'hauler' as ShuttleModel,
  items: { parts: 5, iron: 10, copper: 6, crystal: 4 } as Partial<Record<ItemId, number>>,
  time: 120,
  groupPoints: 160, // 小组订购时支付的贡献点（另需同样的材料）
  serialPrefix: 'TJ-',
};

// 机库：每架运输机（含出勤、备用、列车长座机、建造中）占一个泊位
export const HANGAR = {
  baseCapacity: 3,
  expansions: [
    { add: 1, items: { parts: 3, iron: 12 } as Partial<Record<ItemId, number>>, time: 60, label: '扩建泊位 Ⅰ' },
    { add: 1, items: { parts: 4, iron: 16, copper: 6 } as Partial<Record<ItemId, number>>, time: 90, label: '扩建泊位 Ⅱ' },
  ],
};

// 小组自主订购新机的条件（原型参数）
export const GROUP_ORDER = {
  lowDurability: 40, // 主运输机耐久低于此值视为需要换机
  cargoFullRatio: 0.9, // 货舱满载率高于此值且新机运载量更大时视为需要换机
  minTrips: 3,
  pointsBuffer: 20, // 下单后至少保留的贡献点
};

export const SHUTTLE_MAINT = {
  autoRepairBelow: 45, // 耐久低于此值时，列车承担例行维修
  repairPerPart: 30,
  slowBelow: 50, // 耐久低于此值速度 ×0.85
  groundedBelow: 15, // 耐久低于此值禁止出勤
};

export const RAW_BASE_PRICE: Record<RawId, number> = {
  iron: 2,
  copper: 3,
  ice: 1,
  crystal: 4,
  bio: 10,
};

export const DEMAND_BONUS = { min: 0, max: 10, step: 1 };

export const SURVIVAL = {
  foodPerPersonHour: 0.05,
  oxygenPerPersonHour: 1.0,
  foodPerLogisticsEffHour: 0.42,
  lifeSupportOxygenHour: 26, // 满效率时生命维持产氧
  lifeSupportEnergyHour: 10,
  reactorEnergyHour: 62,
  baseEnergyHour: 22,
  processingEnergyHour: 18,
  researchEnergyHour: 5,
  medicalEnergyHour: 3,
  robotEnergyHour: 1.5,
  robotPatrolExtra: 1.5,
  energyCap: 1000,
  oxygenCap: 1200,
  rationMult: { lean: 0.75, normal: 1, rich: 1.25 },
  fatigueHour: { light: -5, normal: -2, overtime: 3 }, // 列车上工作人员每小时疲劳变化
  workloadMult: { light: 0.8, normal: 1, overtime: 1.3 },
  fieldFatigueHour: 5,
  restFatigueHour: -12,
  healHour: 3,
  medicalSkillThreshold: 40, // 医疗岗位技能门槛
  starvingHealthHour: -2,
  suffocatingHealthHour: -8,
  exhaustedHealthHour: -1,
  healthFloor: 5, // 首版不出现死亡，最低为危重
};

export const MOOD = {
  baseMorale: 62,
  baseDisappointment: 18,
  moveRate: 4, // 每小时向目标移动量
  hostilityFromDisappointment: 0.06, // (失望-60)*此值 每小时
  hostilityThreshold: 60,
  hostilityDecayBelow: 30,
  hostilityDecayHour: 0.25,
  leftBehindHostility: 30,
};

export const ROBOTS = {
  count: 4,
  deterrencePer: 10,
};

// 灾变「灰烬潮」：前锋沿航线追赶列车。推进速度由慢到快（平滑加速，不会突然跳变）。
// 速度 v(t) = v0 + (v1 - v0) * smoothstep(t / rampMinutes)，单位 Mm/分钟；列车航速固定且始终快于前锋。
export const CATASTROPHE = {
  startGap: 950, // 开局时前锋落后起始星球的里程（Mm）；按此曲线约第 1640 分钟抵达起始星球
  v0: 0.3, // 初速（Mm/分钟）
  v1: 1.2, // 加速完成后的速度
  rampMinutes: 2400, // 从 v0 平滑加速到 v1 所需游戏分钟
  milestones: [0.35, 0.65, 0.9], // 加速进度提示点（占加速过程的比例）
  biasRange: 0.12, // 预测偏差（占剩余时间比例，随接近缩小）
  minUncertainty: 20,
  uncertaintyFrac: 0.18,
  warnAt: 300, // 预测最早到达小于此值：逼近预警
  edgeAt: 120, // 预测最早到达小于此值：危险边缘（首次自动暂停）
  hullDamagePerMin: 0.6,
  outsideHealthPerMin: 0.8,
  shuttleWearPerMin: 1.5,
};

// 航线：起始星球 + 1～2 颗随机星球 + 公共交易站（本阶段短版）
export const ROUTE = {
  extraPlanets: [1, 2] as [number, number],
  legDistance: [360, 470] as [number, number], // 相邻节点间里程（Mm）
  trainSpeed: 3, // 列车航速（Mm/分钟）
  mmPerFuel: 40, // 每单位轨道燃料可航行的里程
};

export const TRAIN = {
  driveRepairParts: 8,
  driveRepairTime: 60,
  scanTime: 20,
  scanEnergy: 40,
  startHull: 82,
};

export const RESEARCH_RATE = 2.2; // 每有效研究员每小时研究点

export const GENE = {
  id: 'miningAdapt1',
  label: '采掘适应序列·一阶',
  desc: '采掘技能 +20，疲劳积累 -20%',
  points: 90,
  items: { bio: 1, energy: 15 } as Partial<Record<ItemId, number>>,
  minCompatibility: 50,
  minHealth: 60,
  maxFatigue: 70,
  loadLimit: 1, // 本阶段每人可承载序列数
  recovery: 90,
  miningBonus: 20,
  requiresResearch: 'geneMining',
};

export const STATION = {
  name: '回声交易站',
  dockingFee: 15,
  hourlyFee: 1,
  hullRepairPrice: 0.5, // 每点
  shuttleRepairPrice: 0.3,
  sell: { iron: 0.5, copper: 0.8, ice: 0.3, crystal: 1.2, bio: 3, parts: 6, trainFuel: 7, propellant: 0.4 } as Partial<Record<ItemId, number>>,
  buy: { food: 1, oxygen: 0.08, parts: 9, trainFuel: 12, propellant: 1 } as Partial<Record<ItemId, number>>,
};

export const START = {
  credits: 40,
  inventory: {
    iron: 0,
    copper: 0,
    ice: 0,
    crystal: 0,
    bio: 0,
    parts: 2,
    trainFuel: 0,
    propellant: 70,
    food: 110,
    oxygen: 700,
    energy: 520,
  } as Record<ItemId, number>,
};
