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
  profession: Profession; // 原始背景（不随培训改变）
  age: number;
  quals: Profession[]; // 已取得的职业资格（技能达到门槛；组队按资格而非背景）
  coursesDone: string[]; // 已完成的课程（同一课程不重复领取）
  courseProgress: Record<string, number>; // 课程进度 0-1（取消后保留，重报从此继续）
  coursePaid: Record<string, boolean>; // 该课程材料是否已付（每人每课程只付一次）
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
  | 'unloading'
  | 'toEvent' // 前往事件地点执行玩家选定的方案
  | 'eventWork'; // 在事件地点作业

export interface GroupTarget {
  kind: 'explore' | 'mine' | 'event';
  signId?: number;
  depositId?: number;
  slotId?: number;
  eventId?: number;
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
  memberRoles: Record<number, Profession>; // 每名成员在组内承担的唯一名额（一人只占一个名额）
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
  loot: Partial<Record<ItemId, number>>; // 野外取得、待带回列车的物资
  lootResearch: number;
  pendingSwap: number | null; // 列车长安排的「返航卸货后换装」备用机 id
  exploreStreak: number; // 连续探索、尚未带回原料的次数
}

export type ShuttleModel = 'hauler' | 'miner' | 'scout';

export interface CargoBatch {
  id: number; // 批次号，结算一次后作废
  items: Partial<Record<RawId, number>>;
  settled: boolean;
  /** 按「分享产出」协议应交给原住民的部分（已包含在 items 中，结算时扣出，不进列车库存、不计贡献点） */
  owed: Partial<Record<RawId, number>>;
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
  /** group=某小组主运输机；captain=列车长座机；spare=备用（停在机库，待分配或待原订购组领取） */
  assignedTo: 'group' | 'captain' | 'spare';
  cargo: CargoBatch;
  serial: string; // 唯一编号
  ownerGroupId: number | null; // 出资小组；null 表示列车公共资产
  builtAt: number; // 完工时间，-1 表示开局即有
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
  /** open=可自由作业；permit=原住民领地，需协商许可；hostile=敌对禁区，不可作业 */
  zone: 'open' | 'permit' | 'hostile';
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
  /** resource=资源迹象；ruin=遗迹/异常信号（可能有遗留物资或调查数据）；natives=原住民聚落信号 */
  kind: 'resource' | 'ruin' | 'natives';
  restricted: boolean; // 位于敌对禁区内，小组不会接近
  loot: Partial<Record<ItemId, number>>; // 遗迹中的遗留物资（探索后带回，只发一次）
  research: number; // 调查数据（研究点）
  lootTaken: boolean;
  /** 需要决策的探索事件类型（发现时生成事件），以及预先确定的结果 */
  eventKind?: EventKind;
  eventRolls?: Record<string, number>;
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
  resourceProfile: ResourceProfile;
  natives: NativesState;
  deliveries: number; // 在本星球完成的交付结算次数（真实结算记录）
  /** 本星球的灾变预警记录（每颗星球单独提示） */
  warned: boolean;
  edgeWarned: boolean;
}

export type ResourceProfile = 'rich' | 'poor' | 'barren';
export type NativeKind = 'none' | 'friendly' | 'hostile';

export interface NativeTrade {
  id: string;
  give: Partial<Record<ItemId, number>>; // 列车付出
  get: Partial<Record<ItemId, number>>; // 列车得到
  stock: number; // 剩余可交易次数
}

export interface NativesState {
  kind: NativeKind;
  name: string;
  x: number;
  y: number;
  r: number; // 领地 / 禁区半径
  detected: boolean; // 扫描后知道存在（友好为聚落信号，敌对为禁区）
  contacted: boolean; // 友好：小组实地接触后建立联系
  permitGranted: boolean; // 旧版本的整片领地许可（v4 存档迁移用；新协议见 permits）
  permitCost: Partial<Record<ItemId, number>>;
  trades: NativeTrade[];
  /** 当地关系（每颗星球独立）：-100～100 */
  relation: number;
  relationLog: { t: number; delta: number; reason: string }[];
  permits: Permit[];
  sharePaid: number; // 已按协议分享的单位数（关系加成封顶用）
}

/** 原住民采矿许可协议（限定矿点、有效期与开采上限） */
export interface Permit {
  id: number;
  depositId: number;
  kind: 'pay' | 'share';
  sharePct: number; // share 协议：交给原住民的比例
  grantedAt: number;
  expiresAt: number;
  cap: number; // 许可内最多开采单位
  extracted: number;
  paid: Partial<Record<ItemId, number>>;
}

export type EventKind = 'facility' | 'nativeMine' | 'beacon';
export type EventStatus = 'pending' | 'assigned' | 'active' | 'done' | 'declined' | 'expired';

/** 探索事件（需要列车长决策的重大投入 / 外交 / 风险） */
export interface ExploreEvent {
  id: number;
  kind: EventKind;
  nodeIndex: number; // 所在航线节点
  planetName: string;
  siteId: number; // 迹象 id（设施、信标）或矿点 id（原住民矿区）；同一地点只生成一次
  x: number;
  y: number;
  title: string;
  finderGroupId: number | null;
  discoveredAt: number;
  status: EventStatus;
  choice: string | null;
  assignedGroupId: number | null; // 执行小组
  work: number; // 需要的现场作业分钟
  remaining: number; // 剩余作业分钟（中断后保留）
  paid: Partial<Record<ItemId, number>>; // 已投入（选择时扣除）
  /** 开局生成事件地点时预先确定的结果（读档不会重新随机） */
  rolls: Record<string, number>;
  result: string;
  rewardGiven: boolean;
  log: string[];
}

/** 航线节点：星球或公共交易站。星球地图在开局时一次生成并随存档保存。 */
export interface RouteNode {
  id: number;
  kind: 'planet' | 'station';
  name: string;
  pos: number; // 轨道里程（Mm）
  intel: string; // 远程情报（到达前可见，不一定精确）
  /** 非当前星球的地图数据；当前所在星球的地图在 GameState.planet 中（同一时刻只有一处持有，避免存档重复） */
  planet: PlanetState | null;
  status: 'unvisited' | 'current' | 'visited' | 'skipped';
  arrivedAt: number;
  departedAt: number;
  notes: string[]; // 访问记录摘要
}

export type JobKind = 'recipe' | 'shuttle' | 'hangar' | 'training';

export interface ProcessJob {
  id: number;
  kind: JobKind;
  recipeId: string; // recipe：配方 id；shuttle：型号；hangar：扩建级别
  remaining: number; // 剩余工时（分钟，按 1.0 效率）
  total: number;
  started: boolean;
  orderedBy: number | null; // 下单小组 id；null 表示列车长（公共物资）
  reserved: Partial<Record<ItemId, number>>; // 下单时已扣除的材料，取消时原样返还
  pointsPaid: number; // 小组已支付的贡献点，取消时原样返还
  orderedAt: number;
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
  hangar: { capacity: number; level: number };
  shuttleSerial: number; // 已发放的运输机编号数
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
    bank: number; // 遗迹调查数据（研究点储备，自动投入当前研究）
  };
  policies: Policies;
  robots: { count: number; condition: number };
  catastrophe: {
    front: number; // 灾变前锋的轨道里程（Mm），沿航线追赶列车
    bias: number; // 预测偏差（随距离缩小）
    arrived: boolean; // 前锋已越过当前停靠的星球
    lastMilestone: number; // 已提示的加速阶段
  };
  journey: {
    nodes: RouteNode[];
    current: number; // 列车所在（或刚离开）的节点
    dest: number | null; // 航行目的地
    pos: number; // 列车轨道里程
  };
  recallActive: boolean;
  travel: { progress: number; duration: number; from: number; to: number; fuel: number } | null;
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
  formationNote: string; // 最近一次「无法成立新组」的原因（只在变化时记录日志）
  events: ExploreEvent[];
  training: TrainingState;
}

/** 脱产培训 */
export interface Enrollment {
  id: number;
  courseId: string;
  traineeId: number;
  mentorId: number | null; // 当前授课导师（暂停时释放）
  startedAt: number;
  manualPause: boolean;
  pauseReason: string; // 自动暂停原因（空 = 正在进行）
  skillStart: number;
}

export interface TrainingState {
  seats: number; // 培训设施名额（科研医疗车的基础培训位）
  level: number; // 已扩容次数
  enrollments: Enrollment[];
}
