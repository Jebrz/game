// 列车内部：扫描、加工队列、主驱动维修、研究

import { RESEARCH_RATE, SURVIVAL, TRAIN } from '../config/balance';
import { ITEM_INFO, RECIPES, RESEARCH } from '../config/content';
import { add, fmt, log } from './core';
import { deptStats, processingSpeed } from './staff';
import type { GameState } from './types';

export function recipeOutputs(s: GameState, recipeId: string): Partial<Record<keyof GameState['inventory'], number>> {
  const r = RECIPES.find((x) => x.id === recipeId)!;
  const out = { ...r.outputs };
  if (recipeId === 'propellant' && s.research.done.includes('propellantRefine')) out.propellant = (out.propellant ?? 0) + 2;
  return out;
}

export function tickScan(s: GameState): void {
  const P = s.planet;
  if (!P || P.scanned || P.scanProgress < 0) return;
  P.scanProgress += 1;
  if (P.scanProgress >= TRAIN.scanTime) {
    P.scanned = true;
    for (const sign of P.signs) sign.revealed = true;
    log(s, 'system', `列车探测仪扫描完成：发现 ${P.signs.length} 处资源迹象。低级探测仪无法确认具体矿点，需小组实地探索。`);
  }
}

export function tickProcessing(s: GameState): boolean {
  const job = s.queue[0];
  if (!job) return false;
  const e = SURVIVAL.processingEnergyHour / 60;
  if (s.inventory.energy < e) return false; // 停工等待能源
  s.inventory.energy -= e;
  job.started = true;
  job.remaining -= processingSpeed(s);
  if (job.remaining <= 0) {
    s.queue.shift();
    const out = recipeOutputs(s, job.recipeId);
    add(s.inventory, out);
    const r = RECIPES.find((x) => x.id === job.recipeId)!;
    const txt = Object.entries(out)
      .map(([k, v]) => `${ITEM_INFO[k as keyof typeof ITEM_INFO].label} +${fmt(v ?? 0)}`)
      .join('、');
    log(s, 'economy', `加工完成：${r.label}（${txt}）`);
  }
  return true;
}

export function tickDriveRepair(s: GameState): void {
  const t = s.train;
  if (t.driveRepairTimer <= 0 || t.driveRepaired) return;
  t.driveRepairTimer -= processingSpeed(s);
  if (t.driveRepairTimer <= 0) {
    t.driveRepairTimer = 0;
    t.driveRepaired = true;
    s.boosts.push({ label: '主驱动修复', until: s.time + 360, morale: 6 });
    log(s, 'system', '主驱动维修完成！列车具备离站能力（仍需轨道燃料）。');
    s.toasts.push({ t: s.time, title: '主驱动已修复', text: '工程人员完成了必要维修。' });
  }
}

export function tickResearch(s: GameState): boolean {
  const cur = s.research.current;
  if (!cur) return false;
  const e = SURVIVAL.researchEnergyHour / 60;
  if (s.inventory.energy < e) return false;
  s.inventory.energy -= e;
  const eff = deptStats(s).research.eff;
  s.research.progress += (eff * RESEARCH_RATE) / 60;
  const proj = RESEARCH.find((x) => x.id === cur)!;
  if (s.research.progress >= proj.cost) {
    s.research.done.push(cur);
    s.research.current = null;
    s.research.progress = 0;
    log(s, 'research', `研究完成：${proj.label}。${proj.desc}`);
    s.toasts.push({ t: s.time, title: '研究完成', text: `${proj.label}：${proj.desc}` });
  }
  return true;
}
