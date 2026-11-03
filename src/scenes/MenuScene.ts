import Phaser from 'phaser';
import { FONT, GAME_W, GAME_H, MAX_LEVEL } from '../constants';
import { sfx } from '../sfx';

export class MenuScene extends Phaser.Scene {
  private starting = false;

  constructor() {
    super('Menu');
  }

  create() {
    this.starting = false;
    const cx = GAME_W / 2;

    // 背景：漂浮的余烬粒子
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x0b0910).setOrigin(0);
    for (let i = 0; i < 40; i++) {
      const p = this.add
        .image(Phaser.Math.Between(0, GAME_W), Phaser.Math.Between(0, GAME_H), 'px')
        .setTint(Phaser.Utils.Array.GetRandom([0xff6a2a, 0xffb347, 0x9a6bff]))
        .setAlpha(Phaser.Math.FloatBetween(0.2, 0.8))
        .setScale(Phaser.Math.Between(1, 2));
      this.tweens.add({
        targets: p,
        y: p.y - Phaser.Math.Between(80, 240),
        alpha: 0,
        duration: Phaser.Math.Between(3000, 7000),
        repeat: -1,
        delay: Phaser.Math.Between(0, 3000),
        onRepeat: () => {
          p.setPosition(Phaser.Math.Between(0, GAME_W), GAME_H + 10).setAlpha(Phaser.Math.FloatBetween(0.2, 0.8));
        },
      });
    }

    // 两侧火把
    for (const x of [150, GAME_W - 150]) {
      this.add.image(x, 120, 'glow').setScale(5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.7);
      this.add.sprite(x, 120, 'torch').setScale(5).play('torch-burn');
    }

    const title = this.add
      .text(cx, 100, '暗影地牢', {
        fontFamily: FONT,
        fontSize: '72px',
        color: '#f2c14e',
        stroke: '#3a1a08',
        strokeThickness: 10,
      })
      .setOrigin(0.5);
    title.setShadow(0, 6, '#000000', 0, true, true);
    this.tweens.add({ targets: title, y: 108, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

    this.add
      .text(cx, 170, `深入 ${MAX_LEVEL} 层随机地牢，击败最深处的暗影魔王`, {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#b8a9d9',
      })
      .setOrigin(0.5);

    // 操作说明面板
    const panelY = 340;
    this.add.rectangle(cx, panelY, 620, 230, 0x15111d, 0.92).setStrokeStyle(3, 0x4c405e);
    this.add
      .text(cx, panelY - 92, '— 操作说明 —', { fontFamily: FONT, fontSize: '22px', color: '#f2c14e' })
      .setOrigin(0.5);
    const lines: [string, string][] = [
      ['WASD / 方向键', '移动'],
      ['空格', '挥剑攻击（可劈碎敌方弹幕）'],
      ['P / Esc', '暂停'],
      ['M', '静音 / 取消静音'],
    ];
    lines.forEach(([k, v], i) => {
      const y = panelY - 50 + i * 34;
      this.add.text(cx - 40, y, k, { fontFamily: FONT, fontSize: '20px', color: '#6fe3ff' }).setOrigin(1, 0.5);
      this.add.text(cx - 10, y, v, { fontFamily: FONT, fontSize: '20px', color: '#e8e2f0' }).setOrigin(0, 0.5);
    });
    this.add
      .text(cx, panelY + 92, '踩上楼梯进入下一层 · 击败敌人掉落金币 · 红色药水回复生命', {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#9a8fb3',
      })
      .setOrigin(0.5);

    // 怪物图鉴
    const roster: [string, string, number][] = [
      ['player', '你', 3],
      ['slime', '史莱姆', 3],
      ['bat', '蝙蝠', 3],
      ['mage', '骷髅法师', 3],
      ['boss', '暗影魔王', 4],
    ];
    roster.forEach(([tex, name, sc], i) => {
      const x = cx - 280 + i * 140;
      const s = this.add.sprite(x, 520, tex).setScale(sc);
      if (tex !== 'player') s.play(`${tex}-move`);
      else s.play('player-walk');
      this.add
        .text(x, 566, name, { fontFamily: FONT, fontSize: '16px', color: tex === 'boss' ? '#ff6a5a' : '#cfc6e0' })
        .setOrigin(0.5);
    });

    const start = this.add
      .text(cx, 612, '▶ 按 回车 / 空格 或点击 开始冒险', {
        fontFamily: FONT,
        fontSize: '22px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5);
    this.tweens.add({ targets: start, alpha: 0.35, duration: 650, yoyo: true, repeat: -1 });

    const go = () => this.startGame();
    this.input.keyboard!.on('keydown-ENTER', go);
    this.input.keyboard!.on('keydown-SPACE', go);
    this.input.on('pointerdown', go);
  }

  private startGame() {
    if (this.starting) return;
    this.starting = true;
    sfx.unlock();
    sfx.select();
    this.cameras.main.fadeOut(350, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('Game', { level: 1 });
    });
  }
}
