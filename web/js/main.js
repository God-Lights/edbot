// COMMANDER 웹 클라이언트. 서버(Cloudflare Worker)와 같은 출처에서 열린다.

import { api } from "./api.js";
import { combatView, startPlayback, stopPlayback } from "./combat.js";
import { guideModal, openGuide } from "./guide.js";
import { autoPlace, S, act, conn, join, leave, me, mySeat, setRender, store, toast, update } from "./state.js";
import { prepView } from "./prep.js";
import { openRanking, rankingModal } from "./ranking.js";
import { PHASE_NAME, REASON_TEXT, countdown, esc } from "./util.js";

const app = document.getElementById("app");
const toastEl = document.getElementById("toast");

// ---- 화면 ----

function lobbyView() {
  const loggedIn = !!S.user;
  const account = loggedIn
    ? `<div class="panel"><div class="row"><div><div class="sub">로그인됨</div><b class="big">${esc(S.user.nickname)}</b></div><span class="grow"></span><button class="btn sec" data-act="logout">상태 새로고침</button></div></div>`
    : `<div class="panel"><a class="btn primary wide" href="/auth/login">🔑 로그인하기</a>
        <input id="name" class="input" maxlength="16" placeholder="이름 (로그인하지 않은 개발 서버용)" value="${esc(S.name)}"></div>`;
  return `<div class="lobby">
    <div class="hero"><img class="logo" src="assets/logo.png" alt="COMMANDER"><div class="sub big">체스판 자동 전투 · 2인 실시간 대전</div></div>
    <div class="menu">
      ${account}
      <div class="panel stack">
        <button class="btn primary wide" data-act="create"${S.creating ? " disabled" : ""}>${S.creating ? "방을 만드는 중..." : "방 만들기"}</button>
        <div class="two"><button class="btn sec" data-act="ranking">🏆 랭킹</button><button class="btn sec" data-act="guide" data-tab="flow">📖 게임 가이드</button></div>
        <button class="btn sec wide" data-act="join-code" data-code="ADMN">🤖 연습 대전 (봇과 한 판, 쉬운 캐릭터만)</button>
        <button class="btn sec wide" data-act="join-code" data-code="ADMF">🤖 전체 대전 (봇, 모든 캐릭터와 자원 시스템)</button>
        <div class="or"><i></i><span>또는</span><i></i></div>
        <form class="row" data-form="join"><input id="code" class="input code" maxlength="4" placeholder="방 코드 4자리" autocapitalize="characters" autocomplete="off" value="${esc(S.roomCode)}">
          <button class="btn sec" type="submit">입장</button></form>
      </div>
    </div></div>`;
}

function roomLobbyView(room) {
  const ready = me()?.ready;
  const cards = room.players.map((p) => `<div class="panel pcard"><b class="big">${esc(p.name)}</b><div class="${p.ready ? "good" : "sub"}">${p.connected ? (p.ready ? "준비 완료" : "준비 중") : "연결 끊김"}</div></div>`).join("");
  return `<div class="roomlobby"><div class="sub">방 코드</div><div class="code-big">${esc(room.code)}</div>
    ${room.players.length < 2 ? `<div class="sub">상대를 기다리는 중... 방 코드를 알려 주세요.</div>` : ""}
    <div class="row center">${cards}</div>
    <button class="btn primary" data-act="ready">${ready ? "준비 취소" : "준비"}</button></div>`;
}

function resultView(room) {
  const r = room.result;
  const seat = mySeat();
  if (!r || seat == null) return `<div class="center-msg">결과를 불러오는 중...</div>`;
  const [title, cls] = r.winner == null ? ["무승부", ""] : r.winner === seat ? ["승리!", "good"] : ["패배", "bad"];
  const rating = r.ratings?.[seat];
  const delta = rating ? rating.after - rating.before : 0;
  return `<div class="result"><div class="rtitle ${cls}">${title}</div><div class="sub big">${esc(REASON_TEXT[r.reason] ?? r.reason)}</div>
    <div class="panel row center"><div class="stat"><small>남은 체력</small><b>${r.score[seat] ?? 0} : ${r.score[1 - seat] ?? 0}</b></div>
      <div class="stat"><small>라운드 승</small><b>${r.kills[seat] ?? 0} : ${r.kills[1 - seat] ?? 0}</b></div></div>
    ${rating ? `<div class="big ${delta >= 0 ? "good" : "bad"}">레이팅 ${rating.before} → ${rating.after} (${delta >= 0 ? "+" : ""}${delta})</div>` : ""}
    <div class="sub" data-timer="${room.phaseEndsAt ?? ""}" data-suffix=" 뒤 로비로 돌아가요">${countdown(conn.remainingMs(room.phaseEndsAt))} 뒤 로비로 돌아가요</div>
    <button class="btn sec" data-act="ranking">🏆 랭킹 보기</button></div>`;
}

function roomShell(room) {
  const players = room.players.map((p) => `<span class="pchip ${p.id === S.myId ? "me" : "them"}"><i class="dot ${p.connected ? "on" : ""}"></i>${esc(p.name)}${p.id === S.myId ? " (나)" : ""}</span>`).join("");
  let body = "";
  switch (room.phase) {
    case "lobby": body = roomLobbyView(room); break;
    case "prep": body = prepView(room); break;
    case "combat": body = combatView(room); break;
    case "result": body = resultView(room); break;
    default: body = `<div class="center-msg">이 웹 버전은 체스판 자동 전투만 지원해요. (${esc(PHASE_NAME[room.phase] ?? room.phase)})</div>`;
  }
  return `<div class="topbar"><img class="mini-logo" src="assets/logo.png" alt=""><b class="mono">${esc(room.code)}</b><span class="grow"></span>${players}
    <button class="btn sec" data-act="guide" data-tab="flow">📖 가이드</button><button class="btn sec" data-act="leave">나가기</button></div>
    ${S.status === "reconnecting" ? `<div class="warn center">다시 연결하는 중...</div>` : ""}<div class="room">${body}</div>`;
}

let lastPhaseKey = "";
function render() {
  const active = document.activeElement;
  const keepFocus = active && active.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
  const room = S.room;
  const inRoom = !!room && S.status !== "idle";
  // 전투 재생은 화면을 다시 그릴 때만 다시 시작한다.
  stopPlayback();
  const modalScroll = document.querySelector(".modal-body")?.scrollTop ?? 0;
  app.innerHTML = (inRoom ? roomShell(room) : S.status === "connecting" ? `<div class="center-msg">접속하는 중...</div>` : lobbyView())
    + (S.modal === "guide" ? guideModal() : S.modal === "ranking" ? rankingModal() : "");
  const modalBody = document.querySelector(".modal-body");
  if (modalBody) modalBody.scrollTop = modalScroll;
  if (inRoom && room.phase === "combat") startPlayback(room);
  if (keepFocus) {
    const el = document.getElementById(keepFocus.id);
    if (el) {
      el.focus();
      try { el.setSelectionRange(keepFocus.start, keepFocus.end); } catch { /* 입력칸이 아니면 무시 */ }
    }
  }
  lastPhaseKey = room ? `${room.phase}:${room.chess?.round ?? 0}` : "";
  if (S.message) {
    toastEl.textContent = S.message;
    toastEl.hidden = false;
  } else {
    toastEl.hidden = true;
  }
}
setRender(render);

// ---- 입력 ----

const num = (v) => Number(v);

function cellClick(col, row) {
  const chess = S.room?.chess;
  const mine = chess?.me;
  if (!mine) return;
  const occupant = mine.board.find((u) => u.col === col && u.row === row);
  if (S.selWeapon) {
    if (occupant) act.equip(S.selWeapon, occupant.uid);
    return;
  }
  if (S.selUid) {
    if (occupant?.uid === S.selUid) update({ selUid: null });
    else act.deploy(S.selUid, col, row);
  } else if (occupant) {
    update({ selUid: occupant.uid });
  }
}

function benchClick(slot) {
  const mine = S.room?.chess?.me;
  if (!mine) return;
  const unit = mine.bench[slot];
  if (S.selWeapon) {
    if (unit) act.equip(S.selWeapon, unit.uid);
    return;
  }
  if (!S.selUid) {
    if (unit) update({ selUid: unit.uid });
    return;
  }
  if (unit) update({ selUid: unit.uid === S.selUid ? null : unit.uid });
  else if (mine.board.some((u) => u.uid === S.selUid)) act.bench(S.selUid); // 판 위의 기물을 빈 대기석으로
}

async function createRoom() {
  update({ creating: true, message: "" });
  const result = await api.createRoom();
  update({ creating: false });
  if (result.code) join(result.code);
  else if (result.status === 401) toast("로그인이 필요해요. 로그인하기를 눌러 주세요.");
  else toast("방을 만들 수 없어요.");
}

document.addEventListener("click", (event) => {
  const el = event.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const d = el.dataset;
  switch (d.act) {
    case "create": createRoom(); break;
    case "join-code": join(d.code); break;
    case "ranking": openRanking(); break;
    case "guide": openGuide(d.tab); break;
    case "guide-tab": update({ guideTab: d.tab }); break;
    case "close-modal": update({ modal: null }); break;
    case "logout": refreshUser(); break;
    case "leave": leave(); break;
    case "ready": act.ready(!me()?.ready); break;
    case "buy": act.buy(num(d.slot)); break;
    case "reroll": act.reroll(); break;
    case "done": {
      const mine = S.room?.chess?.me;
      if (mine && !mine.board.length && !confirm("판에 기물이 없어요. 기물 없이 싸우면 이 라운드는 져요. 그래도 준비를 끝낼까요?")) break;
      act.done();
      break;
    }
    case "surrender": if (confirm("항복할까요? 바로 패배해요.")) act.surrender(); break;
    case "cell": cellClick(num(d.col), num(d.row)); break;
    case "bench-slot": benchClick(num(d.slot)); break;
    case "auto": {
      const chess = S.room?.chess;
      if (chess?.me) autoPlace(chess.me, chess.deployCap);
      break;
    }
    case "sell-sel": if (S.selUid) act.sell(S.selUid); break;
    case "bench-sel": if (S.selUid) act.bench(S.selUid); break;
    case "unequip-sel": if (S.selUid) act.unequip(S.selUid); break;
    case "market": act.market(num(d.slot)); break;
    case "smelt": act.smelt(d.id); break;
    case "pick-weapon": update({ selWeapon: S.selWeapon === d.id ? null : d.id }); break;
    case "coach-dismiss": store("edbot.coachDismissed", "1"); update({ coachDismissed: true }); break;
    case "tip-seen": store("edbot.tipSeen", "1"); update({ tipSeen: true }); break;
    default: break;
  }
});

// 모달 바깥(어두운 곳)을 누르면 닫는다.
document.addEventListener("click", (event) => {
  if (event.target.classList?.contains("modal")) update({ modal: null });
});

document.addEventListener("input", (event) => {
  if (event.target.id === "name") S.name = event.target.value;
  if (event.target.id === "code") {
    const cleaned = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    if (cleaned !== event.target.value) event.target.value = cleaned;
    S.roomCode = cleaned;
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  if (form.dataset.form === "join") join(S.roomCode);
});

// 드래그: 기물을 판, 대기석, 판매 칸으로 끌어다 놓는다.
let dragUid = null;
document.addEventListener("dragstart", (event) => {
  const el = event.target.closest?.("[data-uid]");
  if (!el) return;
  dragUid = el.dataset.uid;
  event.dataTransfer.setData("text/plain", dragUid);
  event.dataTransfer.effectAllowed = "move";
});
document.addEventListener("dragend", () => { dragUid = null; });
document.addEventListener("dragover", (event) => {
  if (dragUid && event.target.closest?.("[data-drop]")) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  const zone = event.target.closest?.("[data-drop]");
  const uid = dragUid ?? event.dataTransfer?.getData("text/plain");
  dragUid = null;
  const mine = S.room?.chess?.me;
  if (!zone || !uid || !mine || mine.done) return;
  event.preventDefault();
  if (zone.dataset.drop === "cell") act.deploy(uid, num(zone.dataset.col), num(zone.dataset.row));
  else if (zone.dataset.drop === "sell") act.sell(uid);
  else if (zone.dataset.drop === "bench" && mine.board.some((u) => u.uid === uid)) act.bench(uid);
});

// ---- 시간 표시: 화면을 다시 그리지 않고 글자만 갱신한다 ----

setInterval(() => {
  for (const el of document.querySelectorAll("[data-timer]")) {
    const end = el.dataset.timer ? Number(el.dataset.timer) : null;
    const text = countdown(conn.remainingMs(end));
    if (el.dataset.suffix != null) el.textContent = text + el.dataset.suffix;
    else el.textContent = `${el.dataset.label} ${text}`;
  }
}, 250);

// ---- 시작 ----

async function refreshUser() {
  try {
    S.user = await api.me();
  } catch {
    S.user = null;
  }
  S.authChecked = true;
  render();
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && S.modal) update({ modal: null });
});

(async function start() {
  render();
  await refreshUser();
  try {
    const catalog = await api.chessCatalog();
    if (catalog) update({ catalog });
  } catch { /* 가이드를 열 때 다시 시도하지 않아도 게임은 된다 */ }
  // 주소의 ?room=ABCD 로 바로 들어갈 수 있다.
  const code = new URLSearchParams(location.search).get("room");
  if (code) join(code);
})();

