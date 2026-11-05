// 六泊位机库预览（开发预览，不接入正式玩法）。入口：hangar-preview.html

import { BAYS, MARGIN_Y, SHUTTLE_W, type Bay } from './hangarLayout';
import { advance, canDepart, canReturn, depart, initialShuttles, poseOf, recall, resetAll, STATUS_LABEL, type ShuttleAnim } from './hangarAnim';
import './hangar.css';

const hangarUrl = new URL('./assets/hangar-six-bay.png', import.meta.url).href;
const shuttleUrl = new URL('./assets/shuttle-topdown.png', import.meta.url).href;

// 运输机素材（838×722，机头朝上）：两台引擎尾喷口相对素材中心的位置（以素材宽/高为 1）
const SPRITE = { w: 838, h: 722, opaqueW: 834 };
const NOZZLES = [
  { x: -0.242, y: 0.49 },
  { x: 0.235, y: 0.49 },
];

const shuttles = initialShuttles();
let selected = BAYS[0].id;

const root = document.getElementById('hangar-app')!;
root.innerHTML = `
  <section class="scene" id="scene"><canvas id="hangar-canvas"></canvas><div class="loading" id="loading">正在载入机库…</div></section>
  <aside class="controls">
    <h1>机库 · 六个泊位</h1>
    <div class="bays" id="bays"></div>
    <div class="current" id="current"></div>
    <div class="actions">
      <button id="btn-depart" class="go">出航</button>
      <button id="btn-return" class="back">归队</button>
    </div>
    <button id="btn-reset" class="reset">重置</button>
    <ul class="all" id="all"></ul>
  </aside>`;

const scene = document.getElementById('scene')!;
const canvas = document.getElementById('hangar-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const baysEl = document.getElementById('bays')!;
const currentEl = document.getElementById('current')!;
const allEl = document.getElementById('all')!;
const btnDepart = document.getElementById('btn-depart') as HTMLButtonElement;
const btnReturn = document.getElementById('btn-return') as HTMLButtonElement;
const btnReset = document.getElementById('btn-reset') as HTMLButtonElement;

baysEl.innerHTML = BAYS.map((b) => `<button data-bay="${b.id}"><span class="dot"></span>${b.label}</button>`).join('');
baysEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button[data-bay]') as HTMLButtonElement | null;
  if (btn) select(btn.dataset.bay!);
});
const anim = (id: string) => shuttles.find((s) => s.bayId === id)!;
btnDepart.addEventListener('click', () => {
  depart(anim(selected));
  syncUi();
});
btnReturn.addEventListener('click', () => {
  recall(anim(selected));
  syncUi();
});
btnReset.addEventListener('click', () => {
  resetAll(shuttles);
  syncUi();
});

function select(id: string): void {
  selected = id;
  syncUi();
}

let lastUi = '';
function syncUi(): void {
  const key = selected + shuttles.map((s) => s.status).join();
  if (key === lastUi) return;
  lastUi = key;
  for (const btn of baysEl.querySelectorAll<HTMLButtonElement>('button[data-bay]')) {
    const s = anim(btn.dataset.bay!);
    btn.classList.toggle('on', btn.dataset.bay === selected);
    btn.dataset.status = s.status;
    btn.setAttribute('aria-pressed', String(btn.dataset.bay === selected));
  }
  const a = anim(selected);
  const bay = BAYS.find((b) => b.id === selected)!;
  currentEl.innerHTML = `<span class="name">${bay.label}</span><span class="status" data-status="${a.status}">${STATUS_LABEL[a.status]}</span>`;
  btnDepart.disabled = !canDepart(a);
  btnReturn.disabled = !canReturn(a);
  allEl.innerHTML = BAYS.map((b) => `<li data-status="${anim(b.id).status}"><span>${b.label}</span><span>${STATUS_LABEL[anim(b.id).status]}</span></li>`).join('');
}

// ---------- 画面 ----------
interface Frame {
  /** 背景图绘制区域（CSS 像素） */
  ix: number;
  iy: number;
  iw: number;
  ih: number;
  dpr: number;
}
let frame: Frame = { ix: 0, iy: 0, iw: 0, ih: 0, dpr: 1 };
const IMG_ASPECT = 1376 / 768;

function layout(): void {
  const r = scene.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  canvas.style.width = `${r.width}px`;
  canvas.style.height = `${r.height}px`;
  // 背景图保持原比例；上下各留 MARGIN_Y 的空间看飞离
  const totalH = 1 + 2 * MARGIN_Y;
  let iw = r.width;
  let ih = iw / IMG_ASPECT;
  if (ih * totalH > r.height) {
    ih = r.height / totalH;
    iw = ih * IMG_ASPECT;
  }
  frame = { ix: (r.width - iw) / 2, iy: (r.height - ih * totalH) / 2 + ih * MARGIN_Y, iw, ih, dpr };
}

const toScreen = (x: number, y: number) => ({ x: frame.ix + x * frame.iw, y: frame.iy + y * frame.ih });

const stars = Array.from({ length: 260 }, (_, i) => ({ x: ((i * 7919) % 1000) / 1000, y: ((i * 104729) % 997) / 997, z: 0.25 + ((i * 31) % 10) / 13 }));

function draw(now: number, hangar: HTMLImageElement, sprite: HTMLImageElement): void {
  const { dpr } = frame;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = canvas.width / dpr;
  const H = canvas.height / dpr;
  ctx.fillStyle = '#04060d';
  ctx.fillRect(0, 0, W, H);
  for (const s of stars) {
    ctx.fillStyle = `rgba(170,200,255,${0.15 + s.z * 0.45})`;
    ctx.fillRect(s.x * W, s.y * H, 1.2, 1.2);
  }
  ctx.drawImage(hangar, frame.ix, frame.iy, frame.iw, frame.ih);

  // 选中泊位：细线框出停机坪与外平台
  const bay = BAYS.find((b) => b.id === selected)!;
  drawSelection(bay, now);

  // 泊位名称：写在外平台外侧（先画，飞过时被运输机盖住）
  ctx.font = `${Math.max(11, Math.round(frame.iw * 0.011))}px 'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif`;
  ctx.textAlign = 'center';
  for (const b of BAYS) {
    const edgeY = b.side === 'up' ? b.platformSpan[0] - 0.035 : b.platformSpan[0] + 0.05;
    const p = toScreen(b.park.x, edgeY);
    ctx.fillStyle = b.id === selected ? '#9fe8ff' : 'rgba(190,205,230,0.7)';
    ctx.fillText(b.label, p.x, p.y);
  }

  // 运输机（在背景之上；门口比翼展宽得多，不需要前景遮挡层）
  for (const a of shuttles) drawShuttle(a, sprite, now);
}

function drawSelection(b: Bay, now: number): void {
  const p0 = toScreen(b.pad[0], b.pad[1]);
  const p1 = toScreen(b.pad[2], b.pad[3]);
  ctx.save();
  ctx.strokeStyle = `rgba(110,225,255,${0.55 + 0.25 * Math.sin(now / 400)})`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  const pad = 4;
  ctx.strokeRect(p0.x - pad, p0.y - pad, p1.x - p0.x + pad * 2, p1.y - p0.y + pad * 2);
  ctx.restore();
}

function drawShuttle(a: ShuttleAnim, sprite: HTMLImageElement, now: number): void {
  const pose = poseOf(a);
  if (pose.alpha <= 0.002) return;
  const c = toScreen(pose.x, pose.y);
  const w = SHUTTLE_W * frame.iw * (SPRITE.w / SPRITE.opaqueW);
  const h = (w * SPRITE.h) / SPRITE.w;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(pose.angle);
  ctx.globalAlpha = pose.alpha;
  if (pose.engine > 0.01) drawEngines(w, h, pose.engine, now);
  ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/** 克制的青色尾焰：两台引擎各一团柔光 + 很短的尾迹 */
function drawEngines(w: number, h: number, k: number, now: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const flicker = 0.92 + 0.08 * Math.sin(now / 45) * Math.sin(now / 73);
  for (const n of NOZZLES) {
    const x = n.x * w;
    const y = n.y * h;
    const r = w * (0.06 + 0.07 * k) * flicker;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(200,255,255,${0.75 * k})`);
    g.addColorStop(0.35, `rgba(80,220,255,${0.45 * k})`);
    g.addColorStop(1, 'rgba(40,160,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // 尾迹：沿机尾方向（素材 +y）拉长的淡色椭圆
    const len = w * 0.16 * k * flicker;
    const tg = ctx.createLinearGradient(x, y, x, y + len);
    tg.addColorStop(0, `rgba(120,235,255,${0.4 * k})`);
    tg.addColorStop(1, 'rgba(60,180,255,0)');
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.ellipse(x, y + len / 2, w * 0.028, len / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// 点击画面中的泊位也可以选中
canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left - frame.ix) / frame.iw;
  const y = (e.clientY - r.top - frame.iy) / frame.ih;
  const hit = BAYS.find((b) => Math.abs(x - b.park.x) < b.doorWidth / 2 + 0.03 && (b.side === 'up' ? y < 0.5 : y >= 0.5));
  if (hit) select(hit.id);
});

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

Promise.all([loadImage(hangarUrl), loadImage(shuttleUrl)])
  .then(([hangar, sprite]) => {
    document.getElementById('loading')!.remove();
    layout();
    new ResizeObserver(() => layout()).observe(scene);
    let last = performance.now();
    const tick = (now: number) => {
      // 按真实经过的时间推进；切到后台再回来时最多补 0.25 秒，避免瞬移
      const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
      last = now;
      for (const a of shuttles) advance(a, dt);
      syncUi();
      draw(now, hangar, sprite);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    syncUi();
  })
  .catch(() => {
    document.getElementById('loading')!.textContent = '素材载入失败，请刷新页面重试。';
  });

// 只读调试接口（自动化检查用，不出现在界面上）
(window as unknown as { __hangar: unknown }).__hangar = {
  shuttles,
  bays: BAYS,
  frame: () => ({ ...frame }),
  pose: (id: string) => poseOf(anim(id)),
};
