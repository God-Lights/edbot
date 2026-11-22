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
  ghost: () => { tone(660, 0.22, { type: "sine", vol: 0.05, slide: -380 }); tone(330, 0.3, { type: "triangle", vol: 0.03, slide: 220, delay: 0.08 }); },
  surface: () => { tone(220, 0.2, { type: "sine", vol: 0.06, slide: 700 }); [660, 880, 1175].forEach((f, i) => tone(f, 0.14, { type: "triangle", vol: 0.05, delay: 0.12 + i * 0.05 })); },
  tick: () => tone(1000, 0.03, { type: "square", vol: 0.025 }),
  suddenDeath: () => { tone(110, 0.5, { type: "sawtooth", vol: 0.05 }); tone(116, 0.5, { type: "sawtooth", vol: 0.04 }); },
};

// ---- 배경 음악: 곡 3개를 상황에 맞게 바꿔 튼다 ----
// prep   = Tactical Drop     : 로비, 방 대기, 준비 단계
// combat = Tactical Drop (1) : 전투 단계
// finale = Final Checkmate   : 마지막 라운드(끝 두 라운드), 체력이 위태로울 때, 결과 화면
// 곡마다 재생 위치를 기억해서, 준비 ↔ 전투로 바뀌어도 이어서 들린다. 바뀔 때는 서로 겹치며 부드럽게 넘어간다.

const TRACKS = { prep: "/assets/music/prep.mp3", combat: "/assets/music/combat.mp3", finale: "/assets/music/finale.mp3" };
const MUSIC_VOL = 0.5;
let bgmOn = true; // 처음에는 켜져 있고, 끄면 기억한다.
try { bgmOn = localStorage.getItem("edbot.bgm") !== "0"; } catch { bgmOn = true; }
let scene = "prep";
let unlocked = false; // 브라우저는 첫 클릭 전에는 소리를 못 낸다.
const players = {};

function player(name) {
  let p = players[name];
  if (p) return p;
  const c = audio();
  if (!c) return null;
  const el = new Audio(TRACKS[name]);
  el.loop = true;
  el.preload = "auto";
  const gain = c.createGain();
  gain.gain.value = 0;
  try { c.createMediaElementSource(el).connect(gain); } catch { return null; }
  gain.connect(c.destination);
  p = { el, gain, stop: 0 };
  players[name] = p;
  return p;
}

function syncBgm() {
  if (!unlocked) return;
  const c = audio();
  if (!c) return;
  for (const name of Object.keys(TRACKS)) {
    const active = bgmOn && !muted && name === scene;
    if (active) {
      const p = player(name);
      if (!p) continue;
      clearTimeout(p.stop);
      p.el.play().catch(() => {});
      p.gain.gain.cancelScheduledValues(c.currentTime);
      p.gain.gain.setTargetAtTime(MUSIC_VOL, c.currentTime, 0.45);
    } else if (players[name]) {
      const p = players[name];
      clearTimeout(p.stop);
      p.gain.gain.cancelScheduledValues(c.currentTime);
      p.gain.gain.setTargetAtTime(0, c.currentTime, 0.45);
      p.stop = setTimeout(() => { if (!(bgmOn && !muted && name === scene)) p.el.pause(); }, 2200); // 위치는 그대로 남는다
    }
  }
}

const unlock = () => {
  unlocked = true;
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
  syncBgm();
};
window.addEventListener("pointerdown", unlock);
window.addEventListener("keydown", unlock);

export const bgm = {
  get on() { return bgmOn; },
  toggle() {
    bgmOn = !bgmOn;
    try { localStorage.setItem("edbot.bgm", bgmOn ? "1" : "0"); } catch { /* 무시 */ }
    syncBgm();
    return bgmOn;
  },
  /** 지금 상황에 맞는 곡으로 바꾼다. (같은 곡이면 아무 일도 없다) */
  scene(name) {
    if (!TRACKS[name] || name === scene) return;
    scene = name;
    syncBgm();
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
    syncBgm();
    if (!muted) SOUNDS.click();
    return muted;
  },
};
