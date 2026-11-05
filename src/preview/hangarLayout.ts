// 六泊位机库预览：从背景图实测得到的位置（以图片宽高为 1 的相对坐标，缩放后仍对齐）。
// 测量来源：art/source/hangar/14-empty-six-bay-hangar-candidate（1376×768）。
// 方法见 docs/HANGAR_PREVIEW.md。

/** 背景图原始像素尺寸（用于把实测像素换算成相对坐标） */
export const HANGAR_PX = { w: 1376, h: 768 } as const;
/** 运输机素材不透明部分的宽高（像素），机头朝上 */
export const SHUTTLE_PX = { w: 834, h: 718 } as const;

const px = (x: number, y: number) => ({ x: x / HANGAR_PX.w, y: y / HANGAR_PX.h });

export type Side = 'up' | 'down';

export interface Bay {
  id: string;
  label: string;
  side: Side;
  /** 泊位中心（停机坪黄框中心） */
  park: { x: number; y: number };
  /** 门口中心（机舱与外平台的连接处） */
  door: { x: number; y: number };
  /** 外平台停靠位置（平台中心） */
  platform: { x: number; y: number };
  /** 离开平台后的去向（预览画面边缘附近，淡出） */
  away: { x: number; y: number };
  /** 门口净宽（相对图片宽度） */
  doorWidth: number;
  /** 外平台沿航向的可用长度（相对图片高度）：[靠外端, 靠门端] */
  platformSpan: [number, number];
  /** 机舱沿航向的可用长度（相对图片高度）：[门口, 内墙] */
  roomSpan: [number, number];
  /** 停机坪黄框（相对坐标）：[x0, y0, x1, y1] */
  pad: [number, number, number, number];
}

// 实测像素（三列泊位中心线 x；上侧平台 y 12–131、门口 y 131、黄框 y 163–285、机舱内墙 y≈322；下侧上下镜像）
const COLS = [246, 688, 1130];
const DOOR_INNER_PX = 252; // 门口外框 261 px，减去两侧墙线
const PAD_W_PX = 163;
/** 预览画面在背景图上下各延伸的高度（相对图片高度），用来看清飞离平台 */
export const MARGIN_Y = 0.22;

export const BAYS: Bay[] = COLS.flatMap((cx, i) => {
  const up: Bay = {
    id: `up${i + 1}`,
    label: `上侧 ${i + 1}`,
    side: 'up',
    park: px(cx, 224),
    door: px(cx, 131),
    platform: px(cx, 71.5),
    away: px(cx, -150),
    doorWidth: DOOR_INNER_PX / HANGAR_PX.w,
    platformSpan: [16 / HANGAR_PX.h, 129 / HANGAR_PX.h],
    roomSpan: [131 / HANGAR_PX.h, 322 / HANGAR_PX.h],
    pad: [(cx - PAD_W_PX / 2) / HANGAR_PX.w, 163 / HANGAR_PX.h, (cx + PAD_W_PX / 2) / HANGAR_PX.w, 285 / HANGAR_PX.h],
  };
  const down: Bay = {
    id: `down${i + 1}`,
    label: `下侧 ${i + 1}`,
    side: 'down',
    park: px(cx, 543),
    door: px(cx, 633),
    platform: px(cx, 692.5),
    away: px(cx, 768 + 150),
    doorWidth: DOOR_INNER_PX / HANGAR_PX.w,
    platformSpan: [752 / HANGAR_PX.h, 635 / HANGAR_PX.h],
    roomSpan: [633 / HANGAR_PX.h, 446 / HANGAR_PX.h],
    pad: [(cx - PAD_W_PX / 2) / HANGAR_PX.w, 482 / HANGAR_PX.h, (cx + PAD_W_PX / 2) / HANGAR_PX.w, 604 / HANGAR_PX.h],
  };
  return [up, down];
}).sort((a, b) => (a.side === b.side ? a.id.localeCompare(b.id) : a.side === 'up' ? -1 : 1));

/**
 * 运输机统一尺寸（翼展，相对图片宽度）。
 * 按门口留 10%–15% 余量，翼展应为 189 px（机长 163 px），但外平台只有约 113 px 长，放不下。
 * 因此按外平台定一个保守尺寸：机长约 102 px（两端各留约 5 px），翼展 118 px。
 * 这时门口两侧各剩约 67 px（约 27%），停机坪黄框和机舱也都放得下。
 */
export const SHUTTLE_WINGSPAN_PX = 118;
export const SHUTTLE_W = SHUTTLE_WINGSPAN_PX / HANGAR_PX.w;
/** 机长（相对图片高度） */
export const SHUTTLE_L = (SHUTTLE_WINGSPAN_PX * SHUTTLE_PX.h) / SHUTTLE_PX.w / HANGAR_PX.h;

export interface FitReport {
  bay: string;
  doorClearancePerSide: number; // 相对门宽
  fitsDoor: boolean;
  fitsPlatform: boolean;
  clearOfDoorOnPlatform: boolean;
  fitsRoom: boolean;
  fitsPad: boolean;
}

/** 检查统一尺寸在每个泊位都放得下（纯计算，供测试与说明文档使用） */
export function fitReport(): FitReport[] {
  const wPx = SHUTTLE_W * HANGAR_PX.w;
  const lPx = SHUTTLE_L * HANGAR_PX.h;
  return BAYS.map((b) => {
    const doorPx = b.doorWidth * HANGAR_PX.w;
    const pyc = b.platform.y * HANGAR_PX.h;
    const [p0, p1] = b.platformSpan.map((v) => v * HANGAR_PX.h).sort((a, c) => a - c);
    const [r0, r1] = b.roomSpan.map((v) => v * HANGAR_PX.h).sort((a, c) => a - c);
    const parkY = b.park.y * HANGAR_PX.h;
    const doorY = b.door.y * HANGAR_PX.h;
    const padW = (b.pad[2] - b.pad[0]) * HANGAR_PX.w;
    const padH = (b.pad[3] - b.pad[1]) * HANGAR_PX.h;
    return {
      bay: b.label,
      doorClearancePerSide: (doorPx - wPx) / 2 / doorPx,
      fitsDoor: wPx < doorPx,
      fitsPlatform: pyc - lPx / 2 >= p0 && pyc + lPx / 2 <= p1,
      clearOfDoorOnPlatform: Math.abs(pyc - doorY) > lPx / 2,
      fitsRoom: parkY - lPx / 2 >= r0 && parkY + lPx / 2 <= r1 && wPx < 332,
      fitsPad: wPx <= padW && lPx <= padH,
    };
  });
}
