// 효과음: 파일 없이 WebAudio로 합성한다. 첫 클릭 이후부터 소리가 난다. 음소거는 기억해 둔다.

let ctx = null;
let muted = false;
try { muted = localStorage.getItem("edbot.mute") === "1"; } catch { muted = false; }
const lastPlayed = {};

function audio() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, dur, { type = "sine", vol = 0.07, slide = 0, delay = 0 } = {}) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur, vol = 0.05, delay = 0) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + delay;
  const buffer = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  const gain = c.createGain();
  gain.gain.value = vol;
  src.buffer = buffer;
  src.connect(gain).connect(c.destination);
  src.start(t);
}

const SOUNDS = {
  click: () => tone(520, 0.05, { type: "triangle", vol: 0.05 }),
  buy: () => { tone(660, 0.07, { type: "triangle" }); tone(880, 0.1, { type: "triangle", delay: 0.06 }); },
  sell: () => { tone(500, 0.08, { type: "triangle" }); tone(330, 0.1, { type: "triangle", delay: 0.06 }); },
  place: () => tone(300, 0.06, { type: "square", vol: 0.04, slide: -80 }),
  ready: () => { tone(440, 0.08, { type: "triangle" }); tone(660, 0.12, { type: "triangle", delay: 0.08 }); },
  hit: () => { noise(0.07, 0.05); tone(180, 0.07, { type: "square", vol: 0.04, slide: -90 }); },
  ability: () => { tone(740, 0.18, { type: "sine", vol: 0.07, slide: 500 }); tone(1100, 0.2, { type: "sine", vol: 0.04, delay: 0.05 }); },
  death: () => { tone(220, 0.25, { type: "sawtooth", vol: 0.05, slide: -150 }); noise(0.15, 0.04); },
  promote: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, { type: "triangle", delay: i * 0.07 })); },
  mine: () => { tone(1320, 0.08, { type: "triangle", vol: 0.06 }); tone(1760, 0.16, { type: "triangle", vol: 0.05, delay: 0.07 }); },
  roundWin: () => { tone(523, 0.12, { type: "triangle" }); tone(784, 0.2, { type: "triangle", delay: 0.1 }); },
  roundLose: () => { tone(392, 0.15, { type: "triangle" }); tone(294, 0.25, { type: "triangle", delay: 0.12 }); },
  win: () => [523, 659, 784, 1047, 1318].forEach((f, i) => tone(f, 0.22, { type: "triangle", delay: i * 0.12 })),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { type: "sine", delay: i * 0.16 })),
  pickup: () => tone(700, 0.04, { type: "triangle", vol: 0.04 }),
  drop: () => tone(260, 0.07, { type: "triangle", vol: 0.06, slide: -60 }),
  equip: () => { tone(1200, 0.05, { type: "square", vol: 0.04 }); tone(1800, 0.14, { type: "triangle", vol: 0.05, delay: 0.04 }); noise(0.05, 0.03); },
  smelt: () => { noise(0.35, 0.05); tone(120, 0.35, { type: "sawtooth", vol: 0.04, slide: 160 }); tone(660, 0.12, { type: "triangle", vol: 0.04, delay: 0.3 }); },
  combine: () => { noise(0.12, 0.04); tone(440, 0.1, { type: "sawtooth", vol: 0.04, slide: 400 }); [880, 1109, 1319, 1760].forEach((f, i) => tone(f, 0.18, { type: "triangle", vol: 0.06, delay: 0.1 + i * 0.07 })); },
  merge: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, { type: "triangle", vol: 0.07, delay: i * 0.06 })),
  full: () => { tone(880, 0.08, { type: "triangle", vol: 0.06 }); tone(1175, 0.16, { type: "triangle", vol: 0.06, delay: 0.07 }); },
  roundStart: () => { tone(196, 0.5, { type: "sine", vol: 0.07 }); tone(392, 0.4, { type: "triangle", vol: 0.04, delay: 0.02 }); },
  combatStart: () => { tone(90, 0.18, { type: "sine", vol: 0.1, slide: -40 }); tone(90, 0.18, { type: "sine", vol: 0.1, slide: -40, delay: 0.2 }); noise(0.1, 0.04, 0.2); },
  tick: () => tone(1000, 0.03, { type: "square", vol: 0.025 }),
  suddenDeath: () => { tone(110, 0.5, { type: "sawtooth", vol: 0.05 }); tone(116, 0.5, { type: "sawtooth", vol: 0.04 }); },
};

// ---- 배경 음악: 파일 없이 합성한 잔잔한 아르페지오. 기본은 꺼져 있다. ----

const SCALE = [0, 3, 5, 7, 10, 12, 15]; // 마이너 펜타토닉 계열
let bgmOn = false;
try { bgmOn = localStorage.getItem("edbot.bgm") === "1"; } catch { bgmOn = false; }
let bgmTimer = null;
let bgmStep = 0;

function bgmTick() {
  if (muted || !bgmOn) return;
  const root = [110, 98, 123, 98][Math.floor(bgmStep / 8) % 4];
  const note = SCALE[[0, 2, 4, 2, 5, 4, 2, 1][bgmStep % 8]];
  const freq = root * 2 ** (note / 12);
  tone(freq, 0.7, { type: "sine", vol: 0.035 });
  if (bgmStep % 8 === 0) tone(root / 2, 1.6, { type: "triangle", vol: 0.03 });
  bgmStep += 1;
}

function startBgm() {
  if (bgmTimer) return;
  audio();
  bgmTimer = setInterval(bgmTick, 420);
}

function stopBgm() {
  clearInterval(bgmTimer);
  bgmTimer = null;
}

if (bgmOn) {
  // 브라우저는 첫 클릭 전에는 소리를 못 내서, 첫 클릭 때 시작한다.
  const once = () => { startBgm(); window.removeEventListener("pointerdown", once); };
  window.addEventListener("pointerdown", once);
}

export const bgm = {
  get on() { return bgmOn; },
  toggle() {
    bgmOn = !bgmOn;
    try { localStorage.setItem("edbot.bgm", bgmOn ? "1" : "0"); } catch { /* 무시 */ }
    if (bgmOn) startBgm(); else stopBgm();
    return bgmOn;
  },
};

export const sfx = {
  /** 이름의 소리를 낸다. 같은 소리는 60ms 안에 두 번 나지 않는다. */
  play(name) {
    if (muted || !SOUNDS[name]) return;
    const now = performance.now();
    if (now - (lastPlayed[name] ?? -1e9) < 60) return;
    lastPlayed[name] = now;
    try { SOUNDS[name](); } catch { /* 소리가 안 나도 게임은 된다 */ }
  },
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    try { localStorage.setItem("edbot.mute", muted ? "1" : "0"); } catch { /* 무시 */ }
    if (!muted) SOUNDS.click();
    return muted;
  },
};
