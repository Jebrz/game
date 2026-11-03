import Phaser from 'phaser';
import { FONT, GAME_W, GAME_H, MAX_LEVEL } from '../constants';
import type { GameScene } from './GameScene';
import { sfx } from '../sfx';

const MM_SCALE = 3;

/** HUD：生命、金币、关卡、小地图、Boss 血条、提示信息与暂停/结算界面。 */
export class UIScene extends Phaser.Scene {
  private hpBar!: Phaser.GameObjects.Graphics;
  private hpText!: Phaser.GameObjects.Text;
  private coinText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private goalText!: Phaser.GameObjects.Text;
  private minimap!: Phaser.GameObjects.Graphics;
  private mmFrame!: Phaser.GameObjects.Rectangle;
  private bossBar!: Phaser.GameObjects.Graphics;
  private bossName!: Phaser.GameObjects.Text;
  private hurt!: Phaser.GameObjects.Image;
  private muteText!: Phaser.GameObjects.Text;
  private overlay!: Phaser.GameObjects.Container;
  private overlayKind: 'none' | 'pause' | 'win' | 'lose' = 'none';
  private toastY = 0;
  private mmNext = 0;
  private shownHp = -1;

  constructor() {
    super('UI');
  }

  private get gs() {
    return this.scene.get('Game') as GameScene;
  }

  create() {
    this.overlayKind = 'none';
    this.add.image(0, 0, 'vignette').setOrigin(0);
    this.hurt = this.add.image(0, 0, 'hurtvignette').setOrigin(0).setAlpha(0);

    // 左上：生命与金币
    this.add.rectangle(16, 16, 300, 84, 0x0d0a13, 0.78).setOrigin(0).setStrokeStyle(2, 0x3b3149);
    this.add.image(36, 40, 'heart').setScale(3);
    this.hpBar = this.add.graphics();
    this.hpText = this.add
      .text(176, 40, '', { fontFamily: FONT, fontSize: '16px', color: '#ffffff', stroke: '#000', strokeThickness: 3 })
      .setOrigin(0.5);
    this.add.sprite(36, 76, 'coin').setScale(3).play('coin-spin');
    this.coinText = this.add.text(58, 76, '', { fontFamily: FONT, fontSize: '20px', color: '#f2c14e', stroke: '#000', strokeThickness: 3 }).setOrigin(0, 0.5);

    // 顶部中间：关卡
    this.levelText = this.add
      .text(GAME_W / 2, 26, '', { fontFamily: FONT, fontSize: '24px', color: '#f2c14e', stroke: '#000', strokeThickness: 4 })
      .setOrigin(0.5);
    this.goalText = this.add
      .text(GAME_W / 2, 56, '', { fontFamily: FONT, fontSize: '15px', color: '#cfc6e0', stroke: '#000', strokeThickness: 3 })
      .setOrigin(0.5);

    // 右上：小地图
    this.mmFrame = this.add.rectangle(GAME_W - 16, 16, 10, 10, 0x0d0a13, 0.78).setOrigin(1, 0).setStrokeStyle(2, 0x3b3149);
    this.minimap = this.add.graphics();

    // 底部：Boss 血条
    this.bossBar = this.add.graphics();
    this.bossName = this.add
      .text(GAME_W / 2, GAME_H - 74, '暗影魔王', { fontFamily: FONT, fontSize: '18px', color: '#ff7a6a', stroke: '#000', strokeThickness: 4 })
      .setOrigin(0.5)
      .setVisible(false);

    // 底部提示
    this.add
      .text(16, GAME_H - 14, 'WASD/方向键 移动 · 空格 攻击 · P 暂停 · M 静音', {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#8a7fa3',
        stroke: '#000',
        strokeThickness: 3,
      })
      .setOrigin(0, 1);
    this.muteText = this.add
      .text(GAME_W - 16, GAME_H - 14, '', { fontFamily: FONT, fontSize: '14px', color: '#8a7fa3', stroke: '#000', strokeThickness: 3 })
      .setOrigin(1, 1);

    this.overlay = this.add.container(0, 0).setDepth(100).setVisible(false);

    const kb = this.input.keyboard!;
    kb.on('keydown-P', () => this.togglePause());
    kb.on('keydown-ESC', () => {
      if (this.overlayKind === 'win' || this.overlayKind === 'lose') this.toMenu();
      else this.togglePause();
    });
    kb.on('keydown-Q', () => {
      if (this.overlayKind === 'pause') this.toMenu();
    });
    kb.on('keydown-M', () => {
      sfx.toggleMute();
    });
    const restart = () => {
      if (this.overlayKind === 'win' || this.overlayKind === 'lose') this.restartRun();
    };
    kb.on('keydown-R', restart);
    kb.on('keydown-ENTER', restart);
  }

  update(time: number) {
    const gs = this.gs;
    if (!gs || !gs.ready || !gs.run) return;
    const run = gs.run;

    // 生命条（平滑过渡）
    if (this.shownHp < 0) this.shownHp = run.hp;
    this.shownHp += (run.hp - this.shownHp) * 0.15;
    if (Math.abs(this.shownHp - run.hp) < 0.3) this.shownHp = run.hp;
    const bw = 236;
    const ratio = Phaser.Math.Clamp(this.shownHp / run.maxHp, 0, 1);
    const g = this.hpBar.clear();
    g.fillStyle(0x000000, 1).fillRect(56, 28, bw + 4, 24);
    g.fillStyle(0x3a1018, 1).fillRect(58, 30, bw, 20);
    const col = ratio > 0.5 ? 0xd63a4a : ratio > 0.25 ? 0xe07a2a : 0xff2a2a;
    g.fillStyle(col, 1).fillRect(58, 30, bw * ratio, 20);
    g.fillStyle(0xffffff, 0.25).fillRect(58, 30, bw * ratio, 5);
    this.hpText.setText(`生命 ${run.hp} / ${run.maxHp}`);
    this.coinText.setText(`金币 ${run.coins}`);

    this.levelText.setText(gs.isBossLevel ? `第 ${run.level} / ${MAX_LEVEL} 层 · 魔王巢穴` : `第 ${run.level} / ${MAX_LEVEL} 层`);
    this.levelText.setColor(gs.isBossLevel ? '#ff7a6a' : '#f2c14e');
    this.goalText.setText(gs.isBossLevel ? '目标：击败暗影魔王' : '目标：找到通往下一层的楼梯');
    this.muteText.setText(sfx.muted ? '🔇 已静音' : '');

    // 受伤红屏
    const since = gs.time.now - gs.hurtFlashAt;
    const low = run.hp / run.maxHp < 0.25 && gs.state === 'play' ? 0.25 + 0.15 * Math.sin(time * 0.008) : 0;
    this.hurt.setAlpha(Math.max(since < 400 ? 0.65 * (1 - since / 400) : 0, low));

    // Boss 血条
    const boss = gs.boss;
    this.bossBar.clear();
    if (boss && gs.bossActive && boss.active) {
      this.bossName.setVisible(true);
      const w = 420;
      const x = (GAME_W - w) / 2;
      const y = GAME_H - 60;
      const r = Phaser.Math.Clamp(boss.hp / boss.maxHp, 0, 1);
      this.bossBar.fillStyle(0x000000, 0.9).fillRect(x - 3, y - 3, w + 6, 20);
      this.bossBar.fillStyle(0x2a0a10, 1).fillRect(x, y, w, 14);
      this.bossBar.fillStyle(boss.phase === 2 ? 0xff3a2a : 0xb02a3a, 1).fillRect(x, y, w * r, 14);
      this.bossBar.fillStyle(0xffffff, 0.2).fillRect(x, y, w * r, 4);
    } else this.bossName.setVisible(false);

    if (time >= this.mmNext) {
      this.mmNext = time + 150;
      this.drawMinimap();
    }

    // 浮动提示
    while (gs.toasts.length) this.showToast(gs.toasts.shift()!);

    // 结算界面
    if (gs.result && this.overlayKind !== gs.result) this.showResult(gs.result);
    if (!gs.result && (this.overlayKind === 'win' || this.overlayKind === 'lose')) this.hideOverlay();
  }

  private drawMinimap() {
    const gs = this.gs;
    const d = gs.dungeon;
    const s = MM_SCALE;
    const w = d.w * s;
    const h = d.h * s;
    const x0 = GAME_W - 24 - w;
    const y0 = 24;
    this.mmFrame.setSize(w + 16, h + 16);
    const g = this.minimap.clear();
    const bossId = gs.isBossLevel ? d.goal.id : -2;
    for (let y = 0; y < d.h; y++)
      for (let x = 0; x < d.w; x++) {
        const i = y * d.w + x;
        if (!gs.explored[i]) continue;
        if (d.grid[i]) g.fillStyle(d.roomAt[i] === bossId ? 0x7a2a3a : 0x5a4f6e, 1);
        else g.fillStyle(0x221c2b, 1);
        g.fillRect(x0 + x * s, y0 + y * s, s, s);
      }
    if (gs.stairsPos) {
      const tx = Math.floor(gs.stairsPos.x / 16);
      const ty = Math.floor(gs.stairsPos.y / 16);
      if (gs.explored[ty * d.w + tx]) g.fillStyle(0xf2c14e, 1).fillRect(x0 + tx * s - 2, y0 + ty * s - 2, s + 4, s + 4);
    }
    if (gs.boss && gs.boss.active) {
      const tx = Math.floor(gs.boss.x / 16);
      const ty = Math.floor(gs.boss.y / 16);
      if (gs.explored[ty * d.w + tx]) g.fillStyle(0xff3a2a, 1).fillRect(x0 + tx * s - 2, y0 + ty * s - 2, s + 4, s + 4);
    }
    const p = gs.player;
    g.fillStyle(0x6fe3ff, 1).fillRect(x0 + Math.floor(p.x / 16) * s - 1, y0 + Math.floor(p.y / 16) * s - 1, s + 2, s + 2);
  }

  private showToast(t: { text: string; color: string; big?: boolean }) {
    const y = 110 + this.toastY * 34;
    this.toastY++;
    const txt = this.add
      .text(GAME_W / 2, y, t.text, {
        fontFamily: FONT,
        fontSize: t.big ? '30px' : '18px',
        color: t.color,
        stroke: '#000',
        strokeThickness: t.big ? 6 : 4,
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.tweens.add({ targets: txt, alpha: 1, y: y - 6, duration: 220 });
    this.tweens.add({
      targets: txt,
      alpha: 0,
      delay: 2000,
      duration: 500,
      onComplete: () => {
        txt.destroy();
        this.toastY = Math.max(0, this.toastY - 1);
      },
    });
  }

  // ---------------------------------------------------------------- 覆盖层
  private buildOverlay(title: string, titleColor: string, lines: string[], hint: string) {
    this.overlay.removeAll(true);
    const bg = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05040a, 0.78).setOrigin(0);
    const panel = this.add.rectangle(GAME_W / 2, GAME_H / 2, 540, 380, 0x15111d, 0.96).setStrokeStyle(3, 0x4c405e);
    const t = this.add
      .text(GAME_W / 2, GAME_H / 2 - 135, title, { fontFamily: FONT, fontSize: '48px', color: titleColor, stroke: '#000', strokeThickness: 8 })
      .setOrigin(0.5);
    const body = this.add
      .text(GAME_W / 2, GAME_H / 2 + 5, lines.join('\n'), {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#e8e2f0',
        align: 'center',
        lineSpacing: 10,
      })
      .setOrigin(0.5);
    const h = this.add
      .text(GAME_W / 2, GAME_H / 2 + 150, hint, { fontFamily: FONT, fontSize: '18px', color: '#6fe3ff' })
      .setOrigin(0.5);
    this.tweens.add({ targets: h, alpha: 0.4, duration: 600, yoyo: true, repeat: -1 });
    this.overlay.add([bg, panel, t, body, h]);
    this.overlay.setVisible(true).setAlpha(0);
    this.tweens.add({ targets: this.overlay, alpha: 1, duration: 250 });
  }

  private hideOverlay() {
    this.overlayKind = 'none';
    this.overlay.setVisible(false);
    this.overlay.removeAll(true);
  }

  private togglePause() {
    const gs = this.gs;
    if (!gs.ready || gs.state !== 'play') return;
    if (this.overlayKind === 'pause') {
      this.hideOverlay();
      this.scene.resume('Game');
    } else if (this.overlayKind === 'none') {
      this.overlayKind = 'pause';
      this.scene.pause('Game');
      this.buildOverlay('暂停', '#f2c14e', ['休息一下，地牢不会跑掉。'], 'P / Esc 继续 · Q 返回主菜单');
    }
  }

  private showResult(kind: 'win' | 'lose') {
    const gs = this.gs;
    this.overlayKind = kind;
    const secs = Math.max(0, Math.round((gs.endTime - gs.run.startTime) / 1000));
    const time = `${Math.floor(secs / 60)} 分 ${secs % 60} 秒`;
    const stats = [`到达层数：第 ${gs.run.level} 层`, `获得金币：${gs.run.coins}`, `击败敌人：${gs.run.kills}`, `用时：${time}`];
    if (kind === 'win') this.buildOverlay('胜利！', '#f2c14e', ['你击败了暗影魔王，地牢重归宁静。', ...stats], '回车 / R 再来一局 · Esc 主菜单');
    else this.buildOverlay('你倒下了', '#ff5a6a', stats, '回车 / R 重新开始 · Esc 主菜单');
  }

  private restartRun() {
    sfx.select();
    this.hideOverlay();
    this.shownHp = -1;
    this.gs.restartRun();
  }

  private toMenu() {
    sfx.select();
    this.hideOverlay();
    this.scene.stop('Game');
    this.scene.start('Menu');
  }
}
