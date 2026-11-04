// 星空列车 · 模拟状态类型
// 所有状态都是可 JSON 序列化的纯数据，便于存档与测试。

export type RawId = 'iron' | 'copper' | 'ice' | 'crystal' | 'bio';
export type ItemId =
  | RawId
  | 'parts' // 维修零件
  | 'trainFuel' // 轨道燃料（列车专用）
  | 'propellant' // 运输机推进剂（运输机专用）
  | 'food'
  | 'oxygen'
  | 'energy';

export type Inventory = Record<ItemId, number>;

export type Profession =
  | 'pilot'
  | 'surveyor'
  | 'miner'
  | 'engineer'
  | 'medic'
  | 'researcher'
  | 'logistics'
  | 'general';

export type SkillId = 'piloting' | 'survey' | 'mining' | 'engineering' | 'medical' | 'research' | 'logistics';

export type HeadRole = 'deputy' | 'engineering' | 'research' | 'medical' | 'logistics';

export type Personality = 'steady' | 'bold';

export type TrainDept = 'engineering' | 'logistics' | 'medical' | 'research';

export interface Passenger {
  id: number;
  name: string;
  profession: Profession;
  skills: Record<SkillId, number>;
  health: number; // 0-100
  fatigue: number; // 0-100
  morale: number; // 0-100
  disappointment: number; // 0-100
  hostility: number; // 0-100
  sensitivity: number; // 情绪敏感度 0.6-1.4
  personality: Personality;
  compatibility: number; // 基因适配度 0-100
  isCaptain: boolean;
  headRole: HeadRole | null;
  groupId: number | null;
  carId: string; // 居住车厢
  genes: string[]; // 已植入序列
  recoveringUntil: number; // 基因强化后恢复，-1 表示无
  aboard: boolean;
  leftBehind: boolean;
}

export type GroupStateKind =
  | 'docked' // 在列车待命/决策
  | 'resting' // 休整
  | 'grounded' // 无法出勤（缺人/无运输机/无燃料）
  | 'toExplore'
  | 'exploring'
  | 'toSite'
  | 'waitingSlot'
  | 'deploying'
  | 'mining'
  | 'returning'
  | 'unloading';

export interface GroupTarget {
  kind: 'explore' | 'mine';
  signId?: number;
  depositId?: number;
  slotId?: number;
}

export interface Decision {
  time: number;
  text: string;
}

export interface Group {
  id: number;
  name: string;
  leaderId: number | null;
  memberIds: number[];
  shuttleId: number | null;
  points: number; // 贡献点（小组共有）
  pointsEarned: number;
  pointsSpent: number;
  state: GroupStateKind;
  stateSince: number;
  timer: number; // 当前状态剩余分钟（探索、部署、卸货、休整、等待）
  target: GroupTarget | null;
  status: string; // 可读状态
  reason: string; // 当前理由
  decisions: Decision[];
  missing: string[]; // 编组缺少的职业
  pendingReform: boolean;
  recalled: boolean;
  returnReason: string;
  lastCargoFullRatio: number;
  trips: number;
  purchases: string[];
}

export type ShuttleModel = 'hauler' | 'miner' | 'scout';

export interface CargoBatch {
  id: number; // 批次号，结算一次后作废
  items: Partial<Record<RawId, number>>;
  settled: boolean;
}

export interface Shuttle {
  id: number;
  name: string;
  model: ShuttleModel;
  level: number;
  upgrades: string[];
  fuel: number;
  durability: number;
  x: number;
  y: number;
  docked: boolean;
  assignedTo: 'group' | 'captain';
  cargo: CargoBatch;
}

export interface Slot {
  id: number;
  holderGroupId: number | null;
  status: 'free' | 'working' | 'reserved';
  reservedUntil: number; // 保留截止（游戏分钟），-1 表示无
}

export interface Deposit {
  id: number;
  signId: number;
  resource: RawId;
  name: string;
  x: number;
  y: number;
  reserve: number;
  initialReserve: number;
  slots: Slot[];
  hazard: number; // 0-1 风险
  discoveredBy: number | null;
  discoveredAt: number;
}

export interface Sign {
  id: number;
  label: string; // 例如 "铁矿迹象"
  guess: RawId;
  x: number;
  y: number;
  radius: number;
  revealed: boolean; // 被扫描揭示
  explored: boolean;
  exploringGroupId: number | null;
  hazard: number;
  eventId: string | null;
  resultText: string;
}

export interface PlanetState {
  name: string;
  width: number;
  height: number;
  trainX: number;
  trainY: number;
  scanned: boolean;
  scanProgress: number; // -1 未开始
  signs: Sign[];
  deposits: Deposit[];
  hazardZones: { x: number; y: number; r: number }[];
}

export interface ProcessJob {
  id: number;
  recipeId: string;
  remaining: number; // 剩余工时（分钟，按 1.0 效率）
  total: number;
  started: boolean;
}

export type Phase = 'intro' | 'planet' | 'travel' | 'station' | 'failed';

export interface Policies {
  rations: 'lean' | 'normal' | 'rich';
  workload: 'light' | 'normal' | 'overtime';
  reservePartsForDrive: boolean;
  basicRadius: number; // 基本任务半径（km）
  security: 'standby' | 'patrol';
}

export interface LogEntry {
  t: number;
  cat: 'system' | 'group' | 'economy' | 'danger' | 'mood' | 'station' | 'research';
  text: string;
}

export interface MoodFactor {
  label: string;
  morale: number; // 每小时影响
  disappointment: number;
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;
  time: number; // 游戏分钟
  paused: boolean;
  speed: number;
  phase: Phase;
  nextId: number;
  passengers: Passenger[];
  groups: Group[];
  shuttles: Shuttle[];
  groupRequirement: Partial<Record<Profession, number>>;
  planet: PlanetState | null;
  inventory: Inventory;
  credits: number; // 星币（外部交易货币）
  demandBonus: Record<RawId, number>;
  pointsIssued: number;
  queue: ProcessJob[];
  train: {
    hull: number;
    driveRepair: number; // 已投入维修零件
    driveRepaired: boolean;
    driveRepairTimer: number; // >0 正在维修
    lifeSupport: number; // 0-1 效率
  };
  research: {
    done: string[];
    current: string | null;
    progress: number;
  };
  policies: Policies;
  robots: { count: number; condition: number };
  catastrophe: {
    trueArrival: number;
    bias: number;
    warned: boolean;
    edgeWarned: boolean;
    arrived: boolean;
    chase: number; // 追赶进度 0-100（离开星球后）
  };
  recallActive: boolean;
  travel: { progress: number; duration: number } | null;
  station: {
    docked: boolean;
    feePaid: boolean;
    trades: number;
    repairs: number;
    summaryShown: boolean;
    arrivalTime: number;
  };
  moodFactors: MoodFactor[];
  boosts: { label: string; until: number; morale: number }[];
  log: LogEntry[];
  toasts: { t: number; title: string; text: string }[];
  objectivesDone: string[];
  stats: {
    deliveries: number;
    rawDelivered: Partial<Record<RawId, number>>;
    upgrades: number;
    genes: number;
    leftBehind: number;
    departedAt: number;
  };
  failReason: string;
  edgePauseTriggered: boolean;
}
