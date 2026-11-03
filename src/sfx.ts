// 使用 WebAudio 即时合成的简单音效，不依赖任何外部音频文件。
let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) {
      const C =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.06, slideTo?: number, delay = 0) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur: number, vol = 0.05, filterFreq = 2000, delay = 0) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = filterFreq;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
}

export const sfx = {
  get muted() {
    return muted;
  },
  toggleMute() {
    muted = !muted;
    return muted;
  },
  unlock() {
    ac();
  },
  swing() {
    noise(0.09, 0.06, 3500);
  },
  hit() {
    tone(260, 0.08, 'square', 0.07, 90);
    noise(0.05, 0.05, 1200);
  },
  hurt() {
    tone(180, 0.18, 'sawtooth', 0.08, 60);
  },
  die() {
    tone(320, 0.2, 'square', 0.05, 40);
    noise(0.2, 0.05, 800);
  },
  coin() {
    tone(988, 0.06, 'square', 0.04);
    tone(1319, 0.1, 'square', 0.04, undefined, 0.05);
  },
  potion() {
    tone(523, 0.08, 'triangle', 0.08);
    tone(659, 0.08, 'triangle', 0.08, undefined, 0.07);
    tone(784, 0.14, 'triangle', 0.08, undefined, 0.14);
  },
  shoot() {
    tone(700, 0.12, 'sine', 0.04, 300);
  },
  parry() {
    tone(1400, 0.06, 'square', 0.04, 900);
  },
  stairs() {
    [392, 330, 262, 196].forEach((f, i) => tone(f, 0.12, 'triangle', 0.07, undefined, i * 0.09));
  },
  boss() {
    tone(90, 0.8, 'sawtooth', 0.09, 45);
    noise(0.6, 0.06, 400);
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'square', 0.05, undefined, i * 0.13));
  },
  lose() {
    [392, 311, 262, 196].forEach((f, i) => tone(f, 0.25, 'triangle', 0.07, undefined, i * 0.18));
  },
  select() {
    tone(660, 0.07, 'square', 0.04);
  },
};
