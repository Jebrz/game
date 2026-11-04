// 侧边详细面板（每个标签一个函数，返回 HTML）

import { DEMAND_BONUS, GENE, GROUPS, ROBOTS, SHUTTLE_MODELS, SHUTTLE_UPGRADES, STATION, SURVIVAL, TRAIN, TRAIN_MIN_STAFF } from '../config/balance';
import { CARS, DEPT_INFO, FUTURE_SEQUENCES, HEAD_INFO, ITEM_INFO, PROFESSION_INFO, RAW_IDS, RECIPES, RESEARCH } from '../config/content';
import * as A from '../sim/actions';
import { estimate, stage, STAGE_LABEL } from '../sim/catastrophe';
import { SLOT_RESERVE_MINUTES } from '../sim/claims';
import { clockText, fmt, fmtTime, groupShuttle, members } from '../sim/core';
import { geneEligibility, geneTrainBlock, purchaseOptions, unitPrice } from '../sim/economy';
import { recallInfo } from '../sim/groupAI';
import { leaderPersonality } from '../sim/groups';
import { cargoCap, cargoUsed, fuelPerKm, speed, tank } from '../sim/shuttles';
import { deptStats, processingSpeed } from '../sim/staff';
import { deterrence, moodFactors, moodSummary } from '../sim/survival';
import { recipeOutputs } from '../sim/train';
import type { GameState, ItemId, Passenger, Profession, RawId, TrainDept } from '../sim/types';
import { bar, btn, esc, sbtn } from './html';

export type TabId = 'train' | 'groups' | 'shuttles' | 'industry' | 'policy' | 'research' | 'people' | 'mood' | 'recall' | 'station';

export const TABS: { id: TabId; label: string }[] = [
  { id: 'train', label: '列车' },
  { id: 'groups', label: '小组' },
  { id: 'shuttles', label: '运输机' },
  { id: 'industry', label: '库存加工' },
  { id: 'policy', label: '奖励政策' },
  { id: 'research', label: '研究基因' },
  { id: 'people', label: '乘客' },
  { id: 'mood', label: '情绪安保' },
  { id: 'recall', label: '灾变召回' },
  { id: 'station', label: '交易站' },
];

const PERS = { steady: '稳健', bold: '进取' };
const MODEL_LABEL = (m: keyof typeof SHUTTLE_MODELS) => SHUTTLE_MODELS[m].label;

export function renderPanel(s: GameState, tab: TabId): string {
  switch (tab) {
    case 'train':
      return trainPanel(s);
    case 'groups':
      return groupsPanel(s);
    case 'shuttles':
      return shuttlesPanel(s);
    case 'industry':
      return industryPanel(s);
    case 'policy':
      return policyPanel(s);
    case 'research':
      return researchPanel(s);
    case 'people':
      return peoplePanel(s);
    case 'mood':
      return moodPanel(s);
    case 'recall':
      return recallPanel(s);
    case 'station':
      return stationPanel(s);
  }
}

// ---------------- 列车 ----------------
function trainPanel(s: GameState): string {
  const t = s.train;
  const P = s.planet;
  const ds = deptStats(s);
  const phase = { intro: '苏醒中', planet: `停靠 ${P?.name ?? ''}`, travel: '轨道航行中', station: `停泊 ${STATION.name}`, failed: '失败' }[s.phase];
  let h = `<h3>列车概况 · ${esc(phase)}</h3>`;
  h += `<div>车体完整度 <b>${fmt(t.hull)}%</b>${bar(t.hull / 100, t.hull < 40 ? 'bad' : 'warm')}</div>`;
  h += `<div>生命维持效率 <b>${fmt(t.lifeSupport * 100)}%</b> <span class="note">（旧设备，产氧 ${fmt(SURVIVAL.lifeSupportOxygenHour * t.lifeSupport)} m³/小时）</span></div>`;

  h += `<h4>主驱动</h4>`;
  if (t.driveRepaired) h += `<div class="ok">✔ 已修复</div>`;
  else if (t.driveRepairTimer > 0) h += `<div>维修中…剩余约 ${fmtTime(t.driveRepairTimer / Math.max(0.2, A_speed(s)))}</div>${bar(1 - t.driveRepairTimer / TRAIN.driveRepairTime, 'warm')}`;
  else {
    h += `<div class="badtext">受损：需要 ${TRAIN.driveRepairParts} 件维修零件（库存 ${fmt(s.inventory.parts)}）</div>`;
    h += `<div class="row">${btn('投入零件，开始维修', 'repairDrive', '', A.canRepairDrive(s), 'primary')}</div>`;
  }
  h += `<div>轨道燃料（列车专用） <b>${fmt(s.inventory.trainFuel)}/${TRAIN.fuelForDeparture}</b> 单位 ${bar(s.inventory.trainFuel / TRAIN.fuelForDeparture, 'warm')}</div>`;

  if (s.phase === 'planet' && P) {
    h += `<h4>列车探测仪（低级）</h4>`;
    if (P.scanned) h += `<div class="ok">✔ 已扫描：${P.signs.length} 处资源迹象。具体矿点需小组实地探索确认。</div>`;
    else if (P.scanProgress >= 0) h += `<div>扫描中 ${P.scanProgress}/${TRAIN.scanTime} 分</div>${bar(P.scanProgress / TRAIN.scanTime)}`;
    else h += `<div class="row">${btn(`启动扫描（能源 ${TRAIN.scanEnergy} kWh）`, 'scan', '', A.canScan(s), 'primary')}</div><div class="note">只能揭示资源迹象的大致范围，不会直接告诉你矿点位置与储量。</div>`;

    h += `<h4>离站</h4>`;
    const why = A.canDepart(s);
    h += `<ul class="plain">
      <li class="${t.driveRepaired ? 'ok' : ''}">主驱动修复 ${t.driveRepaired ? '✔' : '✘'}</li>
      <li class="${s.inventory.trainFuel >= TRAIN.fuelForDeparture ? 'ok' : ''}">轨道燃料 ≥ ${TRAIN.fuelForDeparture} ${s.inventory.trainFuel >= TRAIN.fuelForDeparture ? '✔' : '✘'}</li>
      <li class="${A.outsideGroups(s).length ? '' : 'ok'}">全员归队 ${A.outsideGroups(s).length ? '✘' : '✔'}</li></ul>`;
    h += `<div class="row">${btn('离站航行', 'depart', '', why, 'primary')}</div>`;
    const fw = A.canForceDepart(s);
    if (!fw) h += `<div class="row">${btn('强行离站（遗留未归人员）', 'forceDepartAsk', '', '', 'danger')}<span class="note">严重行为：会遗留人员与运输机，全体敌意大增</span></div>`;
  }
  if (s.phase === 'travel' && s.travel) {
    h += `<h4>航行</h4><div>前往 ${STATION.name}：${fmt(s.travel.progress)}/${s.travel.duration} 分</div>${bar(s.travel.progress / s.travel.duration)}`;
  }
  if (s.phase !== 'planet') h += `<div>灾变追赶进度 <b>${fmt(s.catastrophe.chase, 1)}%</b> ${s.station.docked ? '<span class="note">（停泊期间暂停，离站后续接，不清零）</span>' : ''}</div>`;

  h += `<h4>列车岗位（自动分配）</h4><table><tr><th>部门</th><th class="num">人数</th><th class="num">有效产能</th><th>作用</th></tr>`;
  const effect: Record<TrainDept, string> = {
    engineering: `加工/维修速度 ×${fmt(processingSpeed(s), 2)}`,
    logistics: `水培食物 ${fmt(ds.logistics.eff * SURVIVAL.foodPerLogisticsEffHour, 1)} 份/小时`,
    medical: ds.medical.workers.length ? `治疗 +${fmt(SURVIVAL.healHour * Math.min(1, ds.medical.eff / 1.5), 1)} 健康/小时` : '<span class="badtext">无达标医护（门槛 40）</span>',
    research: `研究 ${fmt(ds.research.eff * 2.2, 1)} 点/小时`,
  };
  for (const d of Object.keys(ds) as TrainDept[]) {
    h += `<tr><td>${DEPT_INFO[d].label}</td><td class="num">${ds[d].workers.length}</td><td class="num">${fmt(ds[d].eff, 1)}</td><td>${effect[d]}</td></tr>`;
  }
  h += `</table><div class="note">普通岗位允许低技能人员低效工作；医疗岗位要求医疗技能 ≥ ${SURVIVAL.medicalSkillThreshold}。列车保留基本运营人员：${Object.entries(TRAIN_MIN_STAFF)
    .map(([k, v]) => `${PROFESSION_INFO[k as Profession].label}${v}`)
    .join('、')}。</div>`;

  h += `<h4>车厢</h4><ul class="plain">${CARS.map((c) => `<li>${c.label}${c.open ? '' : ' <span class="tag future">未开放（后续内容）</span>'}</li>`).join('')}</ul>`;
  return h;
}

function A_speed(s: GameState): number {
  return processingSpeed(s);
}

// ---------------- 小组 ----------------
function groupsPanel(s: GameState): string {
  let h = `<h3>出勤小组编组要求</h3><div class="note">列车长规定职业人数；乘客按要求自行组队。负责人与列车必需岗位不参与出勤，一人只承担一个主要岗位。出勤中的小组将在返回后重组。</div>`;
  const profs: Profession[] = ['pilot', 'surveyor', 'miner', 'engineer', 'medic'];
  h += `<table><tr><th>职业</th><th class="num">每组人数</th><th></th></tr>`;
  for (const p of profs) {
    const v = s.groupRequirement[p] ?? 0;
    h += `<tr><td>${PROFESSION_INFO[p].label}</td><td class="num">${v}</td><td>${sbtn('−', 'req', `${p}:${v - 1}`, v <= 0 ? '已为 0' : '')} ${sbtn('+', 'req', `${p}:${v + 1}`, v >= GROUPS.maxRequirementPerProfession ? '已达上限' : '')}</td></tr>`;
  }
  h += `</table>`;
  for (const g of s.groups) {
    const sh = groupShuttle(s, g);
    const leader = g.leaderId != null ? s.passengers.find((p) => p.id === g.leaderId) : null;
    h += `<div class="card"><div class="head"><b>${esc(g.name)}</b><span>贡献点 <b>${fmt(g.points, 1)}</b> <small class="note">（累计获得 ${fmt(g.pointsEarned, 1)} / 支出 ${fmt(g.pointsSpent, 1)}）</small></span></div>`;
    h += `<div>状态：<b>${esc(g.status)}</b></div>`;
    if (g.reason) h += `<div class="note">理由：${esc(g.reason)}</div>`;
    if (g.missing.length) h += `<div class="badtext">编组不足：缺少 ${esc(g.missing.join('、'))}</div>`;
    h += `<div>组长：${leader ? `${esc(leader.name)}（${PERS[leader.personality]}）` : '—'} · 运输机：${sh ? `${esc(sh.name)}（${MODEL_LABEL(sh.model)}）` : '<span class="badtext">无</span>'} · 往返 ${g.trips} 趟</div>`;
    if (g.memberIds.length) {
      h += `<table><tr><th>成员</th><th>职业</th><th class="num">采掘</th><th class="num">健康</th><th class="num">疲劳</th><th>状态</th></tr>`;
      for (const p of members(s, g)) {
        const st = p.recoveringUntil > s.time ? `强化恢复 ${fmtTime(p.recoveringUntil - s.time)}` : p.aboard ? '车上' : '外出';
        h += `<tr><td>${esc(p.name)}${p.genes.length ? '<span class="tag">序列</span>' : ''}</td><td>${PROFESSION_INFO[p.profession].label}</td><td class="num">${fmt(p.skills.mining)}</td><td class="num">${fmt(p.health)}</td><td class="num">${fmt(p.fatigue)}</td><td>${st}</td></tr>`;
      }
      h += `</table>`;
    }
    const opts = purchaseOptions(s, g);
    if (opts.length) {
      h += `<h4>可兑换项目（小组自主决定，无需批准）</h4><ul class="plain">${opts
        .map((o) => `<li>${esc(o.label)} · ${o.points} 点 ${o.blocked ? `<span class="why">${esc(o.blocked)}</span>` : '<span class="ok">可购买</span>'}</li>`)
        .join('')}</ul>`;
    }
    if (g.purchases.length) h += `<div>已购：${esc(g.purchases.join('、'))}</div>`;
    if (g.decisions.length) {
      h += `<h4>近期决策</h4><ul class="plain">${g.decisions
        .slice(0, 5)
        .map((d) => `<li><span class="note">${clockText(d.time).slice(-5)}</span> ${esc(d.text)}</li>`)
        .join('')}</ul>`;
    }
    h += `<div class="note">组长性格：${leader ? (leaderPersonality(s, g) === 'bold' ? '进取——接受更远、更危险的目标，偏好基因强化' : '稳健——回避风险，偏好运输机可靠性') : '—'}</div></div>`;
  }
  h += `<div class="note">费用划分：基本任务的推进剂与例行维护由列车承担；超出基本任务半径（${s.policies.basicRadius} km）的额外航程、升级与强化由小组贡献点支付。</div>`;
  return h;
}

// ---------------- 运输机 ----------------
function shuttlesPanel(s: GameState): string {
  let h = `<h3>运输机</h3><div class="note">运输机使用<b>运输机推进剂</b>，与列车的<b>轨道燃料</b>不通用。运输机直接到矿点采矿并运回原料，不做机载加工。本阶段共 ${s.shuttles.length} 架，不会凭空增加。</div>`;
  for (const sh of s.shuttles) {
    const g = s.groups.find((x) => x.shuttleId === sh.id);
    const spec = SHUTTLE_MODELS[sh.model];
    const items = Object.entries(sh.cargo.items).filter(([, v]) => (v ?? 0) > 0.01);
    h += `<div class="card"><div class="head"><b>${esc(sh.name)}</b><span>${spec.label} · Lv${sh.level}</span></div>`;
    h += `<div>使用者：${sh.assignedTo === 'captain' ? '列车长座机' : g ? esc(g.name) : '无'} · ${sh.docked ? '停靠列车' : '外出中'}</div>`;
    h += `<table>
      <tr><td>运载量</td><td class="num">${fmt(cargoUsed(sh))}/${cargoCap(sh)} 单位</td></tr>
      <tr><td>推进剂</td><td class="num">${fmt(sh.fuel, 1)}/${tank(sh)}</td></tr>
      <tr><td>耐久</td><td class="num ${sh.durability < 30 ? 'badtext' : ''}">${fmt(sh.durability)}/100</td></tr>
      <tr><td>航速</td><td class="num">${fmt(speed(sh), 1)} km/分</td></tr>
      <tr><td>油耗</td><td class="num">${fmt(fuelPerKm(sh), 2)} /km</td></tr>
      <tr><td>基础采矿效率</td><td class="num">${fmt(spec.mineRate * (sh.upgrades.includes('drill') ? 1.3 : 1), 2)} 单位/分</td></tr>
    </table>`;
    h += `<div>货舱：${items.length ? items.map(([k, v]) => `${ITEM_INFO[k as ItemId].label} ${fmt(v ?? 0)}`).join('、') : '空'} <span class="note">（批次 #${sh.cargo.id}）</span></div>`;
    h += `<div>升级：${sh.upgrades.length ? sh.upgrades.map((u) => SHUTTLE_UPGRADES.find((x) => x.id === u)!.label).join('、') : '无'}</div>`;
    h += `<div class="row">${
      sh.assignedTo === 'captain'
        ? btn('释放给小组', 'releaseShuttle', sh.id)
        : btn('配属为列车长座机', 'assignCaptain', sh.id, A.canAssignCaptain(s, sh.id))
    }</div></div>`;
  }
  h += `<div class="note">配属座机会让原使用小组停止出勤。列车长亲自驾驶探索为后续内容，本阶段仅支持配属与释放。</div>`;
  h += `<h4>可购买升级（由小组用贡献点购买，并消耗列车库存）</h4><table><tr><th>升级</th><th>效果</th><th class="num">贡献点</th><th>库存消耗</th></tr>`;
  for (const u of SHUTTLE_UPGRADES) h += `<tr><td>${u.label}</td><td>${u.desc}</td><td class="num">${u.points}</td><td>${Object.entries(u.items).map(([k, v]) => `${ITEM_INFO[k as ItemId].label} ${v}`).join('、')}</td></tr>`;
  h += `</table><div class="note">耐久低于 45 时列车承担例行维护（每件零件 +30）；低于 50 航速 ×0.85；低于 15 禁止出勤。</div>`;
  return h;
}

// ---------------- 库存与加工 ----------------
function industryPanel(s: GameState): string {
  let h = `<h3>列车库存</h3><table><tr><th>物品</th><th class="num">数量</th><th>用途</th></tr>`;
  for (const k of Object.keys(ITEM_INFO) as ItemId[]) {
    h += `<tr><td>${ITEM_INFO[k].label}</td><td class="num">${fmt(s.inventory[k], k === 'propellant' ? 1 : 0)} ${ITEM_INFO[k].unit}</td><td class="note">${ITEM_INFO[k].desc}</td></tr>`;
  }
  h += `</table>`;
  h += `<h3>加工设备（工程货运车）</h3><div class="note">原料在入队时预留扣除，取消退还。加工速度 ×${fmt(processingSpeed(s), 2)}（取决于工程人员），运行中耗能 ${SURVIVAL.processingEnergyHour} kWh/小时。不使用传送带。</div>`;
  for (const r of RECIPES) {
    const out = recipeOutputs(s, r.id);
    const r1 = A.canEnqueue(s, r.id, 1);
    const r5 = A.canEnqueue(s, r.id, 5);
    h += `<div class="card"><div class="head"><b>${r.label}</b><span class="note">${r.time} 分/件</span></div><div>${Object.entries(r.inputs)
      .map(([k, v]) => `${ITEM_INFO[k as ItemId].label} ${v}`)
      .join(' + ')} → ${Object.entries(out)
      .map(([k, v]) => `${ITEM_INFO[k as ItemId].label} ${v}`)
      .join(' + ')}</div><div class="row">${sbtn('加入 ×1', 'enqueue', `${r.id}:1`, r1)}${sbtn('加入 ×5', 'enqueue', `${r.id}:5`, r5)}${r1 ? `<span class="why">${esc(r1)}</span>` : ''}</div></div>`;
  }
  h += `<h4>生产队列（${s.queue.length}/12）</h4>`;
  if (!s.queue.length) h += `<div class="note">空闲</div>`;
  s.queue.forEach((j, i) => {
    const r = RECIPES.find((x) => x.id === j.recipeId)!;
    h += `<div class="row"><span>${i === 0 ? '▶' : `${i + 1}.`} ${r.label}</span>${i === 0 ? `<span style="flex:1">${bar(1 - j.remaining / j.total, 'warm')}</span>` : '<span style="flex:1"></span>'}${sbtn('取消', 'cancelJob', j.id)}</div>`;
  });
  if (s.queue.length && s.inventory.energy < 1) h += `<div class="badtext">能源耗尽，加工暂停</div>`;
  return h;
}

// ---------------- 需求奖励与政策 ----------------
function policyPanel(s: GameState): string {
  let h = `<h3>原料收购（需求奖励）</h3><div class="note">小组交付原料时，列车按「基础收购价 + 需求奖励」发放贡献点。提高某种原料的奖励，小组会自主倾向采集它。贡献点由列车发行，不是对外交易货币。</div>`;
  h += `<table><tr><th>原料</th><th class="num">基础价</th><th class="num">奖励</th><th></th><th class="num">当前收购价</th><th class="num">库存</th></tr>`;
  for (const r of RAW_IDS) {
    const b = s.demandBonus[r];
    h += `<tr><td>${ITEM_INFO[r].label}</td><td class="num">${unitPrice(s, r) - b}</td><td class="num">+${b}</td><td>${sbtn('−', 'bonus', `${r}:${b - DEMAND_BONUS.step}`, b <= DEMAND_BONUS.min ? '已最低' : '')} ${sbtn('+', 'bonus', `${r}:${b + DEMAND_BONUS.step}`, b >= DEMAND_BONUS.max ? '已最高' : '')}</td><td class="num"><b>${unitPrice(s, r)}</b> 点/单位</td><td class="num">${fmt(s.inventory[r])}</td></tr>`;
  }
  h += `</table><div class="note">已发行贡献点合计：${fmt(s.pointsIssued, 1)}</div>`;

  const pol = s.policies;
  const opt = (key: string, val: string, label: string, cur: string) => sbtn(label, 'policy', `${key}:${val}`, '', cur === val ? 'on' : '');
  h += `<h3>列车政策</h3>`;
  h += `<h4>配给标准</h4><div class="row">${opt('rations', 'lean', '节约 ×0.75', pol.rations)}${opt('rations', 'normal', '标准', pol.rations)}${opt('rations', 'rich', '充足 ×1.25', pol.rations)}</div><div class="note">节约：省食物，士气下降、失望上升；充足：反之。</div>`;
  h += `<h4>工作强度</h4><div class="row">${opt('workload', 'light', '轻松 ×0.8', pol.workload)}${opt('workload', 'normal', '标准', pol.workload)}${opt('workload', 'overtime', '加班 ×1.3', pol.workload)}</div><div class="note">影响加工/研究/水培效率与疲劳、失望。</div>`;
  h += `<h4>零件优先保障主驱动</h4><div class="row">${opt('reservePartsForDrive', 'true', '开', String(pol.reservePartsForDrive))}${opt('reservePartsForDrive', 'false', '关', String(pol.reservePartsForDrive))}</div><div class="note">开启时，主驱动修好前小组不会用掉维修所需零件（升级与例行维护会暂缓）。</div>`;
  h += `<h4>基本任务半径</h4><div class="row">${[30, 45, 60].map((v) => opt('basicRadius', String(v), `${v} km`, String(pol.basicRadius))).join('')}</div><div class="note">半径内的航程由列车承担；超出部分每 km 由小组支付 1.5 贡献点。</div>`;
  return h;
}

// ---------------- 研究与基因 ----------------
function researchPanel(s: GameState): string {
  const ds = deptStats(s);
  let h = `<h3>研究（科研医疗车）</h3><div class="note">研究速度 ${fmt(ds.research.eff * 2.2, 1)} 点/小时（科研人员 ${ds.research.workers.length} 人），运行中耗能 ${SURVIVAL.researchEnergyHour} kWh/小时。</div>`;
  for (const p of RESEARCH) {
    const done = s.research.done.includes(p.id);
    const cur = s.research.current === p.id;
    h += `<div class="card"><div class="head"><b>${p.label}</b><span>${done ? '<span class="ok">已完成</span>' : `${p.cost} 研究点`}</span></div><div class="note">${p.desc}；启动消耗 ${Object.entries(p.items)
      .map(([k, v]) => `${ITEM_INFO[k as ItemId].label} ${v}`)
      .join('、')}</div>${cur ? `<div>进行中 ${fmt(s.research.progress, 1)}/${p.cost}</div>${bar(s.research.progress / p.cost)}` : done ? '' : `<div class="row">${btn('开始研究', 'research', p.id, A.canResearch(s, p.id))}</div>`}</div>`;
  }
  h += `<h3>基因链序列强化</h3>`;
  const tb = geneTrainBlock(s);
  h += `<div class="card"><div class="head"><b>${GENE.label}</b><span>${GENE.points} 贡献点</span></div><div>${GENE.desc}</div>
  <ul class="plain">
    <li class="${s.research.done.includes(GENE.requiresResearch) ? 'ok' : ''}">研究解锁：采掘适应序列解析 ${s.research.done.includes(GENE.requiresResearch) ? '✔' : '✘'}</li>
    <li class="${ds.medical.workers.length ? 'ok' : ''}">在岗医护（医疗技能 ≥ ${SURVIVAL.medicalSkillThreshold}）${ds.medical.workers.length ? '✔' : '✘'}</li>
    <li>列车库存：生物样本 ${GENE.items.bio}（有 ${fmt(s.inventory.bio)}）、能源 ${GENE.items.energy} kWh</li>
    <li>由小组公共贡献点支付 ${GENE.points} 点</li>
    <li>身体适配度 ≥ ${GENE.minCompatibility}；健康 ≥ ${GENE.minHealth}；疲劳 ≤ ${GENE.maxFatigue}</li>
    <li>承载上限：本阶段每人 ${GENE.loadLimit} 条序列；恢复期 ${GENE.recovery} 分钟（不出勤）</li>
  </ul>
  <div>${tb ? `<span class="why">列车侧条件未满足：${esc(tb)}</span>` : '<span class="ok">列车侧条件已满足，由小组自主决定是否购买</span>'}</div>
  <div class="note">按正常流程不会出现无提示的随机死亡；强化后健康短暂下降 6。</div></div>`;
  h += `<h4>出勤人员适配情况</h4><table><tr><th>成员</th><th>小组</th><th class="num">适配度</th><th>状态</th></tr>`;
  for (const g of s.groups) {
    for (const p of members(s, g)) {
      const e = geneEligibility(s, p);
      h += `<tr><td>${esc(p.name)}</td><td>${esc(g.name)}</td><td class="num">${p.compatibility}</td><td>${p.genes.length ? '<span class="ok">已强化</span>' : e ? `<span class="why">${esc(e)}</span>` : '<span class="ok">适配</span>'}</td></tr>`;
    }
  }
  h += `</table><h4>其他序列</h4><ul class="plain">${FUTURE_SEQUENCES.map((x) => `<li><span class="tag future">未开放</span> ${esc(x)}</li>`).join('')}</ul>`;
  return h;
}

// ---------------- 乘客 ----------------
function peoplePanel(s: GameState): string {
  const aboard = s.passengers.filter((p) => !p.leftBehind);
  let h = `<h3>乘客（${aboard.length}/30）</h3><div class="note">【临时测试名单】完整候选池与人物故事将在后续阶段接入。</div>`;
  h += `<table><tr><th>姓名</th><th>岗位</th><th>小组/部门</th><th class="num">健康</th><th class="num">疲劳</th><th class="num">士气</th><th class="num">失望</th><th class="num">敌意</th></tr>`;
  const role = (p: Passenger) => (p.isCaptain ? '列车长' : p.headRole ? HEAD_INFO[p.headRole].label : PROFESSION_INFO[p.profession].label);
  const where = (p: Passenger) => {
    if (p.leftBehind) return '<span class="badtext">遗留星球</span>';
    if (p.groupId != null) return `${s.groups.find((g) => g.id === p.groupId)!.name}${p.aboard ? '' : '·外出'}`;
    if (p.isCaptain) return '车头';
    const ds = deptStats(s);
    for (const d of Object.keys(ds) as TrainDept[]) if (ds[d].workers.includes(p)) return DEPT_INFO[d].label;
    if (p.recoveringUntil > s.time) return '强化恢复';
    return '休息';
  };
  for (const p of s.passengers) {
    const top = Object.entries(p.skills).sort((a, b) => b[1] - a[1])[0];
    h += `<tr title="最高技能：${top[0]} ${top[1]}"><td>${esc(p.name)}</td><td>${role(p)}</td><td>${where(p)}</td><td class="num">${fmt(p.health)}</td><td class="num">${fmt(p.fatigue)}</td><td class="num">${p.isCaptain ? '—' : fmt(p.morale)}</td><td class="num">${p.isCaptain ? '—' : fmt(p.disappointment)}</td><td class="num">${p.isCaptain ? '—' : fmt(p.hostility)}</td></tr>`;
  }
  h += `</table><div class="note">治疗由医疗车自动进行，无需逐人安排。</div>`;
  return h;
}

// ---------------- 情绪与安保 ----------------
function moodPanel(s: GameState): string {
  const m = moodSummary(s);
  let h = `<h3>全体情绪</h3><div class="note">个人数值等权平均（不含列车长），小组不会重复计入。</div>`;
  h += `<div>士气 <b>${fmt(m.morale)}</b> <span class="note">乘客精神状态，影响工作效率</span>${bar(m.morale / 100)}</div>`;
  h += `<div>失望 <b>${fmt(m.disappointment)}</b> <span class="note">对列车长较浅层的不满</span>${bar(m.disappointment / 100, 'warm')}</div>`;
  h += `<div>敌意 <b>${fmt(m.hostility)}</b> <span class="note">失望长期高于 60 或严重行为累积；失望降低后只会缓慢消退</span>${bar(m.hostility / 100, 'bad')}</div>`;
  const f = moodFactors(s);
  h += `<h4>当前影响因素（每小时趋势）</h4>`;
  if (!f.length) h += `<div class="note">无特殊因素，情绪向基准值回归。</div>`;
  else h += `<table><tr><th>原因</th><th class="num">士气</th><th class="num">失望</th></tr>${f.map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${x.morale > 0 ? '+' : ''}${fmt(x.morale)}</td><td class="num">${x.disappointment > 0 ? '+' : ''}${fmt(x.disappointment)}</td></tr>`).join('')}</table>`;
  h += `<div class="note">个人疲劳 > 70、健康 < 50 也会降低其士气。</div>`;

  const atStation = s.station.docked;
  const upkeep = s.robots.count * (SURVIVAL.robotEnergyHour + (s.policies.security === 'patrol' ? SURVIVAL.robotPatrolExtra : 0));
  h += `<h3>私人武装机器人</h3><table>
    <tr><td>数量</td><td class="num">${s.robots.count}</td></tr>
    <tr><td>状态</td><td class="num">${atStation ? '站内封存（交易站禁止暴力）' : s.policies.security === 'patrol' ? '车厢巡逻' : '舱内待机'} · 完好度 ${fmt(s.robots.condition)}%</td></tr>
    <tr><td>威慑</td><td class="num">${atStation ? 0 : deterrence(s)}（每台基础 ${ROBOTS.deterrencePer}）</td></tr>
    <tr><td>维持消耗</td><td class="num">${fmt(upkeep, 1)} kWh/小时</td></tr></table>`;
  const opt = (val: string, label: string) => sbtn(label, 'policy', `security:${val}`, atStation ? '交易站内禁止部署' : '', s.policies.security === val ? 'on' : '');
  h += `<div class="row">部署：${opt('standby', '舱内待机')}${opt('patrol', '车厢巡逻')}</div>`;
  h += `<div class="note">威慑不会直接降低敌意；巡逻会增加耗能并让乘客产生被监视感（失望上升）。敌意满值不会直接判负。镇压、夺权事件与战斗为<b>后续内容</b>，本阶段未实现。</div>`;
  return h;
}

// ---------------- 灾变与召回 ----------------
function recallPanel(s: GameState): string {
  let h = `<h3>灾变：灰烬潮</h3>`;
  if (s.phase === 'planet') {
    const e = estimate(s);
    const st = stage(s);
    h += `<div>阶段：<b class="${st === 'far' ? '' : 'badtext'}">${STAGE_LABEL[st]}</b></div>`;
    h += st === 'impact' ? `<div class="badtext">灰烬潮已抵达！车体每分钟受损，必须立即离站。</div>` : `<div>预计到达：<b>${fmtTime(e.low)} ～ ${fmtTime(e.high)}</b> 后</div><div class="note">探测数据有不确定性，越接近越准确。最早时间进入 5 小时内为“逼近”，2 小时内为“危险边缘”（首次自动暂停）。</div>`;
    h += bar(1 - e.remaining / s.catastrophe.trueArrival, 'bad');
    h += `<h3>紧急召回</h3>`;
    h += `<div class="row">${s.recallActive ? btn('解除召回令', 'recall', 'off') : btn('发出紧急召回令', 'recall', 'on', '', 'danger')}</div>`;
    h += `<div class="note">召回后所有小组立即返航（携带已采原料），在列车待命不再出勤。</div>`;
    let outside = 0;
    h += `<table><tr><th>小组</th><th>位置</th><th class="num">返回预计</th><th class="num">载荷</th><th class="num">推进剂</th></tr>`;
    for (const g of s.groups) {
      const r = recallInfo(s, g);
      outside += r.outside.length;
      h += `<tr><td>${esc(g.name)}</td><td>${esc(r.where)}${r.outside.length ? `<br><span class="why">未归：${esc(r.outside.join('、'))}</span>` : ''}</td><td class="num">${r.eta ? fmtTime(r.eta) : '已归'}</td><td class="num">${fmt(r.cargo)}</td><td class="num">${fmt(r.fuel, 1)}</td></tr>`;
    }
    h += `</table><div>${outside ? `<span class="badtext">尚有 ${outside} 人未返回</span>` : '<span class="ok">所有人员都在列车上</span>'}</div>`;
    h += `<h4>作业位置保留</h4><div class="note">返航交货期间保留 ${SLOT_RESERVE_MINUTES} 分钟，过期释放。</div>`;
    const held = (s.planet?.deposits ?? []).flatMap((d) => d.slots.filter((x) => x.status !== 'free').map((x) => ({ d, x })));
    h += held.length
      ? `<ul class="plain">${held.map(({ d, x }) => `<li>${esc(d.name)}：${s.groups.find((g) => g.id === x.holderGroupId)?.name ?? '?'} ${x.status === 'working' ? '作业中' : `保留中，剩余 ${fmtTime(x.reservedUntil - s.time)}`}</li>`).join('')}</ul>`
      : '<div class="note">无</div>';
  } else {
    h += `<div>已离开灰岩星。灾变追赶进度 <b>${fmt(s.catastrophe.chase, 1)}%</b>${s.station.docked ? '（停泊交易站期间暂停）' : '（航行中缓慢增长）'}</div>`;
    h += `<div class="note">外部星球毁灭、竞争期限、最后出口关闭等远期规则本阶段未实现。</div>`;
  }
  return h;
}

// ---------------- 交易站 ----------------
function stationPanel(s: GameState): string {
  if (!s.station.docked) return `<h3>公共交易站</h3><div class="note">尚未抵达。修复主驱动、制造轨道燃料、召回全员后离站，航行约 ${TRAIN.travelDuration / 60} 小时可抵达${STATION.name}。</div>`;
  let h = `<h3>${STATION.name}</h3><div>星币 <b>${fmt(s.credits, 1)}</b> <span class="note">（外部交易货币，与贡献点无关）</span></div>`;
  h += `<div class="note">停泊费：入港 ${STATION.dockingFee} 星币（已支付），之后每小时 ${STATION.hourlyFee} 星币（不足时以能源抵付）。站内禁止暴力。停泊期间暂停本列车的灾变追赶进度。</div>`;
  h += `<h4>补给（购买）</h4><table><tr><th>物品</th><th class="num">单价</th><th class="num">库存</th><th></th></tr>`;
  for (const [k, price] of Object.entries(STATION.buy) as [ItemId, number][]) {
    const q = k === 'oxygen' ? 100 : 1;
    const q2 = k === 'oxygen' ? 500 : 10;
    h += `<tr><td>${ITEM_INFO[k].label}</td><td class="num">${price}</td><td class="num">${fmt(s.inventory[k])}</td><td>${sbtn(`买 ${q}`, 'buy', `${k}:${q}`, A.canBuy(s, k, q))} ${sbtn(`买 ${q2}`, 'buy', `${k}:${q2}`, A.canBuy(s, k, q2))}</td></tr>`;
  }
  h += `</table><h4>出售</h4><table><tr><th>物品</th><th class="num">单价</th><th class="num">库存</th><th></th></tr>`;
  for (const [k, price] of Object.entries(STATION.sell) as [ItemId, number][]) {
    h += `<tr><td>${ITEM_INFO[k].label}</td><td class="num">${price}</td><td class="num">${fmt(s.inventory[k])}</td><td>${sbtn('卖 1', 'sell', `${k}:1`, A.canSell(s, k, 1))} ${sbtn('卖 10', 'sell', `${k}:10`, A.canSell(s, k, 10))}</td></tr>`;
  }
  h += `</table><h4>船坞维修</h4><div>车体 ${fmt(s.train.hull)}% · 每点 ${STATION.hullRepairPrice} 星币</div><div class="row">${btn('修复 10 点', 'repairHull', 10, A.canRepairHull(s, 10))}</div><div class="row">${btn(`全部修复（${fmt(A.hullRepairCost(s, 100), 1)} 星币）`, 'repairHull', 100, A.canRepairHull(s, 100))}</div>`;
  for (const sh of s.shuttles) h += `<div class="row">${esc(sh.name)} 耐久 ${fmt(sh.durability)} ${btn('修满', 'repairShuttle', sh.id, A.canRepairShuttle(s, sh.id))}</div>`;
  h += `<h3>阶段</h3><div class="row">${btn('查看阶段完成总结', 'summary', '', A.stageComplete(s) ? '' : '先完成一次补给或维修', 'primary')}</div>`;
  h += `<div class="row">${btn('离开交易站', 'noop', '', '后续内容：下一段航线尚未开放')}</div>`;
  return h;
}

export function summaryHtml(s: GameState): string {
  const m = moodSummary(s);
  const aboard = s.passengers.filter((p) => !p.leftBehind).length;
  const raw = Object.entries(s.stats.rawDelivered).map(([k, v]) => `${ITEM_INFO[k as RawId].label} ${fmt(v ?? 0)}`).join('、') || '无';
  return `<h2>第一阶段完成</h2>
  <p>列车在${STATION.name}完成了补给与休整。灰烬潮仍在轨道后方，但这一程，大家都活了下来。</p>
  <table>
  <tr><td>用时</td><td>${fmtTime(s.time)}（离站于 ${clockText(s.stats.departedAt)}）</td></tr>
  <tr><td>人口</td><td>${aboard}/30${s.stats.leftBehind ? `（遗留 ${s.stats.leftBehind} 人）` : '（无人遗留）'}</td></tr>
  <tr><td>情绪</td><td>士气 ${fmt(m.morale)} · 失望 ${fmt(m.disappointment)} · 敌意 ${fmt(m.hostility)}</td></tr>
  <tr><td>车体</td><td>${fmt(s.train.hull)}%</td></tr>
  <tr><td>资源</td><td>食物 ${fmt(s.inventory.food)} · 氧气 ${fmt(s.inventory.oxygen)} · 能源 ${fmt(s.inventory.energy)} · 零件 ${fmt(s.inventory.parts)} · 轨道燃料 ${fmt(s.inventory.trainFuel)} · 推进剂 ${fmt(s.inventory.propellant)} · 星币 ${fmt(s.credits, 1)}</td></tr>
  <tr><td>交付</td><td>${s.stats.deliveries} 次：${raw}</td></tr>
  <tr><td>贡献点</td><td>${s.groups.map((g) => `${g.name} 获得 ${fmt(g.pointsEarned, 1)} / 支出 ${fmt(g.pointsSpent, 1)} / 结余 ${fmt(g.points, 1)}`).join('<br>')}</td></tr>
  <tr><td>升级与强化</td><td>${s.groups.map((g) => `${g.name}：${g.purchases.join('、') || '无'}`).join('<br>')}</td></tr>
  </table>
  <p class="note">本阶段未包含：完整外部星球毁灭、竞争期限、最后出口关闭、留居结局、镇压/夺权事件、列车长亲自探索。</p>`;
}
