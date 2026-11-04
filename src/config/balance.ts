// 原型数值参数 —— 全部为可调整的测试值，不是最终平衡设定。
// 时间单位：游戏分钟；距离单位：km；速度 km/分钟。

import type { ItemId, Profession, RawId, ShuttleModel } from '../sim/types';

export const SAVE_VERSION = 6; // v6：乘客培训与多职业资格；v5：探索事件、原住民关系与采矿许可；v4：动态小组；v3：多星球航线与灾变前锋；v2：运输机制造与机库（旧存档读取时自动升级）

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

// ---------------- 探索事件与原住民（原型参数） ----------------
// 事件选项：cost=选择时从列车库存扣除；work=执行小组在现场作业的分钟；reward=范围（开局生成地点时就确定实际值，读档不变）
export interface EventOptionDef {
  id: string;
  label: string;
  desc: string;
  cost: Partial<Record<ItemId, number>>;
  work: number;
  fatigue?: number; // 执行小组每人额外疲劳
  reward: Partial<Record<ItemId, [number, number]>>;
  research?: [number, number]; // 研究点（投入研究储备）
}

export const EVENT_DEFS = {
  facility: {
    title: '废弃设施',
    desc: '一座旧时代的轨道维护站，部分设备仍可启动。',
    options: [
      { id: 'repair', label: '投入零件修复', desc: '修复动力与仓储，取出较多物资。', cost: { parts: 3 }, work: 120, reward: { parts: [5, 8], propellant: [15, 25], trainFuel: [1, 3] } },
      { id: 'salvage', label: '只回收现成物品', desc: '不修复，快速取走散落的物资。', cost: {}, work: 30, reward: { parts: [1, 2], propellant: [6, 10] } },
    ] as EventOptionDef[],
  },
  beacon: {
    title: '异常信标',
    desc: '一座仍在低功率运转的信标，编码方式不明。',
    options: [
      { id: 'record', label: '短暂记录', desc: '记录信号片段后离开。', cost: {}, work: 20, reward: {}, research: [5, 7] },
      { id: 'deep', label: '深入调查', desc: '接入列车能源，长时间解析信标内容。成员疲劳增加。', cost: { energy: 40 }, work: 90, fatigue: 15, reward: {}, research: [16, 22] },
    ] as EventOptionDef[],
  },
  nativeMine: {
    title: '原住民矿区',
    desc: '矿点位于原住民领地内，作业需要对方许可。',
  },
};

export const PERMIT = {
  duration: 480, // 许可有效期（分钟）
  payCost: { food: 12, parts: 1 } as Partial<Record<ItemId, number>>,
  payCap: 160, // 支付许可：最多开采单位
  sharePct: 0.3, // 分享产出：交给原住民的比例
  shareCap: 200,
  cooperative: { payFoodMult: 0.5, sharePct: 0.2 }, // 合作关系的优惠
};

export const RELATION = {
  cooperativeAt: 30,
  waryAt: -30,
  contact: 5,
  trade: 2,
  permitPaid: 4,
  shareStep: 1, // 每完成一次分享交付
  shareMax: 10, // 分享带来的关系提升上限
};

// ---------------- 乘客培训与职业资格（原型参数） ----------------
// 职业资格：对应技能达到门槛即具备（背景职业不变）。医疗资格沿用医疗岗位门槛，本阶段不开放医疗课程。
export const QUAL_SKILL = { pilot: 'piloting', surveyor: 'survey', miner: 'mining', engineer: 'engineering', medic: 'medical' } as const;
export const QUAL_THRESHOLD: Record<keyof typeof QUAL_SKILL, number> = { pilot: 40, surveyor: 35, miner: 35, engineer: 40, medic: 40 };
export const FIELD_MIN_AGE = 18; // 未成年人不得承担出勤岗位或参加出勤课程

export interface CourseDef {
  id: string;
  prof: 'pilot' | 'surveyor' | 'miner' | 'engineer';
  label: string;
  gain: number; // 课程总提升（逐分钟获得，取消后保留已得部分）
  time: number; // 标准时长（分钟）
  cost: Partial<Record<ItemId, number>>; // 每人每课程只付一次
  unlock: string;
}

export const COURSES: CourseDef[] = [
  { id: 'pilotBasic', prof: 'pilot', label: '驾驶基础', gain: 22, time: 300, cost: { propellant: 12, energy: 20 }, unlock: '可在出勤小组担任驾驶员' },
  { id: 'surveyBasic', prof: 'surveyor', label: '勘探基础', gain: 20, time: 240, cost: { energy: 25 }, unlock: '可在出勤小组担任勘探员' },
  // 采掘基础只耗能源：开局铁矿为 0，且铁矿要优先用于主驱动维修零件与运输机制造
  { id: 'miningBasic', prof: 'miner', label: '采掘基础', gain: 22, time: 240, cost: { energy: 30 }, unlock: '可在出勤小组担任采掘工' },
  { id: 'engBasic', prof: 'engineer', label: '工程基础', gain: 20, time: 300, cost: { parts: 1, energy: 20 }, unlock: '可在出勤小组担任工程师（列车岗位仍按背景分配）' },
];

export const TRAINING = {
  baseSeats: 2, // 原型起始配置：科研医疗车 2 个基础培训位
  expansions: [{ add: 2, items: { parts: 3, iron: 12 } as Partial<Record<ItemId, number>>, time: 60, label: '培训位扩建' }],
  mentorMin: 55, // 导师所需技能
  perMentor: 2, // 每名导师同时最多带教人数
  minHealth: 50, // 报名与持续培训所需健康
  maxFatigue: 70, // 报名所需疲劳上限
  pauseFatigue: 85, // 疲劳高于此值自动暂停
  pauseHealth: 40,
  fatigueHour: 2, // 学员每小时疲劳（不工作但学习）
  energyHour: 3, // 每名在训学员每小时耗能
  // 在岗学习：只提升已有资格的技能，仅在实际执行对应工作时；越高越慢；上限
  onJob: { pilot: 0.004, surveyor: 0.008, miner: 0.005, engineer: 0.002 },
  onJobCap: 75,
};
