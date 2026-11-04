// 界面主控：渲染循环、顶部状态栏、侧边面板、事件记录、弹窗与存档。

import { TIME, TRAIN } from '../config/balance';
import * as A from '../sim/actions';
import { accelInfo, estimate, gapToTrain, stage, STAGE_LABEL } from '../sim/catastrophe';
import { advance, type Clock } from '../sim/clock';
import { clockText, fmt, fmtTime, log } from '../sim/core';
import { journeyObjectives, nextLegFuel, planetObjectives, rawShortfall, type Objective } from '../sim/objectives';
import { ITEM_INFO } from '../config/content';
import { loadFrom, saveTo, slotInfo, type SlotId } from '../sim/save';
import { createInitialState } from '../sim/state';
import { moodSummary, resourceRates } from '../sim/survival';
import type { GameState, ItemId, Policies, Profession, RawId } from '../sim/types';
import { esc, sbtn } from './html';
import { drawMap, type MapHit } from './mapView';
import { renderPanel, summaryHtml, TABS, type TabId } from './panels';
import { drawTrain, type CarHit } from './trainView';

const $ = (id: string) => document.getElementById(id)!;

const CAR_TAB: Record<string, TabId> = {
  engine: 'train',
  dorm1: 'people',
  dorm2: 'people',
  galley: 'policy',
  cargo: 'industry',
  lab: 'research',
};

export class App {
  s: GameState;
  clock: Clock = { acc: 0 };
  tab: TabId = 'train';
  view: 'train' | 'map' = 'train';
  logFilter = 'all';
  last = performance.now();
  lastUi = 0;
  lastAutosave = 0;
  lastPhase = '';
  seenToasts = 0;
  pointerDown = false;
  carHits: CarHit[] = [];
  mapHits: MapHit[] = [];
  mouse: { x: number; y: number } | null = null;
  hoverCar: string | null = null;
  cache: Record<string, string> = {};
  objCollapsed = window.innerHeight < 720; // 矮窗口默认收起目标框，避免遮挡地图
  logMin = false;
  seenPending = 0;
  storage: Storage | null;

  constructor() {
    this.storage = safeStorage();
    this.s = createInitialState(pickSeed());
    this.seenToasts = this.s.toasts.length;
    this.bind();
    this.showIntro();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------- 循环 ----------------
  frame(now: number): void {
    const dt = now - this.last;
    this.last = now;
    if (!this.modalOpen()) advance(this.s, this.clock, dt);
    this.draw(now);
    if (now - this.lastUi > 200) {
      this.lastUi = now;
      this.renderUi();
      this.checkEvents();
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  modalOpen(): boolean {
    return !$('modal').hidden;
  }

  checkEvents(): void {
    const s = this.s;
    // 自动存档：按游戏时间与阶段变化
    if (s.phase !== 'intro' && (s.time - this.lastAutosave >= TIME.autosaveEveryMinutes || s.phase !== this.lastPhase)) {
      this.lastAutosave = s.time;
      this.lastPhase = s.phase;
      this.save('auto', true);
    }
    // 新提示
    if (s.toasts.length < this.seenToasts) this.seenToasts = 0;
    while (this.seenToasts < s.toasts.length) {
      const t = s.toasts[this.seenToasts++];
      this.toast(t.title, t.text, /灾变|危险|失败/.test(t.title));
    }
    if (s.phase === 'failed' && !this.modalOpen()) this.showFailed();
    // 新的待决事件：切到「事件」面板（多个事件进入同一待办列表，不叠加弹窗）
    const pend = s.events.filter((e) => e.status === 'pending').length;
    if (pend > this.seenPending) {
      this.tab = 'events';
      this.cache = {};
    }
    this.seenPending = pend;
  }

  // ---------------- 绘制 ----------------
  draw(now: number): void {
    const c = $('canvas') as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(r.width * dpr));
    const H = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.view === 'train' || !this.s.planet || this.s.phase !== 'planet') {
      this.carHits = drawTrain(ctx, r.width, r.height, this.s, this.hoverCar, now);
      this.mapHits = [];
    } else {
      this.mapHits = drawMap(ctx, r.width, r.height, this.s, this.mouse, now);
      this.carHits = [];
    }
  }

  setHtml(id: string, html: string): void {
    if (this.cache[id] === html) return;
    this.cache[id] = html;
    $(id).innerHTML = html;
  }

  renderUi(): void {
    if (this.pointerDown) return; // 点击过程中不重建 DOM，避免吞掉点击
    const s = this.s;
    this.setHtml('topbar', this.topbar());
    this.setHtml('sidetabs', this.sidetabs());
    const panel = $('panel');
    const st = panel.scrollTop;
    this.setHtml('panel', renderPanel(s, this.tab));
    panel.scrollTop = st;
    this.setHtml('objectives', this.objectivesHtml());
    this.setHtml('log', this.logHtml());
    const mapBtn = document.querySelector('#viewtabs [data-view="map"]') as HTMLButtonElement;
    mapBtn.disabled = s.phase !== 'planet';
    mapBtn.title = s.phase !== 'planet' ? '已离开星球' : '';
    for (const b of document.querySelectorAll('#viewtabs button')) b.classList.toggle('on', (b as HTMLElement).dataset.view === (s.phase === 'planet' ? this.view : 'train'));
  }

  topbar(): string {
    const s = this.s;
    const r = resourceRates(s);
    const m = moodSummary(s);
    const aboard = s.passengers.filter((p) => !p.leftBehind && p.aboard).length;
    const alive = s.passengers.filter((p) => !p.leftBehind).length;
    const chip = (label: string, v: string, sub = '', cls = '', tip = '') => `<span class="chip ${cls}" title="${esc(tip)}">${label} <b>${v}</b>${sub ? ` <small>${sub}</small>` : ''}</span>`;
    const rate = (x: number) => `${x >= 0 ? '+' : ''}${fmt(x, 1)}/时`;
    let h = `<span class="title">星空列车</span><span class="clock">${clockText(s.time)}</span>`;
    h += `<span class="speed">${sbtn(s.paused ? '▶ 继续' : '⏸ 暂停', 'pause', '', s.phase === 'intro' || s.phase === 'failed' ? '未开始' : '', s.paused ? 'primary' : '')}${TIME.speeds
      .map((v) => sbtn(`${v}×`, 'speed', v, '', s.speed === v ? 'on' : ''))
      .join('')}</span>`;
    h += chip('食物', fmt(s.inventory.food), rate(r.food), s.inventory.food < 15 ? 'bad' : '', '单位：份');
    h += chip('氧气', fmt(s.inventory.oxygen), rate(r.oxygen), s.inventory.oxygen < 150 ? 'bad' : '', '单位：m³');
    h += chip('能源', fmt(s.inventory.energy), rate(r.energy), s.inventory.energy < 60 ? 'bad' : '', '单位：kWh');
    h += chip('车体', `${fmt(s.train.hull)}%`, '', s.train.hull < 40 ? 'bad' : '');
    h += chip('人口', `${aboard}/${alive}`, '在车/总', '', '在列车上的人数 / 总人口');
    h += chip('星币', fmt(s.credits, 1), '', '', '外部交易货币');
    h += chip('士气', fmt(m.morale), '', m.morale < 40 ? 'warn' : '');
    h += chip('失望', fmt(m.disappointment), '', m.disappointment > 60 ? 'warn' : '');
    h += chip('敌意', fmt(m.hostility), '', m.hostility > 30 ? 'bad' : '');
    if (s.phase === 'planet') {
      const st = stage(s);
      const e = estimate(s);
      const acc = accelInfo(s);
      h += `<span class="chip click ${st === 'far' ? '' : st === 'warn' ? 'warn' : 'bad'}" data-act="tab" data-arg="recall" title="${esc(acc.text)}">灾变 <b>${STAGE_LABEL[st]}</b> <small>${st === 'impact' ? '已抵达' : `${fmtTime(e.low)}～${fmtTime(e.high)}`}${acc.frac > 0.05 && acc.frac < 0.999 ? ' · 加速中' : ''}</small></span>`;
      if (s.recallActive) h += `<span class="chip bad">召回令生效</span>`;
    } else if (s.phase !== 'intro') h += `<span class="chip click" data-act="tab" data-arg="recall">灰烬潮 <b>${fmt(gapToTrain(s))} Mm</b> <small>${s.station.docked ? '追赶暂停' : '航行中拉开距离'}</small></span>`;
    if (s.phase !== 'intro') {
      const node = s.journey.nodes[s.travel ? s.travel.to : s.journey.current];
      h += `<span class="chip click" data-act="tab" data-arg="route">${s.travel ? '前往' : '位置'} <b>${esc(node.name)}</b> <small>${s.journey.current + 1}/${s.journey.nodes.length}</small></span>`;
    }
    h += `<span class="spacer"></span>${sbtn('存档 / 读档', 'saveMenu')}`;
    return h;
  }

  sidetabs(): string {
    const s = this.s;
    return TABS.map((t) => {
      let alert = false;
      if (t.id === 'recall') alert = s.phase === 'planet' && ['warn', 'edge', 'impact'].includes(stage(s));
      if (t.id === 'station') alert = s.station.docked && !A.stageComplete(s);
      if (t.id === 'events') alert = s.events.some((e) => e.status === 'pending' && e.nodeIndex === s.journey.current);
      return sbtn(t.label, 'tab', t.id, '', `${this.tab === t.id ? 'on' : ''} ${alert ? 'alert' : ''}`);
    }).join('');
  }

  objectivesHtml(): string {
    const ps = planetObjectives(this.s);
    const js = journeyObjectives(this.s);
    const li = (list: Objective[]) => {
      const cur = list.findIndex((o) => !o.done && !o.optional);
      return list
        .map((o, i) => `<li class="${o.done ? 'done' : i === cur ? 'cur' : ''}">${o.done ? '✔ ' : ''}${esc(o.label)}${o.optional ? ' <small style="display:inline">（可选）</small>' : ''}${!o.done && (i === cur || o.optional) && o.detail ? `<small>${esc(o.detail)}</small>` : ''}</li>`)
        .join('');
    };
    const done = js.filter((o) => o.done).length;
    if (this.objCollapsed) return `<h4>旅程目标 ${done}/${js.length} ${sbtn('展开', 'objToggle')}</h4>`;
    return `${ps.length ? `<h4>当前星球：${esc(this.s.planet?.name ?? '')} ${sbtn('收起', 'objToggle')}</h4><ol>${li(ps)}</ol>` : ''}<h4>旅程目标 ${ps.length ? '' : sbtn('收起', 'objToggle')}</h4><ol>${li(js)}</ol><div class="hint">${esc(this.hint())}</div>`;
  }

  hint(): string {
    const s = this.s;
    const P = s.planet;
    if (s.phase === 'intro') return '';
    if (s.phase === 'failed') return '列车失败。可读取存档重试。';
    if (s.phase === 'travel') return '列车航行中，正在拉开与灰烬潮的距离。小组随车休整，生产与研究仍在进行。';
    if (s.phase === 'station') return A.stageComplete(s) ? '旅程目标已完成：在「交易站」查看旅程总结，或继续在站内查看列车。' : '在「交易站」面板购买补给或维修车体。';
    const st = stage(s);
    if (st === 'edge' || st === 'impact') return s.recallActive ? '等待小组归队后，到「航线」面板离站。' : '危险！到「灾变召回」发出紧急召回令。';
    if (!P?.scanned) return P && P.scanProgress >= 0 ? '扫描进行中，可以先浏览各面板。' : '提示：到「列车」面板启动扫描（或点击车头）。空格键暂停，1-4 切换速度。';
    if (s.events.some((e) => e.status === 'pending' && e.nodeIndex === s.journey.current)) return '有待决定的探索事件：查看「事件」面板，选择方案或稍后处理。';
    if (P.natives.kind === 'friendly' && P.natives.contacted && !P.natives.permits.length && !s.research.done.includes('translation')) return `已与${P.natives.name}建立联系：可以先以物易物；研究「基础图形语言翻译」后才能协商领地采矿许可。`;
    if (P.natives.kind === 'friendly' && P.natives.contacted && !P.natives.permitGranted && P.deposits.some((d) => d.zone === 'permit' && d.discoveredBy != null)) return `已与${P.natives.name}建立联系：可在「航线」面板交易物资或协商领地采矿许可。`;
    if (!s.stats.deliveries) return '小组会自主探索迹象、确认矿点并采矿。切到「星球地图」(M) 观察他们。';
    const partsLeft = s.train.driveRepaired ? 0 : TRAIN.driveRepairParts - s.train.driveRepair;
    const short = rawShortfall(s);
    const names = (m: Partial<Record<RawId, number>>) => Object.keys(m).map((k) => ITEM_INFO[k as RawId].label).join('、');
    if (s.inventory.propellant < 10 && s.inventory.ice < 3) return '推进剂与冰晶都快耗尽：在「库存加工」用能源「应急合成推进剂」，让小组能飞去采冰，并提高冰晶需求奖励。';
    if (s.inventory.propellant < 20) return '运输机推进剂偏低：在「库存加工」用冰晶制推进剂，必要时提高冰晶需求奖励。';
    if (partsLeft > 0 && s.inventory.parts >= partsLeft) return '零件够了：到「列车」面板投入零件维修主驱动。';
    if (partsLeft > 0) {
      if (s.inventory.iron >= 4 && s.inventory.copper >= 2) return '在「库存加工」把铁矿和铜矿加工成维修零件。';
      if (Object.keys(short.parts).length) return `维修零件还缺 ${names(short.parts)}：在「奖励政策」提高其需求奖励，小组会更愿意去采。`;
      return '维修零件正在加工中。';
    }
    const need = nextLegFuel(s);
    if (s.inventory.trainFuel < need) {
      if (s.inventory.crystal >= 3 && s.inventory.ice >= 1) return `在「库存加工」用辉晶 + 冰晶制造轨道燃料（到下一站需 ${need}）。`;
      if (Object.keys(short.fuel).length) return `下一站需要轨道燃料 ${need}，还缺 ${names(short.fuel)}：可提高其需求奖励${P.natives.contacted ? '，或与原住民交易' : ''}。`;
      return '轨道燃料正在加工中。';
    }
    if (st === 'warn') return '列车已具备离站条件。灾变逼近：发出召回令，在「航线」选择下一站。';
    if (s.journey.current === 0 && !s.shuttles.some((x) => x.builtAt >= 0)) return '燃料已够下一站。时间还宽裕的话，可以在「运输机」面板制造一架新运输机，或继续积累资源。';
    return '列车已可离站（「航线」面板）。也可以继续积累资源，后续星球的停留时间会越来越短。';
  }

  logHtml(): string {
    const cats: [string, string][] = [
      ['all', '全部'],
      ['group', '小组'],
      ['economy', '经济'],
      ['danger', '危险'],
      ['research', '研究'],
      ['system', '系统'],
      ['station', '交易站'],
    ];
    const lines = this.s.log.filter((l) => this.logFilter === 'all' || l.cat === this.logFilter).slice(-80).reverse();
    return `<div class="filters"><span>事件记录</span>${sbtn(this.logMin ? '展开' : '收起', 'logToggle')}${cats.map(([k, v]) => sbtn(v, 'logFilter', k, '', this.logFilter === k ? 'on' : '')).join('')}</div><div class="lines">${lines
      .map((l) => `<div class="c-${l.cat}"><span class="t">${clockText(l.t)}</span>${esc(l.text)}</div>`)
      .join('')}</div>`;
  }

  // ---------------- 交互 ----------------
  bind(): void {
    document.addEventListener('pointerdown', () => (this.pointerDown = true));
    document.addEventListener('pointerup', () => setTimeout(() => (this.pointerDown = false), 0));
    document.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (el && !(el as HTMLButtonElement).disabled) this.act(el.dataset.act!, el.dataset.arg ?? '');
      const v = (e.target as HTMLElement).closest('[data-view]') as HTMLElement | null;
      if (v && !(v as HTMLButtonElement).disabled) this.view = v.dataset.view as 'train' | 'map';
    });
    document.addEventListener('keydown', (e) => {
      if (this.modalOpen()) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.act('pause', '');
      } else if (/^Digit[1-4]$/.test(e.code)) this.act('speed', String(TIME.speeds[Number(e.code.slice(5)) - 1]));
      else if (e.key === 'm' || e.key === 'M') this.view = 'map';
      else if (e.key === 't' || e.key === 'T') this.view = 'train';
    });
    const c = $('canvas');
    c.addEventListener('mousemove', (e) => {
      const r = c.getBoundingClientRect();
      this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.updateHover();
    });
    c.addEventListener('mouseleave', () => {
      this.mouse = null;
      this.hoverCar = null;
      $('tooltip').hidden = true;
    });
    c.addEventListener('click', () => {
      if (!this.hoverCar) return;
      const car = this.hoverCar;
      if (car.startsWith('sealed')) {
        this.toast('封闭车厢', '这节车厢被古老的封锁锁住。本阶段未开放，解锁剧情为后续内容。');
        return;
      }
      if (CAR_TAB[car]) this.tab = CAR_TAB[car];
      this.cache = {};
      this.renderUi();
    });
  }

  updateHover(): void {
    const m = this.mouse;
    const tip = $('tooltip');
    if (!m) return;
    this.hoverCar = this.carHits.find((h) => m.x >= h.x && m.x <= h.x + h.w && m.y >= h.y && m.y <= h.y + h.h)?.id ?? null;
    $('canvas').style.cursor = this.hoverCar ? 'pointer' : 'default';
    let best: MapHit | null = null;
    let bd = Infinity;
    for (const h of this.mapHits) {
      const d = Math.hypot(h.x - m.x, h.y - m.y);
      if (d < Math.max(h.r, 10) && d < bd) {
        bd = d;
        best = h;
      }
    }
    if (best) {
      tip.innerHTML = best.html;
      tip.hidden = false;
      tip.style.left = `${Math.min(m.x + 14, ($('view').clientWidth || 800) - 290)}px`;
      tip.style.top = `${m.y + 14}px`;
    } else tip.hidden = true;
  }

  act(act: string, arg: string): void {
    this.pointerDown = false; // 点击已完成，立即刷新界面
    const s = this.s;
    const [a, b] = arg.split(':');
    switch (act) {
      case 'pause':
        A.setPaused(s, !s.paused);
        break;
      case 'speed':
        A.setSpeed(s, Number(arg));
        break;
      case 'tab':
        this.tab = arg as TabId;
        break;
      case 'objToggle':
        this.objCollapsed = !this.objCollapsed;
        break;
      case 'logToggle':
        this.logMin = !this.logMin;
        $('app').classList.toggle('log-min', this.logMin);
        break;
      case 'logFilter':
        this.logFilter = arg;
        break;
      case 'scan':
        A.startScan(s);
        break;
      case 'repairDrive':
        A.repairDrive(s);
        break;
      case 'departTo':
        A.departTo(s, Number(arg));
        break;
      case 'trade':
        A.trade(s, arg);
        break;
      case 'negotiate':
        A.negotiate(s, Number(a), b as 'pay' | 'share');
        break;
      case 'evChoose':
        A.chooseEvent(s, Number(a), b);
        break;
      case 'evDecline':
        A.declineEvent(s, Number(arg));
        break;
      case 'evCancel':
        A.cancelEventExec(s, Number(arg));
        break;
      case 'depart':
        A.depart(s);
        break;
      case 'forceDepartAsk':
        this.confirmForce(Number(arg));
        break;
      case 'forceDepart':
        A.departTo(s, Number(arg), true);
        this.closeModal();
        break;
      case 'enqueue':
        A.enqueue(s, a, Number(b));
        break;
      case 'cancelJob':
        A.cancelJob(s, Number(arg));
        break;
      case 'research':
        A.startResearch(s, arg);
        break;
      case 'bonus':
        A.setDemandBonus(s, a as RawId, Number(b));
        break;
      case 'policy': {
        const key = a as keyof Policies;
        const val = b === 'true' ? true : b === 'false' ? false : /^\d+$/.test(b) ? Number(b) : b;
        A.setPolicy(s, key, val as never);
        break;
      }
      case 'req':
        A.setRequirement(s, a as Profession, Number(b));
        break;
      case 'assignCaptain':
        A.assignCaptain(s, Number(arg));
        break;
      case 'releaseShuttle':
        A.releaseShuttle(s, Number(arg));
        break;
      case 'moveFront':
        A.moveToFront(s, Number(arg));
        break;
      case 'orderShuttle':
        A.captainOrderShuttle(s);
        break;
      case 'expandHangar':
        A.expandHangar(s);
        break;
      case 'captainSwap':
        A.captainSwap(s, Number(a), Number(b));
        break;
      case 'scheduleSwap':
        A.captainScheduleSwap(s, Number(a), Number(b));
        break;
      case 'cancelSwap':
        A.captainCancelSwap(s, Number(arg));
        break;
      case 'recall':
        A.setRecall(s, arg === 'on');
        break;
      case 'buy':
        A.buy(s, a as ItemId, Number(b));
        break;
      case 'sell':
        A.sell(s, a as ItemId, Number(b));
        break;
      case 'repairHull':
        A.repairHull(s, Number(arg));
        break;
      case 'repairShuttle':
        A.repairShuttle(s, Number(arg));
        break;
      case 'summary':
        this.showSummary();
        break;
      case 'saveMenu':
        this.showSaveMenu();
        break;
      case 'save':
        this.save(arg as SlotId);
        this.showSaveMenu();
        break;
      case 'load':
        this.load(arg as SlotId);
        break;
      case 'newGame':
        this.s = createInitialState(pickSeed());
        this.resetUiState();
        this.showIntro();
        break;
      case 'start':
        A.startGame(s);
        this.closeModal();
        break;
      case 'close':
        this.closeModal();
        break;
    }
    this.cache = {};
    this.renderUi();
  }

  resetUiState(): void {
    this.clock = { acc: 0 };
    this.seenToasts = this.s.toasts.length;
    this.seenPending = this.s.events.filter((e) => e.status === 'pending').length;
    this.lastAutosave = this.s.time;
    this.lastPhase = this.s.phase;
    this.cache = {};
  }

  // ---------------- 存档 ----------------
  save(slot: SlotId, silent = false): void {
    if (!this.storage) {
      if (!silent) this.toast('无法存档', '浏览器存储不可用（可能处于隐私模式）。');
      return;
    }
    try {
      saveTo(this.storage, slot, this.s);
      if (!silent) this.toast('已存档', `${slot === 'auto' ? '自动存档' : `槽位 ${slot.slice(-1)}`} · ${clockText(this.s.time)}`);
    } catch (e) {
      this.toast('存档失败', String((e as Error).message));
    }
  }

  load(slot: SlotId): void {
    if (!this.storage) return;
    try {
      this.s = loadFrom(this.storage, slot);
      this.resetUiState();
      log(this.s, 'system', `读取存档（${slot === 'auto' ? '自动存档' : `槽位 ${slot.slice(-1)}`}）。已暂停，按空格继续。`);
      this.closeModal();
      if (this.s.phase === 'intro') this.showIntro();
    } catch (e) {
      this.toast('读档失败', String((e as Error).message));
    }
  }

  // ---------------- 弹窗与提示 ----------------
  openModal(html: string): void {
    $('modal').innerHTML = `<div class="box">${html}</div>`;
    $('modal').hidden = false;
  }
  closeModal(): void {
    $('modal').hidden = true;
    $('modal').innerHTML = '';
  }

  showIntro(): void {
    const has = this.storage && (['auto', 'slot1', 'slot2'] as SlotId[]).some((k) => slotInfo(this.storage!, k));
    this.openModal(`<h2>星空列车</h2>
      <p>你在昏暗的车头里醒来。一条被称为「规则」的讯息刻进了意识：<b>你被选为这列车的列车长。</b></p>
      <p>车上有 30 名幸存者。主驱动受损，燃料耗尽，列车停在灰岩星 K-7 的古老轨道锚点上。远方，一场被称为「灰烬潮」的灾变正沿着航线逼近——起初很慢，但会越来越快。</p>
      <p>本段航线：灰岩星 K-7 → ${esc(this.s.journey.nodes.slice(1, -1).map((n) => n.name).join(' → '))} → 回声交易站。后续星球情况未知，可能富矿、贫矿或无矿，也可能有原住民。</p>
      <p>你不需要亲自挖矿。乘客会组成小组，驾驶运输机自主探索与采矿；你用<b>收购奖励、任务与列车政策</b>引导他们，在车内<b>加工零件与燃料</b>，修好列车，在灾变赶上之前一站站前进，最终抵达公共交易站休整。</p>
      <p class="note">操作：空格 暂停/继续 · 1-4 切换速度 · T 列车剖视 · M 星球地图 · 点击车厢打开对应面板。所有数值均为原型参数。</p>
      <div class="actions">${sbtn('开始（列车长就位）', 'start', '', '', 'primary')}${has ? sbtn('读取存档…', 'saveMenu') : ''}</div>`);
  }

  showSaveMenu(): void {
    const st = this.storage;
    const row = (slot: SlotId, label: string, canSave: boolean) => {
      const info = st ? slotInfo(st, slot) : null;
      return `<tr><td>${label}</td><td>${info ? `${clockText(info.gameTime)}<br><span class="note">${new Date(info.savedAt).toLocaleString('zh-CN')}</span>` : '<span class="note">空</span>'}</td><td>${
        canSave ? sbtn('保存到此', 'save', slot, this.s.phase === 'intro' ? '尚未开始' : '') : ''
      } ${sbtn('读取', 'load', slot, info ? '' : '无存档')}</td></tr>`;
    };
    this.openModal(`<h2>存档 / 读档</h2>
      ${st ? '' : '<p class="badtext">浏览器存储不可用，无法存档。</p>'}
      <table>${row('auto', '自动存档', false)}${row('slot1', '槽位 1', true)}${row('slot2', '槽位 2', true)}</table>
      <p class="note">存档包含完整世界状态：小组行动、矿点作业位置、运输机货舱批次、加工队列与随机数状态。自动存档每 ${TIME.autosaveEveryMinutes} 游戏分钟及阶段变化时进行。读档后自动暂停。</p>
      <div class="actions">${sbtn('关闭', 'close')}${sbtn('重新开始新游戏', 'newGame', '', '', 'danger')}</div>`);
  }

  showSummary(): void {
    this.s.station.summaryShown = true;
    this.openModal(`${summaryHtml(this.s)}<div class="actions">${sbtn('继续在站内查看列车', 'close', '', '', 'primary')}${sbtn('存档…', 'saveMenu')}</div>`);
  }

  showFailed(): void {
    this.openModal(`<h2>列车失守</h2><p>${esc(this.s.failReason)}</p><p class="note">失败只会在灰烬潮抵达后列车仍未离站、车体归零时发生。</p><div class="actions">${sbtn('读取存档…', 'saveMenu', '', '', 'primary')}${sbtn('重新开始', 'newGame')}</div>`);
  }

  confirmForce(index: number): void {
    const names = A.outsideGroups(this.s).flatMap((g) => g.memberIds.map((id) => this.s.passengers.find((p) => p.id === id)!.name));
    this.openModal(`<h2>强行离站？</h2><p>以下人员与其运输机将被遗留在星球上：<b>${esc(names.join('、'))}</b></p><p class="badtext">这是严重行为：全体乘客敌意将大幅上升，并长期影响士气。</p><div class="actions">${sbtn('取消', 'close', '', '', 'primary')}${sbtn('确认遗留并离站', 'forceDepart', index, A.canDepartTo(this.s, index, true), 'danger')}</div>`);
  }

  toast(title: string, text: string, danger = false): void {
    const el = document.createElement('div');
    el.className = `toast ${danger ? 'danger' : ''}`;
    el.innerHTML = `<b>${esc(title)}</b>${esc(text)}`;
    $('toasts').prepend(el);
    setTimeout(() => el.remove(), 9000);
    while ($('toasts').children.length > 4) $('toasts').lastElementChild!.remove();
  }
}

function safeStorage(): Storage | null {
  try {
    const k = '__startrain_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}

/** 新开局种子：默认随机；地址带 ?seed=数字 时使用指定种子（用于复现与测试，不影响正常游玩） */
function pickSeed(): number {
  try {
    const v = new URLSearchParams(location.search).get('seed');
    if (v && /^\d+$/.test(v)) return Number(v);
  } catch {
    /* 忽略 */
  }
  return Math.floor(Math.random() * 1e9);
}
