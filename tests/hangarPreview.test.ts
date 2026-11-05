import { describe, expect, it } from 'vitest';
import { advance, canDepart, canReturn, depart, initialShuttles, poseOf, recall, resetAll, TIMING } from '../src/preview/hangarAnim';
import { BAYS, fitReport, MARGIN_Y, SHUTTLE_L } from '../src/preview/hangarLayout';

const run = (a: ReturnType<typeof initialShuttles>[number], seconds: number, fps: number) => {
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) advance(a, 1 / fps);
};

describe('机库预览：布局', () => {
  it('六个泊位：上侧三个机头朝上，下侧三个机头朝下；路线都在本泊位中心线上', () => {
    expect(BAYS.map((b) => b.label)).toEqual(['上侧 1', '上侧 2', '上侧 3', '下侧 1', '下侧 2', '下侧 3']);
    for (const b of BAYS) {
      const p = poseOf({ bayId: b.id, status: 'docked', t: 0, leg: 0 });
      expect(p.angle).toBe(b.side === 'up' ? 0 : Math.PI);
      expect(b.door.x).toBe(b.park.x);
      expect(b.platform.x).toBe(b.park.x);
      // 出口方向：上侧往上（y 变小），下侧往下
      const dir = b.side === 'up' ? -1 : 1;
      expect(Math.sign(b.door.y - b.park.y)).toBe(dir);
      expect(Math.sign(b.platform.y - b.door.y)).toBe(dir);
      expect(Math.sign(b.away.y - b.platform.y)).toBe(dir);
    }
  });

  it('统一尺寸在每个泊位的门口、外平台、机舱、停机坪都放得下；停在平台上时整机离开门口', () => {
    for (const r of fitReport()) {
      expect(r.fitsDoor, r.bay).toBe(true);
      expect(r.fitsPlatform, r.bay).toBe(true);
      expect(r.clearOfDoorOnPlatform, r.bay).toBe(true);
      expect(r.fitsRoom, r.bay).toBe(true);
      expect(r.fitsPad, r.bay).toBe(true);
      expect(r.doorClearancePerSide).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('离开位置在预览画面以内（能看到淡出），且整机已越过平台外端', () => {
    for (const b of BAYS) {
      const y = b.away.y;
      expect(y).toBeGreaterThan(-MARGIN_Y);
      expect(y).toBeLessThan(1 + MARGIN_Y);
      const outer = b.platformSpan[0];
      expect(Math.abs(y - outer)).toBeGreaterThan(SHUTTLE_L / 2);
    }
  });
});

describe('机库预览：状态与动画', () => {
  it('出航：已停靠 → 正在出航 → 已离队；途中在平台停约 1 秒，方向不变，归队按原路倒退', () => {
    const list = initialShuttles();
    const a = list[0];
    const bay = BAYS[0];
    expect(a.status).toBe('docked');
    expect(canReturn(a)).toBe(false);
    expect(depart(a)).toBe(true);
    expect(depart(a)).toBe(false); // 不能重复出航
    expect(recall(a)).toBe(false); // 出航途中不能归队
    run(a, TIMING.taxiOut + 0.3, 60);
    let p = poseOf(a);
    expect(p.y).toBeCloseTo(bay.platform.y, 6);
    expect(p.engine).toBeGreaterThan(0);
    run(a, 0.5, 60);
    expect(poseOf(a).y).toBeCloseTo(bay.platform.y, 6);
    run(a, TIMING.holdOut + TIMING.launch, 60);
    expect(a.status).toBe('away');
    expect(canDepart(a)).toBe(false);
    expect(canReturn(a)).toBe(true);
    expect(recall(a)).toBe(true);
    run(a, 1.5, 60);
    p = poseOf(a);
    expect(p.angle).toBe(0); // 机头仍朝外
    expect(p.y).toBeLessThan(bay.platform.y);
    run(a, TIMING.approach - 1.5 + TIMING.holdIn + 0.01, 60);
    expect(poseOf(a).y).toBeCloseTo(bay.platform.y, 2);
    run(a, TIMING.taxiIn, 60);
    expect(a.status).toBe('docked');
    expect(poseOf(a)).toMatchObject({ y: bay.park.y, engine: 0, alpha: 1 });
  });

  it('总时长：出航约 6–8 秒', () => {
    const total = TIMING.taxiOut + TIMING.holdOut + TIMING.launch;
    expect(total).toBeGreaterThanOrEqual(6);
    expect(total).toBeLessThanOrEqual(8);
  });

  it('按经过时间推进：30 帧与 144 帧下同一时刻位置相同', () => {
    const a = initialShuttles()[4];
    const b = initialShuttles()[4];
    depart(a);
    depart(b);
    run(a, 3.5, 30);
    run(b, 3.5, 144);
    expect(poseOf(a).y).toBeCloseTo(poseOf(b).y, 6);
    run(a, 1.5, 30); // 两种帧率都恰好整数帧
    run(b, 1.5, 144);
    expect(poseOf(a).y).toBeCloseTo(poseOf(b).y, 6);
  });

  it('多架同时移动互不影响；重置在动画途中也能把六架全部放回机位', () => {
    const list = initialShuttles();
    depart(list[0]);
    for (const a of list) advance(a, 2);
    depart(list[3]);
    for (const a of list) advance(a, 1);
    expect(list.map((a) => a.status)).toEqual(['departing', 'docked', 'docked', 'departing', 'docked', 'docked']);
    expect(poseOf(list[0]).y).not.toBeCloseTo(poseOf(list[3]).y, 3);
    resetAll(list);
    for (const a of list) {
      expect(a.status).toBe('docked');
      const bay = BAYS.find((b) => b.id === a.bayId)!;
      expect(poseOf(a)).toMatchObject({ x: bay.park.x, y: bay.park.y, alpha: 1, engine: 0 });
    }
  });
});
