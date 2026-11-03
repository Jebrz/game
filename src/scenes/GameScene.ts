import Phaser from 'phaser';
import { TILE, MAX_LEVEL, FONT, ZOOM, TileIdx, SOLID_TILES, PLAYER } from '../constants';
import { generateDungeon, Dungeon, Room } from '../dungeon';
import { sfx } from '../sfx';

export type EnemyKind = 'slime' | 'bat' | 'mage' | 'boss';
type EState = 'sleep' | 'idle' | 'chase' | 'windup' | 'lunge' | 'recover' | 'stun';
type BossMove = 'burst' | 'charge' | 'summon';

interface KindDef {
  name: string;
  hp: number;
  speed: number;
  dmg: number;
  aggro: number;
  radius: number;
  color: number;
  body: [number, number, number, number];
  shadowDy: number;
  scale: number;
}

const KINDS: Record<EnemyKind, KindDef> = {
  slime: { name: '史莱姆', hp: 3, speed: 42, dmg: 10, aggro: 120, radius: 7, color: 0x6ad66a, body: [12, 8, 2, 7], shadowDy: 7, scale: 1 },
  bat: { name: '蝙蝠', hp: 2, speed: 68, dmg: 7, aggro: 140, radius: 6, color: 0xa679e6, body: [10, 8, 3, 3], shadowDy: 10, scale: 1 },
  mage: { name: '骷髅法师', hp: 3, speed: 38, dmg: 12, aggro: 150, radius: 7, color: 0xc46bff, body: [10, 10, 3, 4], shadowDy: 7, scale: 1 },
  boss: { name: '暗影魔王', hp: 50, speed: 40, dmg: 18, aggro: 9999, radius: 14, color: 0xff5040, body: [12, 10, 2, 5], shadowDy: 15, scale: 2 },
};

export interface RunData {
  level: number;
  hp: number;
  maxHp: number;
  coins: number;
  kills: number;
  startTime: number;
}

export interface Toast {
  text: string;
  color: string;
  big?: boolean;
}

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  kind: EnemyKind;
  def: KindDef;
  hp: number;
  maxHp: number;
  eState: EState = 'idle';
  stateUntil = 0;
  nextAttack = 0;
  losAt = 0;
  hasLos = false;
  seed = Math.random() * 1000;
  wander = new Phaser.Math.Vector2();
  wanderUntil = 0;
  lungeDir = new Phaser.Math.Vector2();
  bossMove: BossMove | null = null;
  phase = 1;
  minion = false;
  shadow: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, x: number, y: number, kind: EnemyKind) {
    super(scene, x, y, kind, 0);
    this.kind = kind;
    this.def = KINDS[kind];
    this.hp = this.maxHp = this.def.hp;
    scene.add.existing(this);
    this.shadow = scene.add.image(x, y, 'shadow').setScale(this.def.scale);
    this.setScale(this.def.scale);
    this.play(`${kind}-move`);
    this.anims.setProgress(Math.random());
  }
}

const DIRS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export class GameScene extends Phaser.Scene {
  run!: RunData;
  ready = false;
  /** play: 正常游玩；transition: 切换楼层；dead / won：结算 */
  state: 'play' | 'transition' | 'dead' | 'won' = 'play';
  result: 'win' | 'lose' | null = null;
  endTime = 0;
  toasts: Toast[] = [];
  hurtFlashAt = -9999;

  dungeon!: Dungeon;
  explored!: Uint8Array;
  flow!: Int16Array;
  private flowTile = -1;
  private lastPlayerTile = -1;
  private lastRoom = -1;
  visitedRooms = new Set<number>();

  private map!: Phaser.Tilemaps.Tilemap;
  private ground!: Phaser.Tilemaps.TilemapLayer;
  private fog!: Phaser.Tilemaps.TilemapLayer;

  player!: Phaser.Physics.Arcade.Sprite;
  private playerShadow!: Phaser.GameObjects.Image;
  private facing = new Phaser.Math.Vector2(0, 1);
  private nextAttack = 0;
  private attackSlowUntil = 0;
  private invulnUntil = 0;
  private knockUntil = 0;

  enemies!: Phaser.Physics.Arcade.Group;
  private shots!: Phaser.Physics.Arcade.Group;
  private coins!: Phaser.Physics.Arcade.Group;
  private potions!: Phaser.Physics.Arcade.Group;
  private emitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();
  stairsPos: { x: number; y: number } | null = null;
  boss: Enemy | null = null;
  bossActive = false;
  private potionFullHintAt = 0;

  private keys!: {
    up: Phaser.Input.Keyboard.Key[];
    down: Phaser.Input.Keyboard.Key[];
    left: Phaser.Input.Keyboard.Key[];
    right: Phaser.Input.Keyboard.Key[];
    attack: Phaser.Input.Keyboard.Key;
  };

  constructor() {
    super('Game');
  }

  init(data: Partial<RunData>) {
    this.run = {
      level: data.level ?? 1,
      hp: data.hp ?? PLAYER.maxHp,
      maxHp: data.maxHp ?? PLAYER.maxHp,
      coins: data.coins ?? 0,
      kills: data.kills ?? 0,
      startTime: data.startTime ?? Date.now(),
    };
    this.ready = false;
    this.state = 'play';
    this.result = null;
    this.toasts = [];
    this.boss = null;
    this.bossActive = false;
    this.stairsPos = null;
    this.flowTile = -1;
    this.lastPlayerTile = -1;
    this.lastRoom = -1;
    this.visitedRooms = new Set();
    this.emitters = new Map();
    this.nextAttack = 0;
    this.invulnUntil = 0;
    this.knockUntil = 0;
    this.hurtFlashAt = -9999;
  }

  get isBossLevel() {
    return this.run.level >= MAX_LEVEL;
  }

  create() {
    const d = (this.dungeon = generateDungeon(this.run.level, this.isBossLevel));
    this.explored = new Uint8Array(d.w * d.h);
    this.flow = new Int16Array(d.w * d.h).fill(-1);

    this.buildMap();
    this.placeDecor();

    // 玩家
    const sx = (d.start.cx + 0.5) * TILE;
    const sy = (d.start.cy + 0.5) * TILE;
    this.playerShadow = this.add.image(sx, sy, 'shadow');
    this.player = this.physics.add.sprite(sx, sy, 'player', 0);
    this.player.setSize(10, 8).setOffset(3, 8);

    // 分组
    this.enemies = this.physics.add.group();
    this.shots = this.physics.add.group();
    this.coins = this.physics.add.group();
    this.potions = this.physics.add.group();

    this.populate();

    // 碰撞
    this.physics.add.collider(this.player, this.ground);
    this.physics.add.collider(this.enemies, this.ground);
    this.physics.add.collider(this.enemies, this.enemies);
    this.physics.add.collider(this.shots, this.ground, (s) => this.popShot(s as Phaser.Physics.Arcade.Image));
    this.physics.add.overlap(this.player, this.shots, (_p, s) => {
      const shot = s as Phaser.Physics.Arcade.Image;
      if (!shot.active) return;
      this.hurtPlayer(shot.getData('dmg') as number, shot.x, shot.y);
      this.popShot(shot);
    });
    this.physics.add.overlap(this.player, this.enemies, (_p, e) => this.onEnemyContact(e as Enemy));
    this.physics.add.overlap(this.player, this.coins, (_p, c) => this.pickCoin(c as Phaser.Physics.Arcade.Sprite));
    this.physics.add.overlap(this.player, this.potions, (_p, c) => this.pickPotion(c as Phaser.Physics.Arcade.Sprite));

    // 相机
    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    cam.setBounds(0, 0, d.w * TILE, d.h * TILE);
    cam.startFollow(this.player, true, 0.14, 0.14);
    cam.setBackgroundColor('#07060b');
    cam.fadeIn(450, 0, 0, 0);

    // 输入
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      up: [kb.addKey(K.W), kb.addKey(K.UP)],
      down: [kb.addKey(K.S), kb.addKey(K.DOWN)],
      left: [kb.addKey(K.A), kb.addKey(K.LEFT)],
      right: [kb.addKey(K.D), kb.addKey(K.RIGHT)],
      attack: kb.addKey(K.SPACE),
    };
    kb.addCapture([K.SPACE, K.UP, K.DOWN, K.LEFT, K.RIGHT]);

    this.updateFog(true);

    if (this.isBossLevel) {
      this.toast(`第 ${this.run.level} 层 · 魔王巢穴`, '#ff7a6a', true);
      this.toast('最深处传来低沉的咆哮……', '#cfc6e0');
    } else {
      this.toast(`第 ${this.run.level} 层`, '#f2c14e', true);
      this.toast('寻找通往下一层的楼梯', '#cfc6e0');
    }

    if (!this.scene.isActive('UI')) this.scene.launch('UI');
    this.scene.bringToTop('UI');
    this.ready = true;
  }

  // ---------------------------------------------------------------- 地图
  private isFloor(tx: number, ty: number) {
    const d = this.dungeon;
    return tx >= 0 && ty >= 0 && tx < d.w && ty < d.h && d.grid[ty * d.w + tx] === 1;
  }

  private buildMap() {
    const d = this.dungeon;
    const bossId = this.isBossLevel ? d.goal.id : -1;
    const data: number[][] = [];
    for (let y = 0; y < d.h; y++) {
      const row: number[] = [];
      for (let x = 0; x < d.w; x++) {
        if (this.isFloor(x, y)) {
          if (d.roomAt[y * d.w + x] === bossId) row.push(TileIdx.BOSS_FLOOR);
          else row.push(Math.random() < 0.14 ? TileIdx.FLOOR_ALT : TileIdx.FLOOR);
        } else {
          let near = false;
          for (let oy = -1; oy <= 1 && !near; oy++)
            for (let ox = -1; ox <= 1; ox++) if (this.isFloor(x + ox, y + oy)) near = true;
          if (!near) row.push(TileIdx.VOID);
          else row.push(this.isFloor(x, y + 1) ? TileIdx.WALL_FACE : TileIdx.WALL_TOP);
        }
      }
      data.push(row);
    }
    if (!this.isBossLevel) {
      data[d.goal.cy][d.goal.cx] = TileIdx.STAIRS;
      this.stairsPos = { x: (d.goal.cx + 0.5) * TILE, y: (d.goal.cy + 0.5) * TILE };
    }
    this.map = this.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
    const ts = this.map.addTilesetImage('tiles', 'tiles', TILE, TILE, 0, 0)!;
    this.ground = this.map.createLayer(0, ts, 0, 0)!;
    this.ground.setCollision(SOLID_TILES).setDepth(-10);
    this.fog = this.map.createBlankLayer('fog', ts)!;
    this.fog.fill(TileIdx.FOG).setDepth(20000);

    if (this.stairsPos) {
      const glow = this.add
        .image(this.stairsPos.x, this.stairsPos.y, 'glow')
        .setTint(0xffe08a)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(-5);
      this.tweens.add({ targets: glow, alpha: 0.4, scale: 0.8, duration: 900, yoyo: true, repeat: -1 });
    }
  }

  private placeDecor() {
    const d = this.dungeon;
    for (const r of d.rooms) {
      // 火把挂在房间上方墙面
      const n = r.kind === 'boss' ? 4 : Phaser.Math.Between(0, 2);
      for (let i = 0; i < n; i++) {
        const tx = r.kind === 'boss' ? r.x + Math.round(((i + 0.5) * r.w) / n) : Phaser.Math.Between(r.x + 1, r.x + r.w - 2);
        const ty = r.y - 1;
        if (this.isFloor(tx, ty)) continue;
        const x = (tx + 0.5) * TILE;
        const y = (ty + 0.5) * TILE;
        const glow = this.add.image(x, y + 6, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(-4);
        if (r.kind === 'boss') glow.setTint(0xff5050);
        this.tweens.add({
          targets: glow,
          alpha: { from: 0.75, to: 1 },
          scale: { from: 0.95, to: 1.08 },
          duration: Phaser.Math.Between(140, 260),
          yoyo: true,
          repeat: -1,
        });
        this.add.sprite(x, y + 2, 'torch').play('torch-burn').setDepth(-3);
      }
      if (Math.random() < 0.5) {
        this.add
          .image(
            (Phaser.Math.Between(r.x, r.x + r.w - 1) + 0.5) * TILE,
            (Phaser.Math.Between(r.y, r.y + r.h - 1) + 0.5) * TILE,
            'bones',
          )
          .setDepth(-6)
          .setFlipX(Math.random() < 0.5);
      }
    }
  }

  private randomTileIn(r: Room, margin = 1) {
    return {
      x: (Phaser.Math.Between(r.x + margin, r.x + r.w - 1 - margin) + 0.5) * TILE,
      y: (Phaser.Math.Between(r.y + margin, r.y + r.h - 1 - margin) + 0.5) * TILE,
    };
  }

  private populate() {
    const lv = this.run.level;
    const d = this.dungeon;
    const weights: [EnemyKind, number][] =
      lv === 1
        ? [
            ['slime', 70],
            ['bat', 30],
          ]
        : lv === 2
          ? [
              ['slime', 45],
              ['bat', 30],
              ['mage', 25],
            ]
          : [
              ['slime', 30],
              ['bat', 35],
              ['mage', 35],
            ];
    const pick = (): EnemyKind => {
      let r = Math.random() * 100;
      for (const [k, w] of weights) if ((r -= w) <= 0) return k;
      return weights[0][0];
    };

    const normalRooms = d.rooms.filter((r) => r.kind !== 'start' && r.kind !== 'boss');
    for (const r of normalRooms) {
      const n = Phaser.Math.Between(1, lv === 1 ? 2 : 3) + (r.kind === 'stairs' ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const p = this.randomTileIn(r);
        this.spawnEnemy(pick(), p.x, p.y);
      }
    }

    // 回血药水
    const potionRooms = Phaser.Utils.Array.Shuffle(normalRooms.slice()).slice(0, 2 + (lv === MAX_LEVEL ? 1 : 0));
    for (const r of potionRooms) {
      const p = this.randomTileIn(r);
      this.spawnPotion(p.x, p.y);
    }

    if (this.isBossLevel) {
      const br = d.goal;
      this.boss = this.spawnEnemy('boss', (br.cx + 0.5) * TILE, (br.cy + 0.5) * TILE);
      this.boss.eState = 'sleep';
      this.boss.anims.timeScale = 0.4;
      // 魔王房门口再放一瓶药水
      this.spawnPotion((br.x + 1.5) * TILE, (br.y + 1.5) * TILE);
    }
  }

  private spawnEnemy(kind: EnemyKind, x: number, y: number) {
    const e = new Enemy(this, x, y, kind);
    this.physics.add.existing(e);
    this.enemies.add(e);
    const [w, h, ox, oy] = e.def.body;
    e.setSize(w, h).setOffset(ox, oy);
    e.setDrag(500, 500);
    if (kind === 'boss') e.setPushable(false);
    return e;
  }

  private spawnPotion(x: number, y: number) {
    const p = this.potions.create(x, y, 'potion') as Phaser.Physics.Arcade.Sprite;
    p.setDepth(y - 2);
    const glow = this.add
      .image(x, y, 'glow')
      .setTint(0xff4060)
      .setScale(0.45)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(-5);
    p.setData('glow', glow);
    this.tweens.add({ targets: p, y: y - 3, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    return p;
  }

  // ---------------------------------------------------------------- 主循环
  update(time: number, delta: number) {
    if (!this.ready) return;
    this.updatePlayer(time);
    this.updateFlowField();
    this.updateEnemies(time, delta);
    this.updateCoins(delta);
    this.checkProgress();
    this.updateFog(false);
    this.syncDepth();
  }

  private syncDepth() {
    const p = this.player;
    p.setDepth(p.y);
    this.playerShadow.setPosition(p.x, p.y + 7).setDepth(p.y - 20);
    this.enemies.children.each((o) => {
      const e = o as Enemy;
      e.setDepth(e.kind === 'bat' ? e.y + 12 : e.y);
      e.shadow.setPosition(e.x, e.y + e.def.shadowDy).setDepth(e.y - 20);
      return true;
    });
  }

  private down(keys: Phaser.Input.Keyboard.Key[]) {
    return keys.some((k) => k.isDown);
  }

  private updatePlayer(time: number) {
    const p = this.player;
    if (this.state !== 'play') {
      if (this.state !== 'dead') p.setVelocity(0, 0);
      p.anims.stop();
      return;
    }
    if (time < this.knockUntil) return;

    const v = new Phaser.Math.Vector2(
      (this.down(this.keys.right) ? 1 : 0) - (this.down(this.keys.left) ? 1 : 0),
      (this.down(this.keys.down) ? 1 : 0) - (this.down(this.keys.up) ? 1 : 0),
    );
    if (v.lengthSq() > 0) {
      v.normalize();
      this.facing.copy(v);
      const speed = PLAYER.speed * (time < this.attackSlowUntil ? 0.45 : 1);
      p.setVelocity(v.x * speed, v.y * speed);
      if (v.x !== 0) p.setFlipX(v.x < 0);
      if (!p.anims.isPlaying) p.play('player-walk');
    } else {
      p.setVelocity(0, 0);
      p.anims.stop();
      p.setFrame(0);
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.attack) && time >= this.nextAttack) this.attack(time);
  }

  private attack(time: number) {
    this.nextAttack = time + PLAYER.attackCooldown;
    this.attackSlowUntil = time + 130;
    const p = this.player;
    const f = this.facing;
    const reach = 13;
    const hx = p.x + f.x * reach;
    const hy = p.y + 2 + f.y * reach;
    const ang = Math.atan2(f.y, f.x);

    const slash = this.add
      .image(p.x + f.x * 4, p.y + 2 + f.y * 4, 'slash')
      .setOrigin(6 / 28, 0.5)
      .setRotation(ang - 0.6)
      .setDepth(15000)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: slash,
      rotation: ang + 0.6,
      alpha: { from: 1, to: 0 },
      scale: { from: 0.85, to: 1.15 },
      duration: 160,
      ease: 'Cubic.out',
      onComplete: () => slash.destroy(),
    });
    sfx.swing();

    let hitAny = false;
    this.enemies.children.each((o) => {
      const e = o as Enemy;
      if (!e.active || e.hp <= 0) return true;
      if (Phaser.Math.Distance.Between(e.x, e.y, hx, hy) <= 11 + e.def.radius) {
        this.damageEnemy(e, PLAYER.damage, e.x - p.x, e.y - p.y, time);
        hitAny = true;
      }
      return true;
    });
    // 挥剑劈碎弹幕
    this.shots.children.each((o) => {
      const s = o as Phaser.Physics.Arcade.Image;
      if (s.active && Phaser.Math.Distance.Between(s.x, s.y, hx, hy) <= 16) {
        this.popShot(s);
        sfx.parry();
      }
      return true;
    });
    if (hitAny) this.cameras.main.shake(70, 0.004);
  }

  // ---------------------------------------------------------------- 战斗
  private damageEnemy(e: Enemy, dmg: number, dx: number, dy: number, time: number) {
    e.hp -= dmg;
    sfx.hit();
    e.setTintFill(0xffffff);
    this.time.delayedCall(80, () => {
      if (e.active) e.clearTint();
    });
    this.floatText(e.x, e.y - 10 * e.def.scale, `${dmg}`, '#ffffff');
    this.burst(e.x, e.y, e.def.color, 6);

    const dir = new Phaser.Math.Vector2(dx, dy).normalize();
    if (e.kind === 'boss') {
      if (e.eState === 'sleep') this.activateBoss();
    } else {
      e.setVelocity(dir.x * 230, dir.y * 230);
      e.eState = 'stun';
      e.stateUntil = time + 220;
      e.setScale(1);
      e.nextAttack = Math.max(e.nextAttack, time + 450);
    }
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy) {
    const { x, y } = e;
    this.burst(x, y, e.def.color, e.kind === 'boss' ? 60 : 16, e.kind === 'boss' ? 160 : 90);
    this.burst(x, y, 0xffffff, e.kind === 'boss' ? 20 : 5);
    sfx.die();
    this.run.kills++;
    const coinCount =
      e.kind === 'boss' ? 25 : e.kind === 'mage' ? Phaser.Math.Between(2, 3) : e.kind === 'slime' ? Phaser.Math.Between(1, 2) : 1;
    if (!e.minion || Math.random() < 0.5) for (let i = 0; i < coinCount; i++) this.spawnCoin(x, y);
    if (e.kind !== 'boss' && !e.minion && Math.random() < 0.1) this.spawnPotion(x, y);
    e.shadow.destroy();
    e.destroy();
    if (e.kind === 'boss') this.win();
  }

  private onEnemyContact(e: Enemy) {
    if (!e.active || e.eState === 'stun' || e.eState === 'sleep' || e.hp <= 0) return;
    const full = e.eState === 'lunge' || e.kind === 'boss';
    this.hurtPlayer(full ? e.def.dmg : Math.ceil(e.def.dmg * 0.6), e.x, e.y);
  }

  private hurtPlayer(dmg: number, sx: number, sy: number) {
    const time = this.time.now;
    if (this.state !== 'play' || time < this.invulnUntil) return;
    const p = this.player;
    this.run.hp = Math.max(0, this.run.hp - dmg);
    this.invulnUntil = time + PLAYER.invuln;
    this.knockUntil = time + 140;
    this.hurtFlashAt = time;
    const dir = new Phaser.Math.Vector2(p.x - sx, p.y - sy).normalize();
    p.setVelocity(dir.x * 200, dir.y * 200);
    p.setTintFill(0xff3040);
    this.time.delayedCall(90, () => p.clearTint());
    this.tweens.add({ targets: p, alpha: 0.3, duration: 80, yoyo: true, repeat: 4, onComplete: () => p.setAlpha(1) });
    this.cameras.main.shake(140, 0.008);
    this.floatText(p.x, p.y - 12, `-${dmg}`, '#ff5a6a');
    this.burst(p.x, p.y, 0xff3040, 8);
    sfx.hurt();
    if (this.run.hp <= 0) this.die();
  }

  private fireShot(x: number, y: number, angle: number, speed: number, tex: 'bolt' | 'bossbolt', dmg: number) {
    const s = this.shots.create(x, y, tex) as Phaser.Physics.Arcade.Image;
    s.setDepth(14000).setBlendMode(Phaser.BlendModes.ADD);
    s.setCircle(tex === 'bolt' ? 3 : 3.5, tex === 'bolt' ? 1 : 1.5, tex === 'bolt' ? 1 : 1.5);
    s.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    s.setData('dmg', dmg);
    this.tweens.add({ targets: s, angle: 360, duration: 600, repeat: -1 });
    this.time.delayedCall(4000, () => {
      if (s.active) s.destroy();
    });
  }

  private popShot(s: Phaser.Physics.Arcade.Image) {
    if (!s.active) return;
    this.burst(s.x, s.y, s.texture.key === 'bolt' ? 0xc46bff : 0xff9a3c, 5, 50);
    s.destroy();
  }

  // ---------------------------------------------------------------- 敌人 AI
  private lineOfSight(x1: number, y1: number, x2: number, y2: number) {
    const dist = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    const steps = Math.ceil(dist / 6);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (!this.isFloor(Math.floor((x1 + (x2 - x1) * t) / TILE), Math.floor((y1 + (y2 - y1) * t) / TILE))) return false;
    }
    return true;
  }

  private tileIndex(x: number, y: number) {
    return Math.floor(y / TILE) * this.dungeon.w + Math.floor(x / TILE);
  }

  private updateFlowField() {
    const d = this.dungeon;
    const pt = this.tileIndex(this.player.x, this.player.y + 4);
    if (pt === this.flowTile || d.grid[pt] !== 1) return;
    this.flowTile = pt;
    const f = this.flow.fill(-1);
    const q = [pt];
    f[pt] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      if (f[c] > 45) continue;
      const cx = c % d.w;
      const cy = (c / d.w) | 0;
      for (const [ox, oy] of DIRS4) {
        const nx = cx + ox;
        const ny = cy + oy;
        if (!this.isFloor(nx, ny)) continue;
        const n = ny * d.w + nx;
        if (f[n] < 0) {
          f[n] = f[c] + 1;
          q.push(n);
        }
      }
    }
  }

  /** 朝玩家移动：视线可达则直线追击，否则沿流场寻路。返回 false 表示失去目标。 */
  private moveToward(e: Enemy, speed: number, wobble = 0, time = 0) {
    const p = this.player;
    let dx: number;
    let dy: number;
    if (e.hasLos) {
      dx = p.x - e.x;
      dy = p.y - e.y;
    } else {
      const d = this.dungeon;
      const ti = this.tileIndex(e.x, e.y + 3);
      const cur = this.flow[ti];
      if (cur < 0) return false;
      const cx = ti % d.w;
      const cy = (ti / d.w) | 0;
      let best = cur;
      let bx = cx;
      let by = cy;
      for (const [ox, oy] of DIRS4) {
        const n = (cy + oy) * d.w + cx + ox;
        if (this.flow[n] >= 0 && this.flow[n] < best) {
          best = this.flow[n];
          bx = cx + ox;
          by = cy + oy;
        }
      }
      dx = (bx + 0.5) * TILE - e.x;
      dy = (by + 0.5) * TILE - (e.y + 3);
    }
    const v = new Phaser.Math.Vector2(dx, dy);
    if (v.lengthSq() < 0.01) return true;
    v.normalize();
    if (wobble) {
      const w = Math.sin(time * 0.008 + e.seed) * wobble;
      v.set(v.x - v.y * w, v.y + v.x * w).normalize();
    }
    e.setVelocity(v.x * speed, v.y * speed);
    if (Math.abs(v.x) > 0.1) e.setFlipX(v.x < 0);
    return true;
  }

  private updateEnemies(time: number, delta: number) {
    const p = this.player;
    const playing = this.state === 'play';
    this.enemies.children.each((o) => {
      const e = o as Enemy;
      if (!e.active) return true;
      const dist = Phaser.Math.Distance.Between(e.x, e.y, p.x, p.y);
      if (time >= e.losAt) {
        e.hasLos = dist < 260 && this.lineOfSight(e.x, e.y, p.x, p.y);
        e.losAt = time + 120 + Math.random() * 80;
      }
      if (!playing && e.eState !== 'sleep') {
        e.eState = 'idle';
      }
      if (e.kind === 'boss') {
        this.updateBoss(e, time, dist);
        return true;
      }

      switch (e.eState) {
        case 'idle': {
          if (time >= e.wanderUntil) {
            e.wanderUntil = time + Phaser.Math.Between(700, 1800);
            if (Math.random() < 0.45) e.wander.set(0, 0);
            else e.wander.setToPolar(Math.random() * Math.PI * 2, e.def.speed * 0.4);
          }
          e.setVelocity(e.wander.x, e.wander.y);
          if (playing && dist < e.def.aggro && e.hasLos) this.alert(e, time);
          break;
        }
        case 'stun':
          if (time >= e.stateUntil) e.eState = 'chase';
          break;
        case 'chase':
          this.chase(e, time, dist);
          break;
        case 'windup':
          e.setVelocity(0, 0);
          if (time >= e.stateUntil) this.release(e, time);
          break;
        case 'lunge':
          if (time >= e.stateUntil) {
            e.eState = 'recover';
            e.stateUntil = time + 380;
          }
          break;
        case 'recover': {
          const k = Math.pow(0.02, delta / 1000);
          e.setVelocity(e.body!.velocity.x * k, e.body!.velocity.y * k);
          if (time >= e.stateUntil) e.eState = 'chase';
          break;
        }
      }
      return true;
    });
  }

  private alert(e: Enemy, time: number) {
    e.eState = 'chase';
    e.nextAttack = Math.max(e.nextAttack, time + 400);
    const t = this.add
      .text(e.x, e.y - 14, '!', { fontFamily: FONT, fontSize: '12px', color: '#ffd23f', stroke: '#000', strokeThickness: 3, resolution: ZOOM })
      .setOrigin(0.5)
      .setDepth(16000);
    this.tweens.add({ targets: t, y: t.y - 6, alpha: 0, duration: 600, delay: 200, onComplete: () => t.destroy() });
  }

  private chase(e: Enemy, time: number, dist: number) {
    const p = this.player;
    if (!e.hasLos && (this.flow[this.tileIndex(e.x, e.y + 3)] < 0 || dist > 400)) {
      e.eState = 'idle';
      return;
    }
    const ready = time >= e.nextAttack && e.hasLos;
    switch (e.kind) {
      case 'slime':
        this.moveToward(e, e.def.speed);
        if (ready && dist < 42) this.windup(e, time, 420, 0xff8080);
        break;
      case 'bat':
        this.moveToward(e, e.def.speed, 0.9, time);
        if (ready && dist < 56) this.windup(e, time, 260, 0xff8080);
        break;
      case 'mage': {
        if (e.hasLos) {
          if (dist < 70) {
            const v = new Phaser.Math.Vector2(e.x - p.x, e.y - p.y).normalize().scale(e.def.speed);
            e.setVelocity(v.x, v.y);
          } else if (dist > 125) this.moveToward(e, e.def.speed);
          else {
            const v = new Phaser.Math.Vector2(-(p.y - e.y), p.x - e.x).normalize().scale(e.def.speed * 0.5 * Math.sin(e.seed + time * 0.001));
            e.setVelocity(v.x, v.y);
          }
          e.setFlipX(p.x < e.x);
        } else this.moveToward(e, e.def.speed);
        if (ready && dist < 180) this.windup(e, time, 560, 0xe0a0ff);
        break;
      }
    }
  }

  private windup(e: Enemy, time: number, ms: number, tint: number) {
    e.eState = 'windup';
    e.stateUntil = time + ms;
    e.setVelocity(0, 0);
    e.setTint(tint);
    const s = e.def.scale;
    this.tweens.add({ targets: e, scaleX: s * 1.2, scaleY: s * 0.85, duration: ms * 0.8, yoyo: false, onComplete: () => e.active && e.setScale(s) });
  }

  private release(e: Enemy, time: number) {
    const p = this.player;
    e.clearTint();
    e.setScale(e.def.scale);
    const ang = Phaser.Math.Angle.Between(e.x, e.y, p.x, p.y);
    if (e.kind === 'mage') {
      this.fireShot(e.x, e.y - 2, ang, 115, 'bolt', e.def.dmg);
      sfx.shoot();
      e.nextAttack = time + 1900;
      e.eState = 'chase';
      return;
    }
    const sp = e.kind === 'bat' ? 240 : 225;
    e.lungeDir.setToPolar(ang, 1);
    e.setVelocity(e.lungeDir.x * sp, e.lungeDir.y * sp);
    e.eState = 'lunge';
    e.stateUntil = time + 230;
    e.nextAttack = time + (e.kind === 'bat' ? 1100 : 1400);
  }

  // ---------------------------------------------------------------- Boss
  private activateBoss() {
    if (!this.boss || this.bossActive) return;
    this.bossActive = true;
    const b = this.boss;
    b.eState = 'chase';
    b.anims.timeScale = 1;
    b.nextAttack = this.time.now + 1200;
    this.cameras.main.shake(500, 0.012);
    this.toast('暗影魔王 苏醒了！', '#ff5a4a', true);
    sfx.boss();
    this.burst(b.x, b.y, 0xff3040, 40, 140);
  }

  private updateBoss(b: Enemy, time: number, dist: number) {
    if (b.eState === 'sleep' || !this.bossActive) {
      b.setVelocity(0, 0);
      return;
    }
    if (this.state !== 'play') {
      b.setVelocity(0, 0);
      return;
    }
    if (b.phase === 1 && b.hp <= b.maxHp / 2) {
      b.phase = 2;
      this.toast('暗影魔王 狂暴了！', '#ff5a4a', true);
      this.cameras.main.shake(400, 0.01);
      sfx.boss();
      this.ringShots(b, 20, 0);
      b.anims.timeScale = 1.8;
    }
    const p2 = b.phase === 2;
    const speed = b.def.speed * (p2 ? 1.4 : 1);

    switch (b.eState) {
      case 'idle':
      case 'stun':
        b.eState = 'chase';
        break;
      case 'chase': {
        this.moveToward(b, speed);
        if (time >= b.nextAttack) {
          const minions = this.enemies.getChildren().filter((o) => (o as Enemy).minion && o.active).length;
          const opts: BossMove[] = ['burst', 'burst'];
          if (b.hasLos && dist > 30) opts.push('charge', 'charge');
          if (minions < (p2 ? 4 : 2)) opts.push('summon');
          b.bossMove = Phaser.Utils.Array.GetRandom(opts);
          const tint = b.bossMove === 'burst' ? 0xffaa55 : b.bossMove === 'charge' ? 0xff4040 : 0xaa77ff;
          b.eState = 'windup';
          b.stateUntil = time + (b.bossMove === 'charge' ? 650 : 600) * (p2 ? 0.8 : 1);
          b.setVelocity(0, 0);
          b.setTint(tint);
          this.tweens.add({ targets: b, scaleX: 2.3, scaleY: 1.8, duration: 200, yoyo: true, repeat: 1, onComplete: () => b.active && b.setScale(2) });
        }
        break;
      }
      case 'windup':
        b.setVelocity(0, 0);
        if (time >= b.stateUntil) {
          b.clearTint();
          b.setScale(2);
          const move = b.bossMove;
          if (move === 'burst') {
            this.ringShots(b, p2 ? 16 : 12, Math.random());
            if (p2) this.time.delayedCall(280, () => b.active && this.ringShots(b, 16, Math.random()));
            b.eState = 'recover';
            b.stateUntil = time + 500;
          } else if (move === 'charge') {
            const ang = Phaser.Math.Angle.Between(b.x, b.y, this.player.x, this.player.y);
            b.lungeDir.setToPolar(ang, 1);
            const sp = p2 ? 290 : 250;
            b.setVelocity(b.lungeDir.x * sp, b.lungeDir.y * sp);
            b.eState = 'lunge';
            b.stateUntil = time + 520;
            sfx.swing();
          } else {
            for (let i = 0; i < 2; i++) {
              const a = Math.random() * Math.PI * 2;
              const x = b.x + Math.cos(a) * 26;
              const y = b.y + Math.sin(a) * 26;
              if (!this.isFloor(Math.floor(x / TILE), Math.floor(y / TILE))) continue;
              const m = this.spawnEnemy('bat', x, y);
              m.minion = true;
              m.eState = 'chase';
              m.nextAttack = time + 800;
              this.burst(x, y, 0xaa77ff, 12);
            }
            sfx.shoot();
            b.eState = 'recover';
            b.stateUntil = time + 500;
          }
          b.nextAttack = time + (p2 ? 1500 : 2300);
        }
        break;
      case 'lunge':
        this.burst(b.x, b.y + 10, 0xff5040, 1, 30);
        if (time >= b.stateUntil || (b.body as Phaser.Physics.Arcade.Body).blocked.none === false) {
          if (!(b.body as Phaser.Physics.Arcade.Body).blocked.none) this.cameras.main.shake(150, 0.006);
          b.eState = 'recover';
          b.stateUntil = time + 600;
          b.setVelocity(0, 0);
        }
        break;
      case 'recover':
        b.setVelocity(0, 0);
        if (time >= b.stateUntil) b.eState = 'chase';
        break;
    }
  }

  private ringShots(b: Enemy, n: number, offset: number) {
    for (let i = 0; i < n; i++) {
      const a = ((i + offset) / n) * Math.PI * 2;
      this.fireShot(b.x, b.y, a, 85, 'bossbolt', 12);
    }
    sfx.shoot();
  }

  // ---------------------------------------------------------------- 物品
  private spawnCoin(x: number, y: number) {
    const c = this.coins.create(x, y, 'coin') as Phaser.Physics.Arcade.Sprite;
    c.play('coin-spin');
    c.anims.setProgress(Math.random());
    c.setDepth(y - 4);
    c.setData('readyAt', this.time.now + 350);
    const spread = this.boss && x === this.boss.x ? 30 : 14;
    let tx = x + Phaser.Math.Between(-spread, spread);
    let ty = y + Phaser.Math.Between(-spread, spread);
    if (!this.isFloor(Math.floor(tx / TILE), Math.floor(ty / TILE))) {
      tx = x;
      ty = y;
    }
    this.tweens.add({ targets: c, x: tx, duration: 350, ease: 'Quad.out' });
    this.tweens.add({ targets: c, y: { from: y, to: ty }, duration: 350, ease: 'Bounce.out' });
  }

  private updateCoins(delta: number) {
    const p = this.player;
    if (this.state === 'dead') return;
    this.coins.children.each((o) => {
      const c = o as Phaser.Physics.Arcade.Sprite;
      if (this.time.now < (c.getData('readyAt') as number)) return true;
      const d = Phaser.Math.Distance.Between(c.x, c.y, p.x, p.y);
      if (d < 44) {
        this.tweens.killTweensOf(c);
        const step = Math.min(d, (220 * delta) / 1000);
        const a = Phaser.Math.Angle.Between(c.x, c.y, p.x, p.y);
        c.setPosition(c.x + Math.cos(a) * step, c.y + Math.sin(a) * step);
      }
      return true;
    });
  }

  private pickCoin(c: Phaser.Physics.Arcade.Sprite) {
    if (!c.active || this.time.now < (c.getData('readyAt') as number) || this.state === 'dead') return;
    this.run.coins++;
    this.burst(c.x, c.y, 0xf2c14e, 4, 40);
    sfx.coin();
    c.destroy();
  }

  private pickPotion(pt: Phaser.Physics.Arcade.Sprite) {
    if (!pt.active || this.state !== 'play') return;
    if (this.run.hp >= this.run.maxHp) {
      if (this.time.now > this.potionFullHintAt) {
        this.potionFullHintAt = this.time.now + 3000;
        this.toast('生命已满，药水先留着吧', '#9a8fb3');
      }
      return;
    }
    const heal = Math.min(PLAYER.potionHeal, this.run.maxHp - this.run.hp);
    this.run.hp += heal;
    this.floatText(pt.x, pt.y - 10, `+${heal}`, '#6aff8a');
    this.burst(pt.x, pt.y, 0x6aff8a, 14, 60);
    sfx.potion();
    (pt.getData('glow') as Phaser.GameObjects.Image | undefined)?.destroy();
    this.tweens.killTweensOf(pt);
    pt.destroy();
  }

  // ---------------------------------------------------------------- 进度
  private checkProgress() {
    if (this.state !== 'play') return;
    const p = this.player;
    const d = this.dungeon;
    const ti = this.tileIndex(p.x, p.y + 4);
    const room = d.roomAt[ti];
    if (room !== this.lastRoom) {
      this.lastRoom = room;
      if (room >= 0 && !this.visitedRooms.has(room)) {
        this.visitedRooms.add(room);
        const r = d.rooms[room];
        if (r.kind === 'stairs') this.toast('发现了通往下层的楼梯！', '#f2c14e');
      }
      if (this.isBossLevel && room === d.goal.id) this.activateBoss();
    }
    if (this.stairsPos && Phaser.Math.Distance.Between(p.x, p.y + 4, this.stairsPos.x, this.stairsPos.y) < 7) {
      this.descend();
    }
  }

  private descend() {
    this.state = 'transition';
    this.player.setVelocity(0, 0);
    sfx.stairs();
    const bonus = Math.min(20, this.run.maxHp - this.run.hp);
    this.tweens.add({ targets: this.player, scale: 0.2, alpha: 0, angle: 180, duration: 450 });
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ ...this.run, level: this.run.level + 1, hp: this.run.hp + bonus });
    });
  }

  private die() {
    this.state = 'dead';
    this.endTime = Date.now();
    const p = this.player;
    p.setVelocity(0, 0);
    p.anims.stop();
    sfx.lose();
    this.tweens.killTweensOf(p);
    p.setAlpha(1).setTint(0x666677);
    this.tweens.add({ targets: p, angle: 90, duration: 400, ease: 'Bounce.out' });
    this.cameras.main.shake(300, 0.01);
    this.time.delayedCall(900, () => (this.result = 'lose'));
  }

  private win() {
    this.state = 'won';
    this.endTime = Date.now();
    this.player.setVelocity(0, 0);
    this.cameras.main.flash(500, 255, 240, 200);
    this.cameras.main.shake(600, 0.012);
    sfx.win();
    // 残余怪物随魔王一同消散
    this.enemies.children.each((o) => {
      const e = o as Enemy;
      if (e.active) {
        this.burst(e.x, e.y, e.def.color, 10);
        e.shadow.destroy();
        e.destroy();
      }
      return true;
    });
    this.shots.clear(true, true);
    this.toast('暗影魔王 被击败了！', '#f2c14e', true);
    this.time.delayedCall(1800, () => (this.result = 'win'));
  }

  restartRun() {
    this.scene.restart({ level: 1 });
  }

  // ---------------------------------------------------------------- 迷雾
  private updateFog(force: boolean) {
    const p = this.player;
    const d = this.dungeon;
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor((p.y + 4) / TILE);
    const ti = ty * d.w + tx;
    if (!force && ti === this.lastPlayerTile) return;
    this.lastPlayerTile = ti;

    const R = 5;
    for (let oy = -R - 1; oy <= R + 1; oy++)
      for (let ox = -R - 1; ox <= R + 1; ox++) {
        const x = tx + ox;
        const y = ty + oy;
        if (x < 0 || y < 0 || x >= d.w || y >= d.h) continue;
        const dd = Math.sqrt(ox * ox + oy * oy);
        if (dd <= R) this.clearFog(x, y);
        else if (dd <= R + 1.2) {
          const t = this.fog.getTileAt(x, y);
          if (t && t.index === TileIdx.FOG) this.fog.putTileAt(TileIdx.FOG_HALF, x, y);
        }
      }
    // 进入房间时点亮整个房间
    const room = d.roomAt[ti];
    if (room >= 0) {
      const r = d.rooms[room];
      for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) this.clearFog(x, y);
    }
  }

  private clearFog(x: number, y: number) {
    const d = this.dungeon;
    if (x < 0 || y < 0 || x >= d.w || y >= d.h) return;
    const i = y * d.w + x;
    if (this.explored[i]) return;
    this.explored[i] = 1;
    this.fog.removeTileAt(x, y);
  }

  // ---------------------------------------------------------------- 特效
  private burst(x: number, y: number, color: number, count: number, speed = 70) {
    const key = `${color}-${speed}`;
    let em = this.emitters.get(key);
    if (!em) {
      em = this.add.particles(0, 0, 'px', {
        speed: { min: speed * 0.3, max: speed },
        lifespan: { min: 250, max: 550 },
        scale: { start: 1, end: 0 },
        alpha: { start: 1, end: 0.2 },
        tint: color,
        emitting: false,
      });
      em.setDepth(15500);
      this.emitters.set(key, em);
    }
    em.explode(count, x, y);
  }

  private floatText(x: number, y: number, text: string, color: string) {
    const t = this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: '9px', color, stroke: '#000000', strokeThickness: 2, resolution: ZOOM })
      .setOrigin(0.5)
      .setDepth(16000);
    this.tweens.add({ targets: t, y: y - 14, alpha: 0, duration: 650, ease: 'Cubic.out', onComplete: () => t.destroy() });
  }

  toast(text: string, color = '#ffffff', big = false) {
    this.toasts.push({ text, color, big });
  }
}
