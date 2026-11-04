// 内容定义：物品、配方、研究、人员名单、星球模板。
// 名单为【临时测试名单】，完整候选池与故事将在后续阶段接入。

import type { HeadRole, ItemId, Personality, Profession, RawId, SkillId, TrainDept } from '../sim/types';

export const ITEM_INFO: Record<ItemId, { label: string; unit: string; desc: string }> = {
  iron: { label: '铁矿', unit: '单位', desc: '原料。加工维修零件。' },
  copper: { label: '铜矿', unit: '单位', desc: '原料。加工维修零件。' },
  ice: { label: '冰晶', unit: '单位', desc: '原料。制推进剂、电解制氧、轨道燃料辅料。' },
  crystal: { label: '辉晶', unit: '单位', desc: '原料。制造列车轨道燃料。' },
  bio: { label: '生物样本', unit: '份', desc: '基因研究与强化所需样本。' },
  parts: { label: '维修零件', unit: '件', desc: '维修主驱动、运输机维护、升级。' },
  trainFuel: { label: '轨道燃料', unit: '单位', desc: '列车专用燃料，离站航行必须。' },
  propellant: { label: '运输机推进剂', unit: '单位', desc: '运输机专用燃料，与列车燃料不通用。' },
  food: { label: '食物', unit: '份', desc: '全员每日配给。' },
  oxygen: { label: '氧气', unit: 'm³', desc: '生命维持。' },
  energy: { label: '能源', unit: 'kWh', desc: '列车各系统与加工设备用电。' },
};

export const RAW_IDS: RawId[] = ['iron', 'copper', 'ice', 'crystal', 'bio'];

export interface Recipe {
  id: string;
  label: string;
  inputs: Partial<Record<ItemId, number>>;
  outputs: Partial<Record<ItemId, number>>;
  time: number; // 标准效率下分钟
  desc: string;
}

export const RECIPES: Recipe[] = [
  { id: 'parts', label: '维修零件', inputs: { iron: 4, copper: 2 }, outputs: { parts: 1 }, time: 18, desc: '4 铁矿 + 2 铜矿 → 1 维修零件' },
  { id: 'trainFuel', label: '轨道燃料', inputs: { crystal: 3, ice: 1 }, outputs: { trainFuel: 1 }, time: 20, desc: '3 辉晶 + 1 冰晶 → 1 轨道燃料（列车用）' },
  { id: 'propellant', label: '运输机推进剂', inputs: { ice: 3 }, outputs: { propellant: 6 }, time: 10, desc: '3 冰晶 → 6 推进剂（运输机用）' },
  { id: 'oxygen', label: '电解制氧', inputs: { ice: 2 }, outputs: { oxygen: 60 }, time: 8, desc: '2 冰晶 → 60 m³ 氧气' },
];

export interface ResearchProject {
  id: string;
  label: string;
  cost: number; // 研究点
  items: Partial<Record<ItemId, number>>;
  desc: string;
}

export const RESEARCH: ResearchProject[] = [
  { id: 'geneMining', label: '采掘适应序列解析', cost: 24, items: { bio: 1 }, desc: '解锁基因强化「采掘适应序列·一阶」' },
  { id: 'propellantRefine', label: '推进剂提纯工艺', cost: 16, items: { ice: 6 }, desc: '推进剂配方产出 +2' },
];

// 尚未实现的远期内容，仅作展示，不可操作
export const FUTURE_SEQUENCES = ['探索感知序列（后续阶段）', '高阶采掘序列（后续阶段）'];

export const PROFESSION_INFO: Record<Profession, { label: string; dept: TrainDept }> = {
  pilot: { label: '驾驶员', dept: 'logistics' },
  surveyor: { label: '勘探员', dept: 'research' },
  miner: { label: '采掘工', dept: 'engineering' },
  engineer: { label: '工程师', dept: 'engineering' },
  medic: { label: '医护', dept: 'medical' },
  researcher: { label: '研究员', dept: 'research' },
  logistics: { label: '后勤', dept: 'logistics' },
  general: { label: '无专长', dept: 'logistics' },
};

export const DEPT_INFO: Record<TrainDept, { label: string; skill: SkillId; car: string }> = {
  engineering: { label: '工程', skill: 'engineering', car: 'cargo' },
  logistics: { label: '后勤', skill: 'logistics', car: 'galley' },
  medical: { label: '医疗', skill: 'medical', car: 'lab' },
  research: { label: '科研', skill: 'research', car: 'lab' },
};

export const SKILL_LABEL: Record<SkillId, string> = {
  piloting: '驾驶',
  survey: '勘探',
  mining: '采掘',
  engineering: '工程',
  medical: '医疗',
  research: '科研',
  logistics: '后勤',
};

export const HEAD_INFO: Record<HeadRole, { label: string; dept: TrainDept | null }> = {
  deputy: { label: '副手', dept: null },
  engineering: { label: '工程负责人', dept: 'engineering' },
  research: { label: '科研负责人', dept: 'research' },
  medical: { label: '医疗负责人', dept: 'medical' },
  logistics: { label: '后勤负责人', dept: 'logistics' },
};

export const CARS: { id: string; label: string; open: boolean }[] = [
  { id: 'engine', label: '车头', open: true },
  { id: 'dorm1', label: '居住车 A', open: true },
  { id: 'dorm2', label: '居住车 B', open: true },
  { id: 'galley', label: '后勤生活车', open: true },
  { id: 'cargo', label: '工程货运车', open: true },
  { id: 'lab', label: '科研医疗车', open: true },
  { id: 'sealed1', label: '封闭车厢 Ⅰ', open: false },
  { id: 'sealed2', label: '封闭车厢 Ⅱ', open: false },
];

export interface RosterEntry {
  name: string;
  profession: Profession;
  skills: Partial<Record<SkillId, number>>;
  head?: HeadRole;
  personality?: Personality;
  compatibility: number;
}

// 【临时测试名单】
export const ROSTER: RosterEntry[] = [
  { name: '沈既白', profession: 'pilot', head: 'deputy', skills: { piloting: 70, logistics: 55 }, compatibility: 60 },
  { name: '韩铁铮', profession: 'engineer', head: 'engineering', skills: { engineering: 72 }, compatibility: 55 },
  { name: '林知遥', profession: 'researcher', head: 'research', skills: { research: 74, survey: 40 }, compatibility: 62 },
  { name: '苏晴岚', profession: 'medic', head: 'medical', skills: { medical: 76 }, compatibility: 58 },
  { name: '周满仓', profession: 'logistics', head: 'logistics', skills: { logistics: 70 }, compatibility: 50 },
  { name: '陆行舟', profession: 'pilot', skills: { piloting: 62, mining: 20 }, personality: 'steady', compatibility: 64 },
  { name: '高远', profession: 'pilot', skills: { piloting: 58, survey: 30 }, personality: 'bold', compatibility: 71 },
  { name: '方小帆', profession: 'pilot', skills: { piloting: 40 }, compatibility: 45 },
  { name: '白芷', profession: 'surveyor', skills: { survey: 60, research: 25 }, compatibility: 66 },
  { name: '秦望', profession: 'surveyor', skills: { survey: 55 }, compatibility: 52 },
  { name: '唐砚', profession: 'surveyor', skills: { survey: 38 }, compatibility: 40 },
  { name: '石磊', profession: 'miner', skills: { mining: 60, engineering: 25 }, compatibility: 73 },
  { name: '吴大川', profession: 'miner', skills: { mining: 52 }, compatibility: 61 },
  { name: '赵铮', profession: 'miner', skills: { mining: 56 }, compatibility: 48 },
  { name: '马骁', profession: 'miner', skills: { mining: 48 }, compatibility: 69 },
  { name: '孙岩', profession: 'miner', skills: { mining: 35 }, compatibility: 57 },
  { name: '何工', profession: 'engineer', skills: { engineering: 58 }, compatibility: 50 },
  { name: '钱焊', profession: 'engineer', skills: { engineering: 52 }, compatibility: 46 },
  { name: '杜衡', profession: 'engineer', skills: { engineering: 45 }, compatibility: 63 },
  { name: '许铆', profession: 'engineer', skills: { engineering: 40 }, compatibility: 52 },
  { name: '叶青', profession: 'medic', skills: { medical: 52 }, compatibility: 55 },
  { name: '罗安', profession: 'medic', skills: { medical: 30 }, compatibility: 60 },
  { name: '程星', profession: 'researcher', skills: { research: 55 }, compatibility: 58 },
  { name: '顾微', profession: 'researcher', skills: { research: 46 }, compatibility: 49 },
  { name: '郑禾', profession: 'logistics', skills: { logistics: 55 }, compatibility: 54 },
  { name: '冯米', profession: 'logistics', skills: { logistics: 48 }, compatibility: 47 },
  { name: '王灶', profession: 'logistics', skills: { logistics: 50 }, compatibility: 52 },
  { name: '李篮', profession: 'logistics', skills: { logistics: 42 }, compatibility: 59 },
  { name: '小满', profession: 'general', skills: { logistics: 25 }, compatibility: 65 },
];

export const GROUP_NAMES = ['灰隼组', '长明组', '第三组'];

export interface SignTemplate {
  label: string;
  guess: RawId;
  dist: number;
  angle: number; // 度
  hazard: number;
  deposits: { resource: RawId; name: string; reserve: number; slots: number }[];
  eventId?: string;
  emptyText?: string;
}

export const PLANET_TEMPLATE = {
  name: '灰岩星 K-7',
  desc: '低活性岩石星球，大气稀薄。列车停靠在古老轨道的锚点上。',
  width: 140,
  height: 90,
  signs: [
    { label: '冰晶迹象', guess: 'ice', dist: 16, angle: 200, hazard: 0, deposits: [{ resource: 'ice', name: '浅层冰晶床', reserve: 420, slots: 2 }] },
    { label: '铁矿迹象', guess: 'iron', dist: 24, angle: 320, hazard: 0.05, deposits: [{ resource: 'iron', name: '赤岩铁矿区', reserve: 360, slots: 3 }] },
    { label: '铜矿迹象', guess: 'copper', dist: 30, angle: 70, hazard: 0.05, deposits: [{ resource: 'copper', name: '孔雀石沟', reserve: 160, slots: 1 }] },
    { label: '铜矿迹象', guess: 'copper', dist: 38, angle: 140, hazard: 0, deposits: [], emptyText: '迹象微弱，只是零散碎屑，没有可采矿点。' },
    { label: '辉晶迹象', guess: 'crystal', dist: 36, angle: 20, hazard: 0.25, deposits: [{ resource: 'crystal', name: '辉晶裂谷', reserve: 220, slots: 2 }] },
    { label: '生物迹象', guess: 'bio', dist: 33, angle: 250, hazard: 0.1, deposits: [{ resource: 'bio', name: '岩缝孢子群落', reserve: 10, slots: 1 }], eventId: 'beacon' },
    { label: '辉晶迹象', guess: 'crystal', dist: 50, angle: 110, hazard: 0.15, deposits: [{ resource: 'crystal', name: '远岭辉晶脉', reserve: 160, slots: 1 }, { resource: 'copper', name: '远岭铜矿', reserve: 100, slots: 1 }] },
    { label: '铁矿迹象', guess: 'iron', dist: 46, angle: 280, hazard: 0.1, deposits: [{ resource: 'iron', name: '黑砂铁滩', reserve: 200, slots: 1 }] },
  ] as SignTemplate[],
};

// 生物迹象采集速度系数（样本稀少）
export const RESOURCE_MINE_MULT: Record<RawId, number> = { iron: 1, copper: 0.9, ice: 1.2, crystal: 0.8, bio: 0.12 };

export const EVENTS: Record<string, { title: string; text: string; reward: Partial<Record<RawId, number>> }> = {
  beacon: {
    title: '古代轨道信标',
    text: '岩缝深处埋着一座半截信标，表面刻着与列车车头相同的纹路。小组带回了附着其上的生物样本。信标的意义尚不清楚。',
    reward: { bio: 3 },
  },
};
