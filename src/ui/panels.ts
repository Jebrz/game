// 侧边详细面板（每个标签一个函数，返回 HTML）

import { DEMAND_BONUS, GENE, GROUP_ORDER, GROUPS, ROBOTS, ROUTE, SHUTTLE_BUILD, SHUTTLE_MODELS, SHUTTLE_UPGRADES, STATION, SURVIVAL, TRAIN, TRAIN_MIN_STAFF } from '../config/balance';
import { canExpandHangar, canOrderShuttle, hangarUsage, itemListText, jobLabel, jobSource, nextExpansion, QUEUE_MAX, refundText } from '../sim/hangar';
import { CARS, DEPT_INFO, FUTURE_SEQUENCES, HEAD_INFO, ITEM_INFO, PROFESSION_INFO, RAW_IDS, RECIPES, RESEARCH } from '../config/content';
import * as A from '../sim/actions';
import { accelInfo, estimate, gapToTrain, stage, STAGE_LABEL } from '../sim/catastrophe';
import { mineralStatus, nextLegFuel } from '../sim/objectives';
import { checkNewGroup } from '../sim/groups';
import { tradeText } from '../sim/natives';
import { SLOT_RESERVE_MINUTES } from '../sim/claims';
import { clockText, fmt, fmtTime, groupShuttle, members } from '../sim/core';
import { geneEligibility, geneTrainBlock, purchaseOptions, unitPrice } from '../sim/economy';
import { recallInfo } from '../sim/groupAI';
import { leaderPersonality } from '../sim/groups';
import { cargoCap, cargoUsed, fuelPerKm, speed, tank } from '../sim/shuttles';
import { deptStats, processingSpeed } from '../sim/staff';
import { deterrence, moodFactors, moodSummary } from '../sim/survival';
import { recipeOutputs } from '../sim/train';
import type { GameState, ItemId, Passenger, Profession, RawId, Shuttle, TrainDept } from '../sim/types';
import { bar, btn, esc, sbtn } from './html';

export type TabId = 'train' | 'route' | 'groups' | 'shuttles' | 'industry' | 'policy' | 'research' | 'people' | 'mood' | 'recall' | 'station';

export const TABS: { id: TabId; label: string }[] = [
  { id: 'train', label: '列车' },
  { id: 'route', label: '航线' },
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
    case 'route':
      return routePanel(s);
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
  const need = nextLegFuel(s);
  h += `<div>轨道燃料（列车专用） <b>${fmt(s.inventory.trainFuel)}</b> 单位${need ? `（到下一站需 ${need}）` : ''} ${need ? bar(s.inventory.trainFuel / need, 'warm') : ''}</div>`;

  if (s.phase === 'planet' && P) {
    h += `<h4>列车探测仪（低级）</h4>`;
    if (P.scanned) h += `<div class="ok">✔ 已扫描：${P.signs.length} 处迹象。具体矿点需小组实地调查确认。</div><div>矿产状态：${esc(mineralStatus(P))}</div>`;
    else if (P.scanProgress >= 0) h += `<div>扫描中 ${P.scanProgress}/${TRAIN.scanTime} 分</div>${bar(P.scanProgress / TRAIN.scanTime)}`;
    else h += `<div class="row">${btn(`启动扫描（能源 ${TRAIN.scanEnergy} kWh）`, 'scan', '', A.canScan(s), 'primary')}</div><div class="note">只能揭示迹象的大致范围，不会直接告诉你矿点位置与储量。</div>`;
    h += `<h4>离站</h4><div class="note">在「航线」面板选择下一站（可跳过星球），查看燃料需求与到达后的灾变预估。</div><div class="row">${sbtn('打开航线面板', 'tab', 'route', '', 'primary')}</div>`;
  }
  if (s.phase === 'travel' && s.travel) {
    const to = s.journey.nodes[s.travel.to];
    h += `<h4>航行</h4><div>前往 ${esc(to.name)}：${fmt(s.travel.progress)}/${s.travel.duration} 分</div>${bar(s.travel.progress / s.travel.duration)}`;
  }
  if (s.phase !== 'planet' && s.phase !== 'intro') h += `<div>灰烬潮前锋距列车 <b>${fmt(gapToTrain(s))} Mm</b> ${s.station.docked ? '<span class="note">（停泊交易站期间暂停推进）</span>' : `<span class="note">（${esc(accelInfo(s).text)}）</span>`}</div>`;

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
  const fc = checkNewGroup(s);
  const profs0: Profession[] = ['pilot', 'surveyor', 'miner', 'engineer', 'medic'];
  let h = `<h3>小组概况</h3><div>当前小组 <b>${s.groups.length}</b> 个 · 可分配的公共备用机 <b>${fc.spares}</b> 架</div>`;
  h += `<div>空闲可出勤人员（已扣除列车必需人手）：${profs0.map((p) => `${PROFESSION_INFO[p].label} ${fc.available[p] ?? 0}`).join('、')}</div>`;
  h += fc.ok
    ? `<div class="ok">条件已满足：新小组将在 10 分钟内自动成立并领取公共备用机。</div>`
    : `<div>新小组：<span class="why">暂无法成立——${esc(fc.reasons.join('；'))}</span></div>`;
  h += `<div class="note">有公共备用机、且空闲乘客满足下方职业要求时，乘客会自动组成新组、推选组长并领取备用机，不需要审批。不会占用列车长座机、小组私有备用机或已预约换装的运输机；保留列车最低运营人手（工程 2、后勤 2、医疗 1）。新组贡献点从 0 开始。</div>`;
  h += `<h3>出勤小组编组要求</h3><div class="note">列车长规定每组职业人数；所有小组按同一要求增量调整：只释放多出的人、补充缺少的人，小组的贡献点、运输机与历史不变。负责人与列车必需岗位不参与出勤，一人只属于一个小组。出勤中的小组返回后再调整。</div>`;
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
const ROLE_TEXT = (s: GameState, sh: Shuttle): string => {
  if (sh.assignedTo === 'captain') return '列车长座机';
  if (sh.assignedTo === 'group') return `${s.groups.find((g) => g.shuttleId === sh.id)?.name ?? '小组'}主运输机`;
  if (sh.ownerGroupId != null) return `备用 · 归${s.groups.find((g) => g.id === sh.ownerGroupId)?.name ?? '小组'}（待该组领取）`;
  return '备用 · 公共（待分配）';
};

function shuttlesPanel(s: GameState): string {
  const u = hangarUsage(s);
  let h = `<h3>机库</h3>`;
  h += `<table><tr><td>容量</td><td class="num"><b>${u.capacity}</b> 个泊位</td></tr>
    <tr><td>已占用</td><td class="num">${u.shuttles}（小组主力 ${u.main} · 备用 ${u.spare} · 列车长 ${u.captain}；其中出勤中 ${u.out}）</td></tr>
    <tr><td>建造预留</td><td class="num">${u.building}</td></tr>
    <tr><td>空闲</td><td class="num ${u.free <= 0 ? 'badtext' : ''}">${u.free}</td></tr></table>`;
  h += `<div class="note">每架运输机（含出勤中、备用、列车长座机）都占一个泊位；建造中的运输机下单时就预留泊位。</div>`;
  const e = nextExpansion(s);
  if (e) {
    const why = canExpandHangar(s);
    h += `<div class="row">${sbtn(`${e.label}（+${e.add} 泊位）`, 'expandHangar', '', why.join('；'))}<span class="note">${esc(itemListText(e.items))} · 标准工时 ${e.time} 分</span></div>${why.length ? `<div class="why">${esc(why.join('；'))}</div>` : ''}`;
  } else h += `<div class="note">机库已扩建到本阶段上限。</div>`;

  const spec = SHUTTLE_MODELS[SHUTTLE_BUILD.model];
  const spd = processingSpeed(s);
  h += `<h3>制造运输机</h3><div class="card"><div class="head"><b>${spec.label}运输机</b><span class="note">标准工时 ${SHUTTLE_BUILD.time} 分（当前约 ${fmtTime(SHUTTLE_BUILD.time / Math.max(0.2, spd))}）</span></div>
    <div>运载 ${spec.cargo} · 采矿 ${spec.mineRate}/分 · 航速 ${spec.speed} km/分 · 油耗 ${spec.fuelPerKm}/km · 油箱 ${spec.tank} · 耐久 100</div>
    <div>材料（公共库存）：${esc(itemListText(SHUTTLE_BUILD.items))}；生产线运行耗能 ${SURVIVAL.processingEnergyHour} kWh/小时，速度取决于工程人员</div>
    <div class="note">新机出厂不带推进剂、货舱为空；完工后进入备用状态。小组订购需另付 ${SHUTTLE_BUILD.groupPoints} 贡献点（贡献点不能代替材料）。</div>`;
  const why = canOrderShuttle(s, null);
  h += `<div class="row">${sbtn('列车长下单（公共物资）', 'orderShuttle', '', why.join('；'), 'primary')}</div>${why.length ? `<div class="why">${esc(why.join('；'))}</div>` : ''}</div>`;
  const orders = s.queue.filter((j) => j.kind !== 'recipe');
  if (orders.length) {
    h += `<h4>制造与扩建订单</h4><ul class="plain">${orders
      .map((j) => `<li>${esc(jobLabel(j))} · ${esc(jobSource(s, j))} · 进度 ${fmt((1 - j.remaining / j.total) * 100)}% · 剩余约 ${fmtTime(j.remaining / Math.max(0.2, spd))}${s.queue[0] === j ? '' : '（排队中）'}</li>`)
      .join('')}</ul><div class="note">完整队列与取消见下方「共享生产队列」。</div>`;
  }

  h += `<h3>运输机（${s.shuttles.length} 架）</h3><div class="note">运输机使用<b>运输机推进剂</b>，与列车的<b>轨道燃料</b>不通用。运输机直接到矿点采矿并运回原料，不做机载加工。</div>`;
  for (const sh of s.shuttles) {
    const items = Object.entries(sh.cargo.items).filter(([, v]) => (v ?? 0) > 0.01);
    h += `<div class="card"><div class="head"><b>${esc(sh.name)}</b><span>${SHUTTLE_MODELS[sh.model].label} · ${esc(sh.serial)} · Lv${sh.level}</span></div>`;
    h += `<div>用途：<b>${esc(ROLE_TEXT(s, sh))}</b> · ${sh.docked ? '停靠机库' : '出勤中'} · 产权：${sh.ownerGroupId == null ? '列车公共' : `${esc(s.groups.find((g) => g.id === sh.ownerGroupId)?.name ?? '小组')}出资`}${sh.builtAt >= 0 ? ` · ${clockText(sh.builtAt)} 完工` : ''}</div>`;
    h += `<div>运载 ${fmt(cargoUsed(sh))}/${cargoCap(sh)} · 推进剂 ${fmt(sh.fuel, 1)}/${tank(sh)} · <span class="${sh.durability < 30 ? 'badtext' : ''}">耐久 ${fmt(sh.durability)}</span> · 航速 ${fmt(speed(sh), 1)} · 油耗 ${fmt(fuelPerKm(sh), 2)}/km · 采矿 ${fmt(SHUTTLE_MODELS[sh.model].mineRate * (sh.upgrades.includes('drill') ? 1.3 : 1), 2)}/分</div>`;
    h += `<div>货舱：${items.length ? items.map(([k, v]) => `${ITEM_INFO[k as ItemId].label} ${fmt(v ?? 0)}`).join('、') : '空'} · 升级：${sh.upgrades.length ? sh.upgrades.map((x) => SHUTTLE_UPGRADES.find((y) => y.id === x)!.label).join('、') : '无'}</div>`;
    // 操作
    const acts: string[] = [];
    if (sh.assignedTo === 'captain') acts.push(sbtn('释放（交还小组或转备用）', 'releaseShuttle', sh.id));
    else {
      const w = A.canAssignCaptain(s, sh.id);
      acts.push(sbtn('配属列车长', 'assignCaptain', sh.id, w) + (w ? `<span class="why">${esc(w)}</span>` : ''));
    }
    if (sh.assignedTo === 'spare') {
      for (const g of s.groups) {
        const cur = s.shuttles.find((x) => x.id === g.shuttleId);
        if (g.pendingSwap === sh.id) {
          acts.push(`<span class="ok">已安排${esc(g.name)}返航卸货后换装</span> ${sbtn('取消安排', 'cancelSwap', g.id)}`);
          continue;
        }
        const w = A.canSwap(s, g, sh, 'captain');
        if (!w) {
          acts.push(sbtn(`分配给${g.name}${cur ? '（换机）' : ''}`, 'captainSwap', `${g.id}:${sh.id}`));
          continue;
        }
        const sw = A.canScheduleSwap(s, g, sh);
        if (!sw) acts.push(sbtn(`安排${g.name}返航后换装`, 'scheduleSwap', `${g.id}:${sh.id}`) + `<span class="why">${esc(w)}，可预约</span>`);
        else acts.push(sbtn(`分配给${g.name}`, 'captainSwap', `${g.id}:${sh.id}`, w) + `<span class="why">${esc(w)}</span>`);
      }
    }
    h += `<div class="row">${acts.join(' ')}</div></div>`;
  }
  h += `<h4>说明</h4><ul class="plain">
    <li>每个小组只有一架主运输机。换机要求小组已返航、卸完货、不在卸货中；小组出勤时可「安排返航后换装」，该机为其保留。旧机转为备用（保留升级、耐久与燃料），不会销毁。</li>
    <li>小组出资的新机只由该组领取；列车长只能配属或分配列车公共运输机，不能征用小组出资的运输机。</li>
    <li>小组会在主运输机不可用、耐久低于 ${GROUP_ORDER.lowDurability} 或货舱长期装满时，用贡献点自主订购（每组同时一单）。</li>
    <li>新小组：当前 ${s.groups.length} 个。有公共备用机且空闲人员满足职业要求时会自动成立新组（见「小组」面板的原因说明）；想把备用机留作换机，可先「安排返航后换装」保留它。</li>
    <li>列车长亲自驾驶探索为后续内容。</li></ul>`;
  h += `<h4>可购买升级（由小组用贡献点购买，并消耗列车库存）</h4><table><tr><th>升级</th><th>效果</th><th class="num">贡献点</th><th>库存消耗</th></tr>`;
  for (const up of SHUTTLE_UPGRADES) h += `<tr><td>${up.label}</td><td>${up.desc}</td><td class="num">${up.points}</td><td>${Object.entries(up.items).map(([k, v]) => `${ITEM_INFO[k as ItemId].label} ${v}`).join('、')}</td></tr>`;
  h += `</table><div class="note">耐久低于 45 时列车承担例行维护（每件零件 +30）；低于 50 航速 ×0.85；低于 15 禁止出勤。</div>`;
  h += queueHtml(s);
  return h;
}

// ---------------- 库存与加工 ----------------
function industryPanel(s: GameState): string {
  let h = `<h3>列车库存</h3><table><tr><th>物品</th><th class="num">数量</th><th>用途</th></tr>`;
  for (const k of Object.keys(ITEM_INFO) as ItemId[]) {
    h += `<tr><td>${ITEM_INFO[k].label}</td><td class="num">${fmt(s.inventory[k], k === 'propellant' ? 1 : 0)} ${ITEM_INFO[k].unit}</td><td class="note">${ITEM_INFO[k].desc}</td></tr>`;
  }
  h += `</table>`;
  h += `<h3>加工设备（工程货运车）</h3><div class="note">原料在入队时预留扣除，取消原样退还。运输机制造与机库扩建也在这条生产线上（见「运输机」面板）。加工速度 ×${fmt(processingSpeed(s), 2)}（取决于工程人员），运行中耗能 ${SURVIVAL.processingEnergyHour} kWh/小时。不使用传送带。</div>`;
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
  h += queueHtml(s);
  return h;
}


/** 共享生产队列（加工配方、运输机制造、机库扩建） */
export function queueHtml(s: GameState): string {
  const spd = processingSpeed(s);
  let h = `<h4>共享生产队列（${s.queue.length}/${QUEUE_MAX}）</h4><div class="note">一次只推进第一项；公共订单排在小组订单之前，可用「提前」把公共订单移到队首，被挤下的订单保留已完成工时。加工速度 ×${fmt(spd, 2)}。</div>`;
  if (!s.queue.length) return h + `<div class="note">空闲</div>`;
  h += `<table><tr><th></th><th>项目</th><th>来源</th><th class="num">剩余</th><th></th></tr>`;
  s.queue.forEach((j, i) => {
    const prog = 1 - j.remaining / j.total;
    const cancelWhy = j.orderedBy != null ? '小组出资的订单只能由该小组取消' : '';
    h += `<tr><td>${i === 0 ? '▶' : i + 1}</td><td>${esc(jobLabel(j))}${j.kind !== 'recipe' || i === 0 ? bar(prog, 'warm') : ''}</td><td>${esc(jobSource(s, j))}</td><td class="num">约 ${fmtTime(j.remaining / Math.max(0.2, spd))}${j.started && i !== 0 ? '<br><span class="note">已暂停</span>' : ''}</td><td>${i > 0 && j.orderedBy == null ? sbtn('提前', 'moveFront', j.id, A.canMoveToFront(s, j.id)) + ' ' : ''}${sbtn('取消', 'cancelJob', j.id, cancelWhy)}${j.kind !== 'recipe' && !cancelWhy ? `<br><span class="note">${esc(refundText(j))}</span>` : ''}</td></tr>`;
  });
  h += `</table><div class="note">取消规则：原样返还下单时扣除的材料与贡献点，不会多返；已消耗的能源与工时不退。</div>`;
  if (s.inventory.energy < 1) h += `<div class="badtext">能源耗尽，生产线暂停</div>`;
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
  const acc = accelInfo(s);
  h += `<div>前锋距列车 <b>${fmt(gapToTrain(s))} Mm</b>；${esc(acc.text)}</div><div class="note">灰烬潮沿航线追赶列车，推进速度由慢到快（平滑加速，不会突然跳变）。列车航速 ${ROUTE.trainSpeed * 60} Mm/小时，始终快于前锋；停靠越久，前锋越近。换星球不会重置灾变，停泊交易站期间暂停。</div>`;
  h += `<div>加速进度 ${fmt(acc.frac * 100)}%</div>${bar(acc.frac, 'bad')}`;
  if (s.phase === 'planet') {
    const e = estimate(s);
    const st = stage(s);
    h += `<h4>${esc(s.planet?.name ?? '')}</h4><div>阶段：<b class="${st === 'far' ? '' : 'badtext'}">${STAGE_LABEL[st]}</b></div>`;
    h += st === 'impact' ? `<div class="badtext">灰烬潮已抵达！车体每分钟受损，必须立即离站。</div>` : `<div>预计到达本星：<b>${fmtTime(e.low)} ～ ${fmtTime(e.high)}</b> 后</div><div class="note">探测数据有不确定性，越接近越准确。最早时间进入 5 小时内为“逼近”，2 小时内为“危险边缘”（首次自动暂停）。</div>`;
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
    h += `<div class="note">${s.station.docked ? '停泊交易站期间，灰烬潮追赶暂停（不清零）。' : '航行中：列车比前锋快，距离正在拉开。'}外部星球毁灭、竞争期限、最后出口关闭等远期规则本阶段未实现。</div>`;
  }
  return h;
}


// ---------------- 航线与星球 ----------------
const PROFILE_TEXT: Record<string, string> = { rich: '资源较丰富', poor: '资源较少/偏科', barren: '几乎无矿产' };

function routePanel(s: GameState): string {
  const j = s.journey;
  let h = `<h3>航线</h3><div class="note">本阶段航线：起始星球 → 随机星球 → 公共交易站。可以跳过不值得停靠的星球（需要更多燃料）。每颗星球的地图、矿点与原住民在开局时确定，读档不会刷新。</div>`;
  h += `<table><tr><th>节点</th><th class="num">里程</th><th>状态</th></tr>`;
  j.nodes.forEach((n, i) => {
    const st = n.status === 'current' ? '<b>当前</b>' : n.status === 'visited' ? '已访问' : n.status === 'skipped' ? '已跳过' : i === j.dest ? '<b>航行目的地</b>' : '未到达';
    h += `<tr><td>${esc(n.name)}${n.kind === 'station' ? ' <span class="tag">交易站</span>' : ''}</td><td class="num">${fmt(n.pos)} Mm</td><td>${st}</td></tr>`;
  });
  h += `</table>`;
  // 当前星球
  const P = s.planet;
  if (s.phase === 'planet' && P) {
    const node = j.nodes[j.current];
    h += `<h3>${esc(P.name)}</h3><div class="note">情报：${esc(node.intel)}</div>`;
    h += `<div>矿产：${esc(mineralStatus(P))}${P.scanned && mineralStatus(P).startsWith('调查后') ? '' : ''}</div>`;
    if (P.scanned) h += `<div>资源类型线索：${PROFILE_TEXT[P.resourceProfile]}（据已扫描迹象判断）</div>`;
    const N = P.natives;
    h += `<h4>原住民</h4>`;
    if (!P.scanned) h += `<div class="note">尚未扫描。</div>`;
    else if (N.kind === 'none') h += `<div>未发现原住民。</div>`;
    else if (N.kind === 'hostile') h += `<div class="badtext">${esc(N.name)}：明确拒绝接近。禁区（地图紫色区域）内的迹象与矿点不可进入或作业，小组会绕开；靠近禁区边缘作业可能收到驱逐警告。</div><div class="note">本阶段不实现战斗；可以绕开禁区，或提前离开。</div>`;
    else {
      h += `<div><b>${esc(N.name)}</b>：${N.contacted ? '<span class="ok">已建立联系</span>' : '尚未接触（小组调查地图上的「人工信号」后建立联系）'}</div>`;
      if (N.contacted) {
        h += `<h4>物资交易</h4><table>${N.trades
          .map((t) => {
            const w = A.canTrade(s, t.id);
            return `<tr><td>${esc(tradeText(t))}</td><td class="num">剩 ${t.stock}</td><td>${sbtn('交易', 'trade', t.id, w)}${w ? `<br><span class="why">${esc(w)}</span>` : ''}</td></tr>`;
          })
          .join('')}</table>`;
        const pw = A.canPermit(s);
        h += `<h4>采矿许可</h4><div>领地内矿点：${P.deposits.filter((d) => d.zone === 'permit').map((d) => esc(d.name) + (d.discoveredBy != null ? '' : '（未确认）')).join('、') || '无'}</div>`;
        h += N.permitGranted ? `<div class="ok">已取得许可，小组可前往领地内矿点作业。</div>` : `<div class="row">${sbtn(`协商采矿许可（${Object.entries(N.permitCost).map(([k, v]) => `${ITEM_INFO[k as ItemId].label} ${v}`).join('、')}）`, 'permit', '', pw)}${pw ? `<span class="why">${esc(pw)}</span>` : ''}</div>`;
      }
    }
    // 出发选项
    h += `<h3>下一站</h3>`;
    const opts = A.legOptions(s);
    for (const o of opts) {
      const risk = o.predict.remaining <= 180 ? '<span class="badtext">到达时灾变已很近</span>' : o.predict.remaining <= 360 ? '<span class="why">到达后可停留时间较短</span>' : '<span class="ok">到达后时间较充裕</span>';
      h += `<div class="card"><div class="head"><b>${esc(o.node.name)}</b><span>${fmt(o.dist)} Mm · 航程约 ${fmtTime(o.travel)} · 燃料 ${o.fuel}</span></div>`;
      h += `<div class="note">${esc(o.node.intel)}</div>`;
      if (o.skips.length) h += `<div class="why">跳过：${esc(o.skips.join('、'))}</div>`;
      h += `<div>预计 ${clockText(o.predict.arriveAt)} 到达；届时灰烬潮预计 <b>${fmtTime(o.predict.low)} ～ ${fmtTime(o.predict.high)}</b> 后抵达该处。${o.node.kind === 'station' ? '（交易站内灾变追赶暂停）' : risk}</div>`;
      h += `<div>燃料：有 ${fmt(s.inventory.trainFuel)}，需 ${o.fuel}${s.inventory.trainFuel < o.fuel ? `，<span class="badtext">缺 ${fmt(o.fuel - s.inventory.trainFuel)}</span>` : `，到达后剩 ${fmt(s.inventory.trainFuel - o.fuel)}`}</div>`;
      h += `<div class="row">${sbtn(`离站前往${o.node.name}`, 'departTo', o.index, o.block, 'primary')}${o.block ? `<span class="why">${esc(o.block)}</span>` : ''}</div>`;
      const fw = A.canDepartTo(s, o.index, true);
      if (!fw) h += `<div class="row">${sbtn('强行离站（遗留未归人员）', 'forceDepartAsk', o.index, '', 'danger')}<span class="note">严重行为：会遗留人员与运输机，全体敌意大增</span></div>`;
      h += `</div>`;
    }
  } else if (s.phase === 'travel' && s.travel) {
    const to = j.nodes[s.travel.to];
    h += `<h3>航行中</h3><div>前往 ${esc(to.name)}：${fmt(s.travel.progress)}/${s.travel.duration} 分</div>${bar(s.travel.progress / s.travel.duration)}<div class="note">${esc(to.intel)}</div>`;
  }
  const visited = j.nodes.filter((n) => n.notes.length);
  if (visited.length) h += `<h4>访问记录</h4><ul class="plain">${visited.map((n) => `<li>${esc(n.name)}：${esc(n.notes.join('；'))}</li>`).join('')}</ul>`;
  return h;
}

// ---------------- 交易站 ----------------
function stationPanel(s: GameState): string {
  if (!s.station.docked) return `<h3>公共交易站</h3><div class="note">尚未抵达。${STATION.name}是本段航线的终点（见「航线」面板），抵达并完成一次补给或维修后可查看旅程总结。</div>`;
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
  <h4>航线记录</h4><ul class="plain">${s.journey.nodes
    .map((n) => `<li>${esc(n.name)}：${n.kind === 'station' ? '终点' : n.status === 'skipped' ? '跳过' : esc(n.notes.join('；') || '已访问')}</li>`)
    .join('')}</ul>
  <table>
  <tr><td>用时</td><td>${fmtTime(s.time)}（首次离站于 ${clockText(s.stats.departedAt)}）</td></tr>
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
