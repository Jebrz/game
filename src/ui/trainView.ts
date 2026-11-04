// 列车侧面剖视（程序绘制）：生活区暖色，外部星空冷色。

import { CARS, DEPT_INFO } from '../config/content';
import { deptStats } from '../sim/staff';
import type { GameState, TrainDept } from '../sim/types';
import { stage } from '../sim/catastrophe';

export interface CarHit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Star {
  x: number;
  y: number;
  z: number;
}
const stars: Star[] = Array.from({ length: 220 }, (_, i) => ({ x: (i * 7919) % 1000 / 1000, y: (i * 104729) % 997 / 997, z: 0.2 + ((i * 31) % 10) / 12 }));
let drift = 0;

export function drawTrain(ctx: CanvasRenderingContext2D, w: number, h: number, s: GameState, hover: string | null, now: number): CarHit[] {
  // 背景星空（冷色）
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#03050d');
  g.addColorStop(1, '#0a1430');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const moving = s.phase === 'travel' && !s.paused;
  drift += moving ? 0.004 * s.speed : 0.0002;
  for (const st of stars) {
    const x = ((st.x - drift * st.z) % 1 + 1) % 1;
    ctx.fillStyle = `rgba(150,200,255,${0.3 + st.z * 0.6})`;
    const len = moving ? 2 + st.z * 10 : 1.5;
    ctx.fillRect(x * w, st.y * h * 0.75, len, 1.2);
  }
  const groundY = h * 0.72;
  // 场景：星球地表 / 交易站 / 轨道
  if (s.phase === 'planet' || s.phase === 'intro' || s.phase === 'failed') {
    const st = stage(s);
    // 远处灾变光幕
    if (st === 'warn' || st === 'edge' || st === 'impact') {
      const a = st === 'impact' ? 0.55 : st === 'edge' ? 0.35 : 0.18;
      const cg = ctx.createLinearGradient(w, 0, w * 0.55, 0);
      cg.addColorStop(0, `rgba(255,90,40,${a + 0.1 * Math.sin(now / 300)})`);
      cg.addColorStop(1, 'rgba(255,90,40,0)');
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, w, groundY);
    }
    ctx.fillStyle = '#2a2c36';
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    for (let x = 0; x <= w; x += 30) ctx.lineTo(x, groundY - 12 - 10 * Math.sin(x / 70) - 6 * Math.sin(x / 23));
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fill();
  } else if (s.phase === 'station') {
    // 交易站结构：上方横梁 + 泊位灯，标签放在右侧避开目标面板
    const sx = Math.max(300, w * 0.3);
    ctx.fillStyle = '#1c2438';
    ctx.fillRect(sx, groundY - 230, w - sx - 20, 46);
    ctx.fillRect(w - 80, groundY - 230, 30, 230);
    ctx.fillStyle = '#ffd27a';
    for (let x = sx + 14; x < w - 100; x += 40) ctx.fillRect(x, groundY - 212, 18, 8);
    ctx.fillStyle = '#9fb3d9';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('回声交易站 · 公共泊位（站内禁止暴力）', w - 100, groundY - 240);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#151a28';
    ctx.fillRect(0, groundY + 8, w, h - groundY);
  } else {
    ctx.fillStyle = '#0d1222';
    ctx.fillRect(0, groundY + 8, w, h - groundY);
  }
  // 古老轨道
  ctx.strokeStyle = '#5cc8ff';
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY + 8);
  ctx.lineTo(w, groundY + 8);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 车厢布局
  const margin = 20;
  const n = CARS.length;
  const gap = 6;
  const carW = Math.min(170, (w - margin * 2 - gap * (n - 1)) / n);
  const carH = Math.min(120, h * 0.3);
  const total = carW * n + gap * (n - 1);
  let x = (w - total) / 2;
  const y = groundY - carH;
  const hits: CarHit[] = [];
  const ds = deptStats(s);
  const counts = peopleIn(s, ds);
  for (const car of CARS) {
    hits.push({ id: car.id, x, y, w: carW, h: carH });
    drawCar(ctx, car.id, car.label, car.open, x, y, carW, carH, hover === car.id, s, counts[car.id] ?? 0, now);
    x += carW + gap;
  }
  // 车厢之间连接
  return hits;
}

function peopleIn(s: GameState, ds: ReturnType<typeof deptStats>): Record<string, number> {
  const c: Record<string, number> = {};
  const inDept = new Set<number>();
  for (const d of Object.keys(ds) as TrainDept[]) {
    const car = DEPT_INFO[d].car;
    c[car] = (c[car] ?? 0) + ds[d].workers.length;
    for (const p of ds[d].workers) inDept.add(p.id);
  }
  for (const p of s.passengers) {
    if (p.leftBehind || !p.aboard || inDept.has(p.id)) continue;
    const car = p.isCaptain ? 'engine' : p.carId;
    c[car] = (c[car] ?? 0) + 1;
  }
  return c;
}

function drawCar(
  ctx: CanvasRenderingContext2D,
  id: string,
  label: string,
  open: boolean,
  x: number,
  y: number,
  w: number,
  h: number,
  hover: boolean,
  s: GameState,
  people: number,
  now: number,
): void {
  // 外壳（旧金属）
  ctx.fillStyle = open ? '#3a3530' : '#22252c';
  roundRect(ctx, x, y, w, h, id === 'engine' ? 18 : 6);
  ctx.fill();
  ctx.strokeStyle = hover ? '#5cc8ff' : '#5a5147';
  ctx.lineWidth = hover ? 2 : 1;
  ctx.stroke();
  // 先进技术纹路（冷色发光条）
  ctx.fillStyle = `rgba(92,200,255,${0.35 + 0.2 * Math.sin(now / 700 + x)})`;
  ctx.fillRect(x + 6, y + 5, w - 12, 2);
  // 铆钉
  ctx.fillStyle = '#6b6158';
  for (let i = x + 8; i < x + w - 6; i += 14) ctx.fillRect(i, y + h - 7, 2, 2);
  // 车轮
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(x + w * 0.22, y + h + 4, 7, 0, Math.PI * 2);
  ctx.arc(x + w * 0.78, y + h + 4, 7, 0, Math.PI * 2);
  ctx.fill();

  const ix = x + 8;
  const iy = y + 14;
  const iw = w - 16;
  const ih = h - 28;
  if (!open) {
    ctx.fillStyle = '#15171c';
    ctx.fillRect(ix, iy, iw, ih);
    ctx.strokeStyle = '#444';
    ctx.beginPath();
    for (let k = -ih; k < iw; k += 12) {
      ctx.moveTo(ix + Math.max(0, k), iy + Math.max(0, -k));
      ctx.lineTo(ix + Math.min(iw, k + ih), iy + Math.min(ih, ih - (k + ih - Math.min(iw, k + ih))));
    }
    ctx.stroke();
    ctx.fillStyle = '#888';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🔒 未开放', x + w / 2, y + h / 2 + 4);
  } else {
    // 暖色室内
    const wg = ctx.createLinearGradient(0, iy, 0, iy + ih);
    wg.addColorStop(0, '#5a3a1c');
    wg.addColorStop(1, '#2d1e12');
    ctx.fillStyle = wg;
    ctx.fillRect(ix, iy, iw, ih);
    ctx.fillStyle = 'rgba(255,200,120,0.25)';
    ctx.fillRect(ix, iy, iw, 4);
    drawInterior(ctx, id, ix, iy, iw, ih, s, now);
    // 人员
    ctx.fillStyle = '#ffe2b0';
    const maxShow = Math.min(people, 12);
    for (let k = 0; k < maxShow; k++) {
      const px = ix + 8 + ((k * 13) % (iw - 14));
      const py = iy + ih - 8 - Math.floor((k * 13) / (iw - 14)) * 12;
      ctx.beginPath();
      ctx.arc(px, py - 5, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(px - 2, py - 2, 4, 6);
    }
  }
  ctx.fillStyle = hover ? '#fff' : '#cfd6e6';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + h + 24);
  if (open && id !== 'engine') {
    ctx.fillStyle = '#8a96b4';
    ctx.font = '11px sans-serif';
    ctx.fillText(`${people} 人`, x + w / 2, y + h + 38);
  }
  ctx.textAlign = 'left';
}

function drawInterior(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, w: number, h: number, s: GameState, now: number): void {
  ctx.font = '10px sans-serif';
  if (id === 'engine') {
    // 驱动核心
    const ok = s.train.driveRepaired;
    ctx.fillStyle = ok ? `rgba(92,200,255,${0.6 + 0.3 * Math.sin(now / 200)})` : `rgba(255,90,60,${0.5 + 0.4 * Math.sin(now / 150)})`;
    ctx.beginPath();
    ctx.arc(x + w * 0.4, y + h * 0.45, Math.min(w, h) * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe2b0';
    ctx.fillText(ok ? '主驱动 正常' : s.train.driveRepairTimer > 0 ? '主驱动 维修中' : '主驱动 受损', x + 4, y + 12);
    ctx.fillText(`燃料 ${Math.floor(s.inventory.trainFuel)}`, x + 4, y + 24);
  } else if (id === 'dorm1' || id === 'dorm2') {
    ctx.fillStyle = '#7a5532';
    for (let k = 0; k < 3; k++) ctx.fillRect(x + 6 + k * (w / 3), y + 10, w / 3 - 12, 6);
    for (let k = 0; k < 3; k++) ctx.fillRect(x + 6 + k * (w / 3), y + 26, w / 3 - 12, 6);
  } else if (id === 'galley') {
    ctx.fillStyle = '#4caf6a';
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.arc(x + 12 + k * ((w - 20) / 5), y + 16, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffe2b0';
    ctx.fillText(`食物 ${Math.floor(s.inventory.food)}`, x + 4, y + h - 22);
  } else if (id === 'cargo') {
    ctx.fillStyle = '#6c5a44';
    ctx.fillRect(x + 6, y + 8, w * 0.35, h * 0.45);
    const job = s.queue[0];
    if (job) {
      ctx.fillStyle = '#f2b45a';
      ctx.fillRect(x + 6, y + 8 + h * 0.45 + 2, w * 0.35 * (1 - job.remaining / job.total), 3);
      ctx.fillStyle = `rgba(255,170,60,${0.5 + 0.5 * Math.sin(now / 120)})`;
      ctx.fillRect(x + 10, y + 12, 6, 6);
    }
    // 运输机机库
    const docked = s.shuttles.filter((sh) => sh.docked);
    ctx.fillStyle = '#8fb8d8';
    docked.forEach((_, k) => {
      const sx = x + w * 0.5 + k * (w * 0.24);
      ctx.beginPath();
      ctx.moveTo(sx, y + 18);
      ctx.lineTo(sx + w * 0.2, y + 24);
      ctx.lineTo(sx, y + 30);
      ctx.fill();
    });
    ctx.fillStyle = '#ffe2b0';
    ctx.fillText(`机库 ${docked.length}/${s.shuttles.length}`, x + w * 0.5, y + 44);
  } else if (id === 'lab') {
    ctx.fillStyle = '#d6d0c4';
    ctx.fillRect(x + 6, y + 14, w * 0.3, 6);
    ctx.fillStyle = s.research.current ? `rgba(180,140,255,${0.6 + 0.4 * Math.sin(now / 250)})` : '#55507a';
    ctx.fillRect(x + w * 0.55, y + 8, w * 0.3, h * 0.35);
    ctx.fillStyle = '#ffe2b0';
    ctx.fillText(s.research.current ? '研究中' : '研究台', x + w * 0.55, y + h * 0.35 + 20);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - 6, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + 6);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
