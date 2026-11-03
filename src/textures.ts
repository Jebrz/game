// 所有美术素材在运行时用 Canvas 程序化绘制，无需任何外部图片。
import Phaser from 'phaser';
import { TILE, GAME_W, GAME_H } from './constants';

type Palette = Record<string, string>;

const OUT = '#120e18';

function drawRows(ctx: CanvasRenderingContext2D, rows: string[], pal: Palette, ox: number, oy: number) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = pal[row[x]];
      if (c) {
        ctx.fillStyle = c;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  });
}

/** 由多帧字符画生成精灵表（帧横向排列）。 */
function pixelSheet(scene: Phaser.Scene, key: string, frames: string[][], pal: Palette) {
  const fw = Math.max(...frames.flat().map((r) => r.length));
  const fh = Math.max(...frames.map((f) => f.length));
  const tex = scene.textures.createCanvas(key, fw * frames.length, fh)!;
  const ctx = tex.getContext();
  frames.forEach((rows, i) => {
    drawRows(ctx, rows, pal, i * fw, 0);
    tex.add(i, 0, i * fw, 0, fw, fh);
  });
  tex.refresh();
}

/** 上半身下移 1 像素，作为“呼吸/弹跳”帧 */
function bob(rows: string[], split: number): string[] {
  const top = rows.slice(0, split);
  const bottom = rows.slice(split);
  const blank = '.'.repeat(rows[0].length);
  return [blank, ...top.slice(0, top.length - 1), ...bottom].slice(0, rows.length);
}

function canvasTex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const tex = scene.textures.createCanvas(key, w, h)!;
  draw(tex.getContext());
  tex.refresh();
}

function speckle(ctx: CanvasRenderingContext2D, ox: number, colors: string[], n: number) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(ox + Math.floor(Math.random() * TILE), Math.floor(Math.random() * TILE), 1, 1);
  }
}

export function generateTextures(scene: Phaser.Scene) {
  // ---------- 瓦片集 ----------
  canvasTex(scene, 'tiles', TILE * 9, TILE, (ctx) => {
    // 0 地面
    let ox = 0;
    ctx.fillStyle = '#2a2433';
    ctx.fillRect(ox, 0, TILE, TILE);
    speckle(ctx, ox, ['#322b3d', '#231e2b', '#2f2838'], 22);
    ctx.fillStyle = '#211c29';
    ctx.fillRect(ox, 15, 16, 1);
    ctx.fillRect(ox + 15, 0, 1, 16);
    // 1 地面（碎石变体）
    ox = 16;
    ctx.fillStyle = '#2a2433';
    ctx.fillRect(ox, 0, TILE, TILE);
    speckle(ctx, ox, ['#322b3d', '#231e2b'], 14);
    ctx.fillStyle = '#3a3247';
    ctx.fillRect(ox + 3, 4, 3, 2);
    ctx.fillRect(ox + 10, 10, 2, 2);
    ctx.fillStyle = '#1d1824';
    ctx.fillRect(ox + 3, 6, 3, 1);
    ctx.fillRect(ox + 10, 12, 2, 1);
    ctx.fillRect(ox + 7, 2, 1, 5);
    ctx.fillRect(ox + 8, 6, 1, 3);
    ctx.fillStyle = '#211c29';
    ctx.fillRect(ox, 15, 16, 1);
    ctx.fillRect(ox + 15, 0, 1, 16);
    // 2 墙顶
    ox = 32;
    ctx.fillStyle = '#17131d';
    ctx.fillRect(ox, 0, TILE, TILE);
    speckle(ctx, ox, ['#1e1926', '#120f17'], 16);
    ctx.fillStyle = '#251f2e';
    ctx.fillRect(ox, 0, 16, 1);
    // 3 墙面（砖块）
    ox = 48;
    ctx.fillStyle = '#3b3149';
    ctx.fillRect(ox, 0, TILE, TILE);
    ctx.fillStyle = '#4c405e';
    ctx.fillRect(ox, 0, 16, 2);
    ctx.fillStyle = '#251e2e';
    for (const y of [5, 10, 15]) ctx.fillRect(ox, y, 16, 1);
    for (const [x, y0] of [
      [4, 2],
      [12, 2],
      [8, 6],
      [0, 6],
      [4, 11],
      [12, 11],
    ])
      ctx.fillRect(ox + x, y0, 1, 4);
    speckle(ctx, ox, ['#45395a', '#332a40'], 10);
    // 4 虚空
    ox = 64;
    ctx.fillStyle = '#07060b';
    ctx.fillRect(ox, 0, TILE, TILE);
    // 5 下行楼梯
    ox = 80;
    ctx.fillStyle = '#2a2433';
    ctx.fillRect(ox, 0, TILE, TILE);
    const steps = ['#6b5d80', '#544868', '#3e3450', '#2a2238', '#17121f'];
    steps.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(ox + 2 + i, 2 + i * 2.4, 12 - i * 2, 3);
    });
    ctx.fillStyle = '#f2c14e';
    ctx.fillRect(ox + 1, 1, 14, 1);
    ctx.fillRect(ox + 1, 14, 14, 1);
    ctx.fillRect(ox + 1, 1, 1, 14);
    ctx.fillRect(ox + 14, 1, 1, 14);
    // 6 魔王房地面
    ox = 96;
    ctx.fillStyle = '#2e1a24';
    ctx.fillRect(ox, 0, TILE, TILE);
    speckle(ctx, ox, ['#3a2030', '#24131c', '#4a1c28'], 22);
    ctx.fillStyle = '#22121a';
    ctx.fillRect(ox, 15, 16, 1);
    ctx.fillRect(ox + 15, 0, 1, 16);
    // 7 迷雾
    ox = 112;
    ctx.fillStyle = '#07060b';
    ctx.fillRect(ox, 0, TILE, TILE);
    // 8 半透明迷雾
    ox = 128;
    ctx.fillStyle = 'rgba(7,6,11,0.62)';
    ctx.fillRect(ox, 0, TILE, TILE);
  });

  // ---------- 玩家（骑士） ----------
  const knightPal: Palette = {
    k: OUT,
    h: '#8a93a8',
    H: '#c9d1e0',
    v: '#262a36',
    e: '#6fe3ff',
    b: '#3b5bdb',
    B: '#2a3f9e',
    y: '#f2c14e',
    l: '#5a4630',
    s: '#d8b48a',
  };
  const knightTop = [
    '................',
    '.....kkkkkk.....',
    '....kHHhhhhk....',
    '....kHhhhhhk....',
    '....khvvvvhk....',
    '....khveevhk....',
    '....kkhhhhkk....',
    '...kybbbbbbyk...',
    '..kkbbBbbBbbkk..',
    '..khkbbbbbbkhk..',
    '..kskbyyyybksk..',
    '...k.kbbbbk.k...',
    '.....kBBBBk.....',
  ];
  pixelSheet(
    scene,
    'player',
    [
      [...knightTop, '.....klkklk.....', '.....kll.kll....', '......kk..kk....'],
      [...knightTop, '.....klk.kk.....', '....kll..kl.....', '....kk...kk.....'],
      [...knightTop, '.....kk.klk.....', '.....lk..kll....', '.....kk...kk....'],
    ],
    knightPal,
  );

  // ---------- 史莱姆 ----------
  const slimePal: Palette = { k: OUT, g: '#5cc45c', G: '#a8f0a0', d: '#3a8a3e', w: '#ffffff' };
  const slime = [
    '................',
    '................',
    '................',
    '................',
    '......kkkk......',
    '....kkggggkk....',
    '...kgGGggggk....',
    '..kgGggggggggk..',
    '..kggwkggwkggk..',
    '.kgggwkggwkgggk.',
    '.kggggggggggggk.',
    'kggggggggggggggk',
    'kddddddddddddddk',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................',
  ];
  const slimeSquash = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....kkkkkk.....',
    '...kkgGGgggkk...',
    '..kgGggggggggk..',
    '.kgggwkggwkgggk.',
    '.kgggwkggwkgggk.',
    'kggggggggggggggk',
    'kggggggggggggggk',
    'kddddddddddddddk',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................',
  ];
  pixelSheet(scene, 'slime', [slime, slimeSquash], slimePal);

  // ---------- 蝙蝠 ----------
  const batPal: Palette = { k: OUT, p: '#7a4fb8', P: '#a679e6', r: '#ff4a4a' };
  const batUp = [
    '................',
    '................',
    '.k............k.',
    '.kk...k..k...kk.',
    '.kpk..kkkk..kpk.',
    '.kppk.kppk.kppk.',
    '.kpppkpPPpkpppk.',
    '..kppppPPppppk..',
    '..kppprPPrppk...',
    '...kk.kppk.kk...',
    '.......kk.......',
    '................',
  ];
  const batDown = [
    '................',
    '................',
    '................',
    '......k..k......',
    '......kkkk......',
    '...kkkkppkkkk...',
    '..kpppkPPkpppk..',
    '.kppppPPPPppppk.',
    '.kpp.kprrpk.ppk.',
    '.kk...kppk...kk.',
    '.k.....kk.....k.',
    '................',
  ];
  pixelSheet(scene, 'bat', [batUp, batDown], batPal);

  // ---------- 骷髅法师 ----------
  const magePal: Palette = { k: OUT, m: '#4a2f6e', M: '#6b48a0', w: '#e8e2d0', W: '#ffffff', e: '#c46bff', o: '#ff9cf5' };
  const mage = [
    '.......kk.......',
    '......kmmk......',
    '.....kmMmmk.....',
    '....kmMmmmmk....',
    '....kmwwwwmk....',
    '....kmwekewk....',
    '....kmwwwwmk....',
    '....kkmwkwkk....',
    '...kmmmmmmmmk.o.',
    '..kmmMmmmmMmmkek',
    '..kmmMmmmmMmmkwk',
    '..kwkmmmmmmk.kwk',
    '...kmmmmmmmmkkwk',
    '...kmMmmmmMmk.k.',
    '....kkkkkkkk....',
    '................',
  ];
  pixelSheet(scene, 'mage', [mage, bob(mage, 8)], magePal);

  // ---------- 暗影魔王（Boss）----------
  const bossPal: Palette = { k: OUT, y: '#e8d8a8', r: '#8a1e2e', R: '#c43a3a', Y: '#ffd23f', w: '#f5f0e6', d: '#4a0f1c' };
  const boss = [
    '..k..........k..',
    '.kyk........kyk.',
    '.kyyk......kyyk.',
    '..kyyk.kk.kyyk..',
    '...kkkrrrrkkk...',
    '...krrrrrrrrk...',
    '..krrRrrrrRrrk..',
    '..krRYYrrYYRrk..',
    '..krrkYrrYkrrk..',
    '..krrrrrrrrrrk..',
    '.kkrrkwwwwkrrkk.',
    'kRrrrrkkkkrrrrRk',
    'kRrkrrdrrdrrkrRk',
    '.kk.krrRRrrk.kk.',
    '....krk..krk....',
    '....kk....kk....',
  ];
  pixelSheet(scene, 'boss', [boss, bob(boss, 11)], bossPal);

  // ---------- 物品 ----------
  pixelSheet(
    scene,
    'coin',
    [
      ['..kkkk..', '.kyyyyk.', 'kyYyyyyk', 'kyYyddyk', 'kyYyddyk', 'kyyyyyyk', '.kyyyyk.', '..kkkk..'],
      ['...kk...', '..kyyk..', '..kYyk..', '..kYdk..', '..kYdk..', '..kyyk..', '..kyyk..', '...kk...'],
    ],
    { k: '#5c3d0a', y: '#f2c14e', Y: '#fff1a8', d: '#c99428' },
  );
  pixelSheet(
    scene,
    'potion',
    [
      [
        '...kkk...',
        '...kck...',
        '...kck...',
        '..kkkkk..',
        '.kRrrrrk.',
        'kRWrrrrrk',
        'kRrrrrrrk',
        'krrrrrrrk',
        'kdrrrrrdk',
        '.kdddddk.',
        '..kkkkk..',
      ],
    ],
    { k: OUT, c: '#c9a26b', r: '#e0344a', R: '#ff7a8a', W: '#ffffff', d: '#9a1c30' },
  );
  pixelSheet(
    scene,
    'heart',
    [['.kk.kk.', 'kRrkrrk', 'kRrrrrk', 'krrrrrk', '.krrrk.', '..krk..', '...k...']],
    { k: OUT, r: '#e0344a', R: '#ff8a9a' },
  );
  pixelSheet(
    scene,
    'bones',
    [['................', '..w.......w.....', '...w.....w......', '....wwwww....ww.', '...w.....w..wwww', '..w.......w..ww.']],
    { w: '#8a8070' },
  );

  // 火把
  pixelSheet(
    scene,
    'torch',
    [
      ['...o....', '..oyo...', '..yYyo..', '..oyYo..', '...kk...', '..kbbk..', '...bb...', '...bb...'],
      ['....o...', '...oyo..', '..oyYy..', '..oYyo..', '...kk...', '..kbbk..', '...bb...', '...bb...'],
    ],
    { o: '#ff6a2a', y: '#ffb347', Y: '#fff2a0', k: '#3a2a1a', b: '#6a4a2a' },
  );

  // 剑气（弧形挥砍）
  canvasTex(scene, 'slash', 28, 28, (ctx) => {
    const cx = 6;
    const cy = 14;
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = i < 2 ? 'rgba(255,255,255,1)' : i < 4 ? 'rgba(190,230,255,0.85)' : 'rgba(110,180,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 16 - i, -1.1, 1.1);
      ctx.stroke();
    }
  });

  canvasTex(scene, 'px', 2, 2, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 2, 2);
  });
  canvasTex(scene, 'shadow', 14, 5, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(3, 0, 8, 5);
    ctx.fillRect(1, 1, 12, 3);
  });
  canvasTex(scene, 'bolt', 8, 8, (ctx) => {
    ctx.fillStyle = 'rgba(196,107,255,0.45)';
    ctx.fillRect(0, 2, 8, 4);
    ctx.fillRect(2, 0, 4, 8);
    ctx.fillStyle = '#e0a0ff';
    ctx.fillRect(2, 2, 4, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(3, 3, 2, 2);
  });
  canvasTex(scene, 'bossbolt', 10, 10, (ctx) => {
    ctx.fillStyle = 'rgba(255,90,40,0.45)';
    ctx.fillRect(0, 3, 10, 4);
    ctx.fillRect(3, 0, 4, 10);
    ctx.fillRect(1, 1, 8, 8);
    ctx.fillStyle = '#ff9a3c';
    ctx.fillRect(2, 2, 6, 6);
    ctx.fillStyle = '#fff2a0';
    ctx.fillRect(4, 4, 2, 2);
  });
  // 光晕（火把/药水发光）
  canvasTex(scene, 'glow', 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,170,90,0.55)');
    g.addColorStop(0.5, 'rgba(255,120,50,0.18)');
    g.addColorStop(1, 'rgba(255,120,50,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  // 屏幕暗角
  canvasTex(scene, 'vignette', GAME_W, GAME_H, (ctx) => {
    const g = ctx.createRadialGradient(GAME_W / 2, GAME_H / 2, GAME_H * 0.28, GAME_W / 2, GAME_H / 2, GAME_W * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.78)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, GAME_W, GAME_H);
  });
  canvasTex(scene, 'hurtvignette', GAME_W, GAME_H, (ctx) => {
    const g = ctx.createRadialGradient(GAME_W / 2, GAME_H / 2, GAME_H * 0.3, GAME_W / 2, GAME_H / 2, GAME_W * 0.6);
    g.addColorStop(0, 'rgba(200,0,20,0)');
    g.addColorStop(1, 'rgba(200,0,20,0.6)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, GAME_W, GAME_H);
  });

  // ---------- 动画 ----------
  const a = scene.anims;
  a.create({ key: 'player-walk', frames: a.generateFrameNumbers('player', { frames: [1, 0, 2, 0] }), frameRate: 10, repeat: -1 });
  a.create({ key: 'slime-move', frames: a.generateFrameNumbers('slime', { frames: [0, 1] }), frameRate: 4, repeat: -1 });
  a.create({ key: 'bat-move', frames: a.generateFrameNumbers('bat', { frames: [0, 1] }), frameRate: 10, repeat: -1 });
  a.create({ key: 'mage-move', frames: a.generateFrameNumbers('mage', { frames: [0, 1] }), frameRate: 3, repeat: -1 });
  a.create({ key: 'boss-move', frames: a.generateFrameNumbers('boss', { frames: [0, 1] }), frameRate: 3, repeat: -1 });
  a.create({ key: 'coin-spin', frames: a.generateFrameNumbers('coin', { frames: [0, 1] }), frameRate: 5, repeat: -1 });
  a.create({ key: 'torch-burn', frames: a.generateFrameNumbers('torch', { frames: [0, 1] }), frameRate: 6, repeat: -1 });
}
