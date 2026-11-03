export const TILE = 16;
export const MAX_LEVEL = 3;
export const GAME_W = 960;
export const GAME_H = 640;
export const ZOOM = 3;

export const FONT =
  '"Zpix", "Fusion Pixel", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", "WenQuanYi Micro Hei", sans-serif';

/** 瓦片索引（与 textures.ts 中绘制顺序一致） */
export const TileIdx = {
  FLOOR: 0,
  FLOOR_ALT: 1,
  WALL_TOP: 2,
  WALL_FACE: 3,
  VOID: 4,
  STAIRS: 5,
  BOSS_FLOOR: 6,
  FOG: 7,
  FOG_HALF: 8,
} as const;

export const SOLID_TILES = [TileIdx.WALL_TOP, TileIdx.WALL_FACE, TileIdx.VOID];

export const PLAYER = {
  maxHp: 100,
  speed: 105,
  attackCooldown: 300,
  damage: 1,
  invuln: 800,
  potionHeal: 35,
};
