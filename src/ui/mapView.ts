// 星球俯视地图（程序绘制）：资源迹象、矿点与作业位置、风险区、运输机。

import { ITEM_INFO } from '../config/content';
import { fmt, fmtTime } from '../sim/core';
import { cargoCap, cargoUsed } from '../sim/shuttles';
import type { GameState, RawId } from '../sim/types';

export const RES_COLOR: Record<RawId, string> = {
  iron: '#d86a4a',
  copper: '#4fd1a5',
  ice: '#9fdcff',
  crystal: '#c49bff',
  bio: '#9be36b',
};
const GROUP_COLOR = ['#ffcc55', '#ff7ad9', '#7af0ff'];

export interface MapHit {
  x: number;
  y: number;
  r: number;
  html: string;
}

let terrain: HTMLCanvasElement | null = null;
let terrainKey = '';

function getTerrain(w: number, h: number, seed: number): HTMLCanvasElement {
  const key = `${w}x${h}:${seed}`;
  if (terrain && terrainKey === key) return terrain;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b1d24';
  g.fillRect(0, 0, w, h);
  let r = seed;
  const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const rad = 10 + rnd() * 60;
    g.fillStyle = `rgba(${60 + rnd() * 30},${58 + rnd() * 25},${66 + rnd() * 30},${0.08 + rnd() * 0.12})`;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  // 陨坑
  for (let i = 0; i < 30; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const rad = 4 + rnd() * 14;
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.stroke();
  }
  terrain = c;
  terrainKey = key;
  return c;
}

export function drawMap(ctx: CanvasRenderingContext2D, w: number, h: number, s: GameState, mouse: { x: number; y: number } | null, now: number): MapHit[] {
  const P = s.planet;
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, w, h);
  if (!P) return [];
  const pad = 30;
  const sc = Math.min((w - pad * 2) / P.width, (h - pad * 2) / P.height);
  const ox = (w - P.width * sc) / 2;
  const oy = (h - P.height * sc) / 2;
  const X = (x: number) => ox + x * sc;
  const Y = (y: number) => oy + y * sc;
  ctx.drawImage(getTerrain(Math.round(P.width * sc), Math.round(P.height * sc), s.seed), ox, oy);
  ctx.strokeStyle = 'rgba(92,200,255,0.06)';
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= P.width; gx += 10) {
    ctx.beginPath();
    ctx.moveTo(X(gx), Y(0));
    ctx.lineTo(X(gx), Y(P.height));
    ctx.stroke();
  }
  for (let gy = 0; gy <= P.height; gy += 10) {
    ctx.beginPath();
    ctx.moveTo(X(0), Y(gy));
    ctx.lineTo(X(P.width), Y(gy));
    ctx.stroke();
  }
  const hits: MapHit[] = [];
  // 基本任务半径
  ctx.strokeStyle = 'rgba(242,180,90,0.25)';
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(X(P.trainX), Y(P.trainY), s.policies.basicRadius * sc, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // 风险区
  for (const z of P.hazardZones) {
    if (!P.scanned) continue;
    ctx.fillStyle = 'rgba(255,80,60,0.10)';
    ctx.strokeStyle = 'rgba(255,80,60,0.45)';
    ctx.beginPath();
    ctx.arc(X(z.x), Y(z.y), z.r * sc, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // 资源迹象
  for (const sg of P.signs) {
    if (!sg.revealed) continue;
    const col = RES_COLOR[sg.guess];
    ctx.strokeStyle = col;
    ctx.globalAlpha = sg.explored ? 0.25 : 0.85;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(X(sg.x), Y(sg.y), sg.radius * sc, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = col;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(sg.explored ? '' : `? ${sg.label}`, X(sg.x), Y(sg.y) - sg.radius * sc - 4);
    ctx.globalAlpha = 1;
    const exp = sg.exploringGroupId != null ? s.groups.find((g) => g.id === sg.exploringGroupId)?.name : null;
    hits.push({
      x: X(sg.x),
      y: Y(sg.y),
      r: sg.radius * sc,
      html: `<b>${sg.label}</b>${sg.hazard >= 0.15 ? ' <span class="badtext">风险区</span>' : ''}<br>${sg.explored ? `已探索：${sg.resultText}` : exp ? `${exp}正在前往/探索` : '未探索。低级探测仪无法确认矿点，需小组实地探索。'}`,
    });
  }
  ctx.textAlign = 'left';
  // 矿点
  for (const d of P.deposits) {
    if (d.discoveredBy == null) continue;
    const x = X(d.x);
    const y = Y(d.y);
    const empty = d.reserve <= 0;
    ctx.fillStyle = empty ? '#444' : RES_COLOR[d.resource];
    ctx.beginPath();
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x + 8, y);
    ctx.lineTo(x, y + 8);
    ctx.lineTo(x - 8, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.stroke();
    // 作业位置
    d.slots.forEach((sl, i) => {
      ctx.fillStyle = sl.status === 'free' ? '#6bd68f' : sl.status === 'working' ? '#ffcc55' : '#ff9a3c';
      ctx.fillRect(x - 10 + i * 8, y + 11, 6, 6);
    });
    ctx.fillStyle = '#e8eefc';
    ctx.font = '11px sans-serif';
    ctx.fillText(`${d.name} ${fmt(d.reserve)}`, x + 11, y + 4);
    const slotTxt = d.slots
      .map((sl, i) => {
        const g = s.groups.find((x) => x.id === sl.holderGroupId);
        return `位置${i + 1}：${sl.status === 'free' ? '<span class="ok">空闲</span>' : sl.status === 'working' ? `${g?.name}作业中` : `${g?.name}保留（剩余 ${fmtTime(sl.reservedUntil - s.time)}）`}`;
      })
      .join('<br>');
    hits.push({
      x,
      y,
      r: 12,
      html: `<b>${d.name}</b>（${ITEM_INFO[d.resource].label}）<br>储量 ${fmt(d.reserve)}/${d.initialReserve}${empty ? ' <span class="badtext">已采空</span>' : ''}${d.hazard >= 0.15 ? '<br><span class="badtext">风险区：可能落石</span>' : ''}<br>${slotTxt}`,
    });
  }
  // 列车
  const tx = X(P.trainX);
  const ty = Y(P.trainY);
  ctx.fillStyle = '#f2b45a';
  ctx.fillRect(tx - 18, ty - 5, 36, 10);
  ctx.strokeStyle = '#5cc8ff';
  ctx.strokeRect(tx - 18, ty - 5, 36, 10);
  ctx.fillStyle = '#fff';
  ctx.font = '11px sans-serif';
  ctx.fillText('列车', tx - 12, ty + 20);
  hits.push({ x: tx, y: ty, r: 18, html: `<b>列车（轨道锚点）</b><br>机库：${s.shuttles.filter((x) => x.docked).length}/${s.shuttles.length} 架停靠` });
  if (s.recallActive) {
    ctx.strokeStyle = `rgba(255,107,107,${0.5 + 0.4 * Math.sin(now / 200)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tx, ty, 26 + ((now / 30) % 30), 0, Math.PI * 2);
    ctx.stroke();
  }
  // 运输机
  s.groups.forEach((g, gi) => {
    const sh = s.shuttles.find((x) => x.id === g.shuttleId);
    if (!sh || sh.docked) return;
    const x = X(sh.x);
    const y = Y(sh.y);
    // 目标线
    let tgt: { x: number; y: number } | null = null;
    if (g.state === 'returning') tgt = { x: P.trainX, y: P.trainY };
    else if (g.target?.kind === 'explore') tgt = P.signs.find((z) => z.id === g.target!.signId) ?? null;
    else if (g.target?.kind === 'mine') tgt = P.deposits.find((z) => z.id === g.target!.depositId) ?? null;
    if (tgt) {
      ctx.strokeStyle = GROUP_COLOR[gi];
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(X(tgt.x), Y(tgt.y));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    const ang = tgt ? Math.atan2(Y(tgt.y) - y, X(tgt.x) - x) : 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = GROUP_COLOR[gi];
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, -6);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = GROUP_COLOR[gi];
    ctx.font = '11px sans-serif';
    ctx.fillText(g.name, x + 8, y - 8);
    hits.push({
      x,
      y,
      r: 12,
      html: `<b>${g.name} · ${sh.name}</b><br>${g.status}<br>货舱 ${fmt(cargoUsed(sh))}/${cargoCap(sh)} · 推进剂 ${fmt(sh.fuel, 1)} · 耐久 ${fmt(sh.durability)}<br><span class="note">${g.reason}</span>`,
    });
  });
  // 图例
  ctx.fillStyle = 'rgba(10,14,28,0.85)';
  ctx.fillRect(w - 230, h - 92, 222, 84);
  ctx.font = '11px sans-serif';
  const legend: [string, string][] = [
    ['#6bd68f', '空闲作业位置'],
    ['#ffcc55', '作业中'],
    ['#ff9a3c', '返航保留中'],
  ];
  legend.forEach(([c, t], i) => {
    ctx.fillStyle = c;
    ctx.fillRect(w - 220, h - 82 + i * 16, 8, 8);
    ctx.fillStyle = '#cfd6e6';
    ctx.fillText(t, w - 206, h - 74 + i * 16);
  });
  ctx.fillStyle = '#cfd6e6';
  ctx.fillText('虚线圈=资源迹象  ◆=已确认矿点', w - 220, h - 26);
  ctx.fillText('橙色虚线=基本任务半径  红圈=风险区', w - 220, h - 12);
  if (!P.scanned) {
    ctx.fillStyle = '#cfd6e6';
    ctx.font = '15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(P.scanProgress >= 0 ? `扫描中… ${P.scanProgress} 分` : '尚未扫描。到「列车」面板启动列车探测仪。', w / 2, 40);
    ctx.textAlign = 'left';
  }
  void mouse;
  return hits;
}
