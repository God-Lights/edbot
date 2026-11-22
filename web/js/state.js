// 앱 전체 상태와 서버로 보내는 행동. 화면은 이것만 보고 그린다.

import { Connection } from "./conn.js";
import { errorText } from "./util.js";

const load = (key, fallback = "") => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
export const store = (key, value) => {
  try { localStorage.setItem(key, String(value)); } catch { /* 무시 */ }
};

export const S = {
  user: null,
  authChecked: false,
  name: load("edbot.name", "Player"),
  roomCode: "",
  room: null,
  myId: null,
  status: "idle", // idle | connecting | connected | reconnecting
  message: "",
  catalog: null,
  selUid: null,
  selWeapon: null,
  modal: null, // null | "guide" | "ranking"
  guideTab: "flow",
  ranking: null,
  /** 봇 난이도: "" (기본: 연습 쉬움, 전체 보통) | easy | normal | hard */
  botLevel: load("edbot.botLevel"),
  coachDismissed: load("edbot.coachDismissed") === "1",
  tipSeen: load("edbot.tipSeen") === "1",
  creating: false,
  /** 빠른 대전 줄서기: null | { ticket, startedAt, waiting } */
  quick: null,
  /** 관전 중이다 (플레이어가 아니다) */
  spectating: false,
  /** 이번 판에서 본 전투 기록 (라운드 번호 -> 전투). 다시 보기에 쓴다. */
  sessionRounds: {},
  /** 다시 보기 모달 상태 */
  replay: null,
  /** 빠른 대전으로 들어온 방이면 로비에서 자동으로 준비한다 */
  autoReady: false,
};

let renderFn = () => {};
export const setRender = (fn) => { renderFn = fn; };
export const update = (patch = {}) => {
  Object.assign(S, patch);
  renderFn();
};

let toastTimer = null;
export function toast(text) {
  S.message = text;
  renderFn();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.message = ""; renderFn(); }, 4000);
}

export const me = () => S.room?.players.find((p) => p.id === S.myId) ?? null;
export const mySeat = () => me()?.seat ?? null;
export const unitInfo = (id) => S.catalog?.units.find((u) => u.id === id);
export const materialInfo = (id) => S.catalog?.materials.find((m) => m.id === id);
export const weaponInfo = (id) => S.catalog?.weapons.find((w) => w.id === id);
export const synergyInfo = (id) => S.catalog?.synergies.find((s) => s.id === id);

// ---- 연결 ----

export const conn = new Connection((event) => {
  switch (event.type) {
    case "connected":
      S.myId = event.playerId;
      observe(event.room);
      S.status = "connected";
      renderFn();
      break;
    case "state":
      observe(event.room);
      renderFn();
      break;
    case "error":
      toast(errorText(event.code, event.message));
      break;
    case "reconnecting":
      S.status = "reconnecting";
      renderFn();
      break;
    case "closed":
      leave("연결이 끊겼어요. 다시 들어와 주세요.");
      break;
    default:
      break;
  }
});

function observe(room) {
  const prev = S.room;
  if (prev?.phase === "lobby" && room.phase === "prep") S.sessionRounds = {};
  if (room.phase === "combat" && room.chess?.combat) {
    S.sessionRounds[room.chess.round] = { round: room.chess.round, ...room.chess.combat };
  }
  if (prev?.phase !== room.phase || prev?.chess?.round !== room.chess?.round) {
    S.selUid = null;
    S.selWeapon = null;
  }
  S.room = room;
}

export function join(code, level = "", spectate = false) {
  code = code.trim().toUpperCase();
  if (code.length !== 4) return toast("방 코드는 4자리예요.");
  leave();
  S.status = "connecting";
  S.message = "";
  store("edbot.name", S.name);
  S.spectating = spectate;
  S.sessionRounds = {};
  conn.start(code, S.user?.nickname ?? S.name, level, spectate);
  renderFn();
}

export function leave(message = "") {
  conn.stop();
  S.room = null;
  S.myId = null;
  S.status = "idle";
  S.selUid = null;
  S.selWeapon = null;
  S.autoReady = false;
  S.spectating = false;
  S.message = message;
  renderFn();
}

// ---- 행동 ----

const send = (obj) => conn.send(obj);
export const act = {
  ready: (ready) => send({ t: "ready", ready }),
  buy: (slot) => send({ t: "buy", slot }),
  sell: (uid) => { S.selUid = null; send({ t: "sell", uid }); },
  reroll: () => send({ t: "reroll" }),
  deploy: (uid, col, row) => { S.selUid = null; send({ t: "deploy", uid, col, row }); },
  bench: (uid) => { S.selUid = null; send({ t: "bench", uid }); },
  done: () => { S.selUid = null; send({ t: "done" }); },
  surrender: () => send({ t: "surrender" }),
  market: (slot) => send({ t: "market", slot }),
  smelt: (material) => send({ t: "smelt", material }),
  equip: (weaponId, uid) => { S.selWeapon = null; send({ t: "equip", weaponId, uid }); },
  unequip: (uid) => send({ t: "unequip", uid }),
};

const BOT_ROW = { 탱커: 0, 지휘: 1, 암살: 1, 기동: 1, 제어: 2, 딜러: 2, 서포터: 3 };
const COLS = [3, 4, 2, 5, 1, 6, 0, 7];
const prefRow = (u) => BOT_ROW[unitInfo(u.defId)?.role] ?? 3;

/** 대기석의 기물을 알아서 판에 놓는다. 단단한 역할은 앞줄, 약한 역할은 뒷줄, 가운데 칸부터. */
export function autoPlace(me_, cap) {
  const taken = new Set(me_.board.map((u) => u.row * 8 + u.col));
  let free = cap - me_.board.length;
  const bench = me_.bench.filter(Boolean).sort((a, b) => prefRow(a) - prefRow(b));
  S.selUid = null;
  for (const unit of bench) {
    if (free <= 0) break;
    const first = prefRow(unit);
    const rows = [first, ...[0, 1, 2, 3].filter((r) => r !== first)];
    let placed = false;
    for (const row of rows) {
      for (const col of COLS) {
        if (taken.has(row * 8 + col)) continue;
        taken.add(row * 8 + col);
        send({ t: "deploy", uid: unit.uid, col, row });
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (placed) free -= 1;
  }
}
