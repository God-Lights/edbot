// COMMANDER 웹 클라이언트. 서버(Cloudflare Worker)와 같은 출처에서 열린다.

import { ic } from "./icons.js";
import { api } from "./api.js";
import { arenaHtml, combatView, startPlayback, stopPlayback, teamPanels } from "./combat.js";
import { guideModal, openGuide } from "./guide.js";
import { autoPlace, S, act, conn, join, leave, me, mySeat, setRender, store, toast, update } from "./state.js";
import { hpPill, prepView } from "./prep.js";
import { openMatchReplay, openReplay, replayAction, replayModal, replayScrub, startReplay } from "./replay.js";
import { openRanking, rankingModal } from "./ranking.js";
import { combineItems, itemName } from "./crafting.js";
import { bgm, sfx } from "./sfx.js";
import { loadPacks, logoUrl, packsModal } from "./packs.js";
import { PHASE_NAME, PROTOCOL_VERSION, REASON_TEXT, countdown, esc } from "./util.js";

const app = document.getElementById("app");
const toastEl = document.getElementById("toast");

// ---- 화면 ----

/** 운영이 아닌 서버(개발·로컬)에서 로비 맨 위에 띄우는 안내 띠 */
function serverBand() {
  const server = S.server;
  if (!server || server.env === "production") return "";
  const local = server.env === "local";
  // GL 연결 서버: 로그인은 GL 계정(공식 서버가 확인), 전적은 이 서버
  const linked = !!server.linked;
  const note = linked
    ? `로그인은 GL 계정, 전적은 이 서버에만 남아요.${server.authMode === "hybrid" ? " 로그인하지 않으면 이름으로 놀 수 있어요(전적 없음)." : ""}`
    : local
    ? "이름이 곧 계정이에요. 전적은 이 서버에만 남아요."
    : "시험용 서버예요. 전적은 개발용 데이터예요.";
  const packs = server.packs ?? [];
  const packNames = packs.map((p) => `${p.name} ${p.version}`).join(", ");
  const expert = server.edition === "expert"
    ? ` <span class="badge mob" title="${esc(packs.length ? `적용된 팩: ${packNames}` : "플러그인으로 규칙이 달라질 수 있어요")}">엑스퍼트${packs.length ? ` · 팩 ${packs.length}개` : ""}</span>`
    : "";
  const kind = linked ? "GL 연결 서버" : local ? "로컬 서버" : "개발 서버";
  const owner = linked && server.linked.owner && S.user && S.user.username?.toLowerCase() === server.linked.owner.toLowerCase()
    ? ` <a class="badge mob" href="/server-admin.html">서버 관리</a>`
    : "";
  return `<div class="srvband ${esc(server.env)}${linked ? " linked" : ""}">${ic(local ? "server" : "flask")} <b>${kind} · ${esc(server.name)}</b>${expert}${owner}<span class="sub tiny">${note}</span></div>`;
}

function lobbyView() {
  const loggedIn = !!S.user;
  // 서버가 알려 주는 로그인 방식: gl(GL 로그인) | hybrid(GL 로그인 또는 이름) | open(이름만). 모르는 서버는 예전처럼 둘 다 보여 준다.
  const mode = S.server?.authMode ?? "hybrid";
  const guestRooms = S.server ? S.server.guestRooms !== false : true;
  const loginButton = mode !== "open" ? `<a class="btn primary wide" href="/auth/login">${ic("key")} 로그인하기</a>` : "";
  const nameHint = mode === "open" ? "이름 (이 서버에서 쓸 이름)" : mode === "hybrid" ? "이름 (로그인하지 않으면 이 이름으로 놀아요)" : "이름 (로그인하지 않은 개발 서버용)";
  const nameInput = mode !== "gl" ? `<input id="name" class="input" maxlength="16" placeholder="${nameHint}" value="${esc(S.name)}">` : "";
  const account = loggedIn
    ? `<div class="panel"><div class="row tight"><div><div class="sub">로그인됨</div><b class="big">${esc(S.user.nickname)}</b></div><span class="grow"></span>${S.server?.linked ? `<button class="btn sec" data-act="linked-logout">로그아웃</button>` : `<button class="btn sec" data-act="logout">새로고침</button>`}</div></div>`
    : `<div class="panel stack tight">${loginButton}${nameInput}</div>`;
  const guestCard = guestRooms ? `
        <div class="panel stack tight">
          <b>${ic("cap")} 게스트로 참가</b><div class="sub tiny">GL 계정 없이 학번과 이름으로 게스트 방에 들어가요. (전적은 안 남아요)</div>
          <form class="stack tight" data-form="guest">
            <div class="row tight"><input id="gid" class="input" inputmode="numeric" maxlength="10" placeholder="학번 (예: 20211)" value="${esc(S.guest.studentId)}">
              <input id="gname" class="input" maxlength="16" placeholder="이름" value="${esc(S.guest.name)}"></div>
            <div class="row tight"><input id="gcode" class="input code" maxlength="4" placeholder="방 코드" autocapitalize="characters" autocomplete="off" value="${esc(S.guestCode)}">
              <button class="btn primary" type="submit">참가</button></div>
          </form>
        </div>` : "";
  return `${serverBand()}<div class="lobby">
    <div class="hero"><img class="logo" src="${esc(logoUrl())}" alt="COMMANDER"><div class="sub herotext">체스판 자동 전투 · 2인 실시간 대전</div></div>
    <div class="menu">
      <div class="mgroup">
        ${account}
        ${guestCard}
      </div>
      <div class="mgroup">
        <div class="panel stack tight">
          <button class="btn primary wide findmatch" data-act="quick"${S.quick ? " disabled" : ""}><span>${ic("swords")} 게임 찾기</span><small>비슷한 실력의 상대와 1:1</small></button>
          <button class="modecard" data-act="create"${S.creating ? " disabled" : ""}><span class="mi">${ic("users")}</span><span><b>${S.creating ? "만드는 중..." : "방 만들기"}</b><small>${S.mobius ? "친구와 · 무한 모드" : "친구와 · 방 코드로"}</small></span></button>
          <label class="chk" title="앞면·밑면, 이음매, 웜홀이 있는 뫼비우스 규칙으로 싸워요"><input type="checkbox" id="mobius"${S.mobius ? " checked" : ""}> ${ic("infinity")} 방을 무한 모드로</label>
          <form class="row tight" data-form="join"><input id="code" class="input code" maxlength="4" placeholder="방 코드 4자리" autocapitalize="characters" autocomplete="off" value="${esc(S.roomCode)}">
            <button class="btn sec" type="submit">입장</button></form>
          <form class="row tight" data-form="watch"><input id="watch" class="input code" maxlength="4" placeholder="관전할 방 코드" autocapitalize="characters" autocomplete="off" value="${esc(S.watchCode ?? "")}">
            <button class="btn sec" type="submit">${ic("eye")} 관전</button></form>
        </div>
        ${loggedIn ? `<div class="panel stack tight"><div class="two"><button class="btn sec" data-act="create-guest">${ic("cap")} 게스트 방</button><button class="btn sec" data-act="live">${ic("eye")} 경기 관전</button></div>
          <button class="btn sec wide" data-act="myrooms">${ic("folder")} 내 방 관리</button></div>` : ""}
      </div>
      <div class="mgroup">
        <div class="panel stack tight">
          <label class="levelrow"><span class="sub">봇 난이도</span>
            <select id="botlevel" class="input sel">${[["", "기본"], ["easy", "쉬움"], ["normal", "보통"], ["hard", "어려움"]]
              .map(([v, t]) => `<option value="${v}"${S.botLevel === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
          <button class="modecard" data-act="join-code" data-code="ADMN" title="봇과 한 판, 쉬운 캐릭터만"><span class="mi">${ic("bot")}</span><span><b>연습 대전</b><small>봇과 · 쉬운 캐릭터</small></span></button>
          <button class="modecard" data-act="join-code" data-code="ADMF" title="봇, 모든 캐릭터와 자원 시스템"><span class="mi">${ic("bot")}</span><span><b>전체 대전</b><small>봇과 · 모든 캐릭터</small></span></button>
          <button class="modecard" data-act="join-code" data-code="ADMX" title="봇, 앞면·밑면과 이음매가 있는 무한 모드"><span class="mi">${ic("infinity")}</span><span><b>무한 대전</b><small>봇과 · 뫼비우스 규칙</small></span></button>
        </div>
        <div class="panel two tight"><button class="btn sec" data-act="ranking">${ic("trophy")} 랭킹</button><button class="btn sec" data-act="guide" data-tab="flow">${ic("book")} 가이드</button></div>
        ${S.packs.length ? `<button class="btn sec wide" data-act="packs">${ic("list")} 이 서버의 팩 ${S.packs.length}개</button>` : ""}
        <a class="btn sec wide" href="install.html">${ic("link")} 앱 설치 안내</a>
      </div>
    </div></div>`;
}

function guestRoomModal() {
  const code = S.guestRoom;
  return `<div class="modal"><div class="modal-box small"><div class="modal-head"><h2>게스트 방이 만들어졌어요</h2><button class="btn sec" data-act="close-modal">닫기</button></div>
    <div class="roomlobby" style="padding:10px 0"><div class="sub">방 코드</div><div class="code-big">${esc(code)}</div>
      <div class="sub">참가자는 <b>게스트로 참가</b>에서 학번·이름·이 코드를 입력하면 들어와요.</div>
      <div class="row center"><button class="btn primary" data-act="guestroom-play" data-code="${esc(code)}">내가 플레이어로 참가</button>
        <button class="btn sec" data-act="guestroom-watch" data-code="${esc(code)}">${ic("eye")} 관전하기</button></div></div></div></div>`;
}

const LIVE_PHASE = { lobby: "대기 중", prep: "준비 중", combat: "전투 중", result: "결과" };

function liveModal() {
  const live = S.live;
  let body;
  if (!live) body = `<div class="panel">불러오는 중...</div>`;
  else if (live.error) body = `<div class="panel warn">${live.error === 401 ? "GL 로그인이 필요해요." : "목록을 불러오지 못했어요."}</div>`;
  else if (!live.rooms.length) body = `<div class="panel sub">지금 진행 중인 게스트 경기가 없어요. 게스트 방을 만들거나 참가자가 들어오면 여기에 나타나요.</div>`;
  else {
    body = live.rooms.map((r) => {
      const who = r.players.length
        ? r.players.map((p) => `${p.studentId ? esc(p.studentId) + " " : ""}${esc(p.name)}${p.connected ? "" : " (끊김)"}`).join("  vs  ")
        : "참가자를 기다리는 중";
      const hp = r.hps ? `${ic("heart")} ${Math.max(0, r.hps[0])} : ${Math.max(0, r.hps[1])}` : "";
      const round = r.round ? `라운드 ${r.round}/${r.maxRounds}` : "";
      return `<div class="panel livecard"><div><b>${who}</b><div class="sub">${esc(LIVE_PHASE[r.phase] ?? r.phase)} ${round} ${hp} · 방 ${esc(r.code)} · 만든 사람 ${esc(r.host)}</div></div>
        <span class="grow"></span>${r.mine ? `<button class="btn sec" data-act="room-close" data-code="${esc(r.code)}" data-from="live">${ic("trash")} 삭제</button>` : ""}
        <button class="btn primary" data-act="live-watch" data-code="${esc(r.code)}">${ic("eye")} 관전</button></div>`;
    }).join("");
  }
  return `<div class="modal"><div class="modal-box"><div class="modal-head"><h2>진행 중인 게스트 경기</h2>
    <div class="row"><button class="btn sec" data-act="live-refresh">${ic("refresh")} 새로고침</button><button class="btn sec" data-act="close-modal">닫기</button></div></div>
    <div class="modal-body">${body}</div></div></div>`;
}

function myRoomsModal() {
  const m = S.myRooms;
  let body;
  if (!m) body = `<div class="panel">불러오는 중...</div>`;
  else if (m.error) body = `<div class="panel warn">${m.error === 401 ? "GL 로그인이 필요해요." : "목록을 불러오지 못했어요."}</div>`;
  else if (!m.rooms.length) body = `<div class="panel sub">내가 만든 방이 없어요.</div>`;
  else {
    body = m.rooms.map((r) => {
      const who = r.players.length ? r.players.map((p) => `${p.studentId ? esc(p.studentId) + " " : ""}${esc(p.name)}${p.connected ? "" : " (끊김)"}`).join("  vs  ") : "참가자 없음";
      return `<div class="panel livecard"><div><b>방 ${esc(r.code)} · ${r.guest ? "게스트 방" : "일반 방"}</b><div class="sub">${esc(LIVE_PHASE[r.phase] ?? r.phase)}${r.round ? ` · 라운드 ${r.round}/${r.maxRounds}` : ""} · ${who}</div></div>
        <span class="grow"></span><button class="btn sec" data-act="room-close" data-code="${esc(r.code)}" data-from="myrooms">${ic("trash")} 삭제</button></div>`;
    }).join("");
  }
  const count = m?.rooms?.length ?? 0;
  return `<div class="modal"><div class="modal-box"><div class="modal-head"><h2>내 방 관리</h2>
    <div class="row">${count ? `<button class="btn sec" data-act="myrooms-clear">${ic("trash")} 모두 닫기 (${count})</button>` : ""}<button class="btn sec" data-act="myrooms">${ic("refresh")} 새로고침</button><button class="btn sec" data-act="close-modal">닫기</button></div></div>
    <div class="sub">방을 닫으면 안에 있는 사람이 모두 나가지고, 방의 내용이 지워져요. 내가 만든 방만 보여요.</div>
    <div class="modal-body">${body}</div></div></div>`;
}

async function openMyRooms() {
  S.myRooms = null;
  update({ modal: "myrooms" });
  await refreshMyRooms();
}
async function refreshMyRooms() {
  const rooms = await api.myRooms();
  S.myRooms = Array.isArray(rooms) ? { rooms } : rooms;
  if (S.modal === "myrooms") render();
}

/** 방 하나를 닫는다. 끝나면 열려 있는 목록을 새로 불러온다. */
async function closeRoom(code, from) {
  if (!confirm(`방 ${code}을(를) 닫을까요? 안에 있는 사람이 모두 나가져요.`)) return;
  const result = await api.closeRoom(code);
  if (result.ok) toast(`방 ${code}을(를) 닫았어요.`);
  else if (result.status === 403) toast(result.message ?? "방을 만든 사람만 닫을 수 있어요.");
  else if (result.status === 404) toast("이미 없는 방이에요.");
  else toast("방을 닫지 못했어요.");
  if (from === "myrooms") await refreshMyRooms();
  if (from === "live") await refreshLive();
}

async function closeAllMyRooms() {
  const rooms = S.myRooms?.rooms ?? [];
  if (!rooms.length || !confirm(`내가 만든 방 ${rooms.length}개를 모두 닫을까요? 안에 있는 사람이 모두 나가져요.`)) return;
  let closed = 0;
  for (const r of rooms) if ((await api.closeRoom(r.code)).ok) closed += 1;
  toast(`${closed}개 방을 닫았어요.`);
  await refreshMyRooms();
}

let liveTimer = null;
async function refreshLive() {
  const rooms = await api.live();
  S.live = Array.isArray(rooms) ? { rooms } : rooms;
  if (S.modal === "live") render();
}
function openLive() {
  S.live = null;
  update({ modal: "live" });
  refreshLive();
  clearInterval(liveTimer);
  liveTimer = setInterval(() => (S.modal === "live" ? refreshLive() : clearInterval(liveTimer)), 5000);
}

async function createGuestRoom() {
  update({ creating: true, message: "" });
  const result = await api.createRoom(true, S.mobius);
  update({ creating: false });
  if (result.code) update({ modal: "guestroom", guestRoom: result.code });
  else if (result.status === 401) toast("게스트 방은 GL 로그인 후에 만들 수 있어요.");
  else toast("방을 만들 수 없어요.");
}

function joinAsGuest() {
  const studentId = (S.guest.studentId ?? "").trim();
  const name = (S.guest.name ?? "").trim();
  if (!/^\d{4,10}$/.test(studentId)) return toast("학번은 숫자 4~10자리예요. (예: 20211)");
  if (!name) return toast("이름을 입력해 주세요.");
  store("edbot.guestId", studentId);
  store("edbot.guestName", name);
  join(S.guestCode, "", false, { studentId, name });
}

function quickView() {
  const waited = Math.floor((Date.now() - S.quick.startedAt) / 1000);
  return `<div class="center-msg"><div class="spinner"></div><h2>상대를 찾는 중...</h2>
    <div class="sub" data-quick="${S.quick.startedAt}">${waited}초 · 대기 중 ${S.quick.waiting ?? 1}명</div>
    <div class="sub">오래 기다릴수록 더 넓은 실력의 상대와 붙어요.</div>
    ${waited >= 20 ? `<div class="sub warn">상대가 없나요? 연습 대전으로 먼저 연습해 보세요.</div>` : ""}
    <button class="btn sec" data-act="quick-cancel">취소</button></div>`;
}

function roomLobbyView(room) {
  const ready = me()?.ready;
  const cards = room.players.map((p) => `<div class="panel pcard"><b class="big">${esc(p.name)}</b><div class="${p.ready ? "good" : "sub"}">${p.connected ? (p.ready ? "준비 완료" : "준비 중") : "연결 끊김"}</div></div>`).join("");
  return `<div class="roomlobby"><div class="sub">방 코드</div><div class="code-big">${esc(room.code)}</div>
    ${room.mobius ? `<div class="badge mob" title="앞면·밑면, 이음매, 웜홀이 있는 뫼비우스 규칙">${ic("infinity")} 무한 모드</div>` : ""}
    ${room.players.length < 2 ? `<div class="sub">상대를 기다리는 중... 방 코드를 알려 주세요.</div>` : ""}
    <div class="row center">${cards}</div>
    <button class="btn primary" data-act="ready">${ready ? "준비 취소" : "준비"}</button>
    ${["ADMN", "ADMF", "ADMX"].includes(room.code) ? "" : `<button class="btn sec" data-act="copy-watch" data-code="${esc(room.code)}">${ic("eye")} 관전 링크 복사</button>`}</div>`;
}

function resultView(room) {
  const r = room.result;
  const seat = mySeat();
  if (!r || seat == null) return `<div class="center-msg">결과를 불러오는 중...</div>`;
  const [title, cls] = r.winner == null ? ["무승부", ""] : r.winner === seat ? ["승리!", "good"] : ["패배", "bad"];
  const rating = r.ratings?.[seat];
  const delta = rating ? rating.after - rating.before : 0;
  const confetti = r.winner === seat
    ? `<div class="confetti">${Array.from({ length: 36 }, (_, i) => `<i style="left:${(i * 37) % 100}%;--d:${(i % 9) * 0.12}s;--c:${["#f2c74d", "#6bd98c", "#6194ff", "#e661d9", "#ff7566"][i % 5]}"></i>`).join("")}</div>`
    : "";
  return `${confetti}<div class="result"><div class="rtitle ${cls}">${title}</div><div class="sub big">${esc(REASON_TEXT[r.reason] ?? r.reason)}</div>
    <div class="panel row center"><div class="stat"><small>남은 체력</small><b>${r.score[seat] ?? 0} : ${r.score[1 - seat] ?? 0}</b></div>
      <div class="stat"><small>라운드 승</small><b>${r.kills[seat] ?? 0} : ${r.kills[1 - seat] ?? 0}</b></div></div>
    ${rating ? `<div class="big ${delta >= 0 ? "good" : "bad"}">레이팅 ${rating.before} → ${rating.after} (${delta >= 0 ? "+" : ""}${delta})</div>` : ""}
    <div class="sub" data-timer="${room.phaseEndsAt ?? ""}" data-suffix=" 뒤 로비로 돌아가요">${countdown(conn.remainingMs(room.phaseEndsAt))} 뒤 로비로 돌아가요</div>
    <div class="row center">${Object.keys(S.sessionRounds).length ? `<button class="btn sec" data-act="rewatch-all">▶ 전투 다시 보기 (${Object.keys(S.sessionRounds).length}라운드)</button>` : ""}
    <button class="btn sec" data-act="ranking">${ic("trophy")} 랭킹 보기</button></div></div>`;
}

function spectatorHeader(room, chess) {
  const names = [0, 1].map((seat) => room.players.find((p) => p.seat === seat)?.name ?? "?");
  return `<header class="gbar"><div class="gb-side"><b class="mono gb-code">${esc(room.code)}</b>${hpPill(names[0], chess.hps[0], "var(--mine)", chess.startHp)}</div>
    <div class="gb-center"><b>R${chess.round}/${chess.maxRounds}</b><span class="sub gb-timer" data-timer="${room.phaseEndsAt ?? ""}" data-label="${PHASE_NAME[room.phase]}">${PHASE_NAME[room.phase]} ${countdown(conn.remainingMs(room.phaseEndsAt))}</span></div>
    <div class="gb-side gb-right">${hpPill(names[1], chess.hps[1], "var(--theirs)", chess.startHp)}<span class="badge">${ic("eye")} 관전</span>
      <div class="gb-btns"><button class="ibtn" data-act="mute" title="효과음">${ic(sfx.muted ? "volume-off" : "volume")}</button><button class="ibtn" data-act="leave" title="관전 끝내기">${ic("log-out")}</button></div></div></header>`;
}

function spectatorCombat(room) {
  const chess = room.chess;
  return `<div class="game combatgame">${spectatorHeader(room, chess)}<main class="cmain"><div class="carena">${arenaHtml(chess.combat, 0)}</div><div class="cside">${teamPanels(chess.combat, 0)}</div></main></div>`;
}

function spectatorBody(room) {
  const chess = room.chess;
  const names = [0, 1].map((seat) => room.players.find((p) => p.seat === seat)?.name ?? "?");
  if (room.phase === "lobby" || !chess) {
    return `<div class="roomlobby"><div class="sub">방 코드</div><div class="code-big">${esc(room.code)}</div>
      <div class="sub">${esc(names.join(" vs "))} · 경기가 시작되기를 기다리는 중... (관전 화면은 전투부터 보여요)</div></div>`;
  }
  if (room.phase === "prep") {
    return `${spectatorHeader(room, chess)}<div class="center-msg"><div class="spinner"></div><b>플레이어들이 준비하는 중...</b><div class="sub">준비 단계의 상점과 배치는 보이지 않아요. 전투가 시작되면 함께 볼 수 있어요.</div></div>`;
  }
  if (room.phase === "result" && room.result) {
    const r = room.result;
    const title = r.winner == null ? "무승부" : `${esc(names[r.winner])} 승리!`;
    return `<div class="result"><div class="rtitle">${title}</div><div class="sub big">${esc(REASON_TEXT[r.reason] ?? r.reason)}</div>
      <div class="panel row center"><div class="stat"><small>남은 체력</small><b>${r.score[0]} : ${r.score[1]}</b></div><div class="stat"><small>라운드 승</small><b>${r.kills[0]} : ${r.kills[1]}</b></div></div></div>`;
  }
  return `<div class="center-msg">불러오는 중...</div>`;
}

function roomShell(room) {
  const reconnect = S.status === "reconnecting" ? `<div class="reconnect">다시 연결하는 중...</div>` : "";
  if (S.spectating) {
    if (room.phase === "combat" && room.chess?.combat) return spectatorCombat(room) + reconnect;
    return `<div class="topbar"><img class="mini-logo" src="${esc(logoUrl())}" alt=""><b class="mono">${esc(room.code)}</b><span class="grow"></span>
      <button class="ibtn" data-act="mute" title="효과음">${ic(sfx.muted ? "volume-off" : "volume")}</button><button class="btn sec" data-act="leave">관전 끝내기</button></div>
      ${reconnect}<div class="room">${spectatorBody(room)}</div>`;
  }
  // 준비와 전투 화면은 위 막대 하나에 모든 버튼이 들어 있고, 한 화면에 다 들어온다.
  if (room.phase === "prep") return prepView(room) + reconnect;
  if (room.phase === "combat") return combatView(room) + reconnect;
  const players = room.players.map((p) => `<span class="pchip ${p.id === S.myId ? "me" : "them"}"><i class="dot ${p.connected ? "on" : ""}"></i>${esc(p.name)}${p.id === S.myId ? " (나)" : ""}</span>`).join("");
  let body = "";
  switch (room.phase) {
    case "lobby": body = roomLobbyView(room); break;
    case "result": body = resultView(room); break;
    default: body = `<div class="center-msg">이 웹 버전은 체스판 자동 전투만 지원해요. (${esc(PHASE_NAME[room.phase] ?? room.phase)})</div>`;
  }
  return `<div class="topbar"><img class="mini-logo" src="${esc(logoUrl())}" alt=""><b class="mono">${esc(room.code)}</b><span class="grow"></span>${players}
    <button class="ibtn" data-act="mute" title="효과음">${ic(sfx.muted ? "volume-off" : "volume")}</button><button class="ibtn" data-act="bgm" title="배경 음악">${ic(bgm.on ? "music" : "music-off")}</button><button class="ibtn" data-act="guide" data-tab="flow" title="가이드">${ic("book")}</button>
    ${room.isHost ? `<button class="ibtn" data-act="room-close" data-code="${esc(room.code)}" data-from="room" title="방 닫기">${ic("trash")}</button>` : ""}<button class="btn sec" data-act="leave">나가기</button></div>
    ${reconnect}<div class="room">${body}</div>`;
}

let lastPhaseKey = "";

/**
 * 직전 화면과 비교해서 효과음을 내고 다음 그림의 기준값을 저장한다.
 * (새 기물·무기 반짝임, 진행 링, 골드 숫자는 그릴 때 S.fx의 직전 값과 비교한다.)
 */
function applyFx(room, inRoom) {
  const fx = S.fx;
  const phase = inRoom ? room.phase : "";
  if (phase !== fx.phase) {
    if (phase === "prep") sfx.play("roundStart");
    if (phase === "combat") sfx.play("combatStart");
    if (inRoom) {
      app.classList.add("phase-enter");
      setTimeout(() => app.classList.remove("phase-enter"), 600);
    }
  }
  const mine = phase === "prep" ? room.chess?.me : null;
  if (mine) {
    const cap = room.chess.deployCap;
    const ratio = cap > 0 ? Math.min(1, mine.board.length / cap) : 0;
    // 새로 합쳐진 ★2, 새로 낀 무기, 판이 가득 찬 순간
    const all = [...mine.board, ...mine.bench.filter(Boolean)];
    if (fx.phase === "prep" && all.some((u) => u.star >= 2 && !fx.uids.has(u.uid))) sfx.play("merge");
    else if (fx.phase === "prep" && all.some((u) => u.weapon && fx.uids.has(u.uid) && fx.weapons[u.uid] !== u.weapon)) sfx.play("equip");
    else if (fx.phase === "prep" && fx.ring != null && fx.ring < 1 && ratio >= 1) sfx.play("full");
    fx.ring = ratio;
    fx.gold = mine.gold;
    fx.uids = new Set(all.map((u) => u.uid));
    fx.weapons = Object.fromEntries(all.filter((u) => u.weapon).map((u) => [u.uid, u.weapon]));
    fx.shop = mine.shop.join("|");
    fx.items = new Set([
      ...Object.entries(mine.materials).filter(([, n]) => n > 0).map(([id]) => `material:${id}`),
      ...Object.entries(mine.weapons).filter(([, n]) => n > 0).map(([id]) => `weapon:${id}`),
    ]);
  } else if (phase !== "prep") {
    fx.ring = null;
    fx.gold = null;
    fx.shop = "";
    if (phase !== "combat") { fx.uids = new Set(); fx.weapons = {}; }
  }
  fx.phase = phase;
}
/** 지금 상황에 맞는 배경 음악: 준비·로비는 prep, 전투는 combat, 마지막 라운드·체력이 위태로울 때·결과는 finale. */
function musicScene(room, inRoom) {
  if (!inRoom || !room) return "prep";
  if (room.phase === "result") return "finale";
  const chess = room.chess;
  if (chess && (room.phase === "prep" || room.phase === "combat")) {
    const last = chess.round >= chess.maxRounds - 1;
    const danger = Math.min(chess.hps?.[0] ?? 99, chess.hps?.[1] ?? 99) <= 8;
    if (last || danger) return "finale";
  }
  return ["combat", "battle", "deathmatch"].includes(room.phase) ? "combat" : "prep";
}

function render() {
  const active = document.activeElement;
  const keepFocus = active && active.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
  const room = S.room;
  const inRoom = !!room && S.status !== "idle";
  document.body.classList.toggle("in-lobby", !inRoom); // 리소스 팩의 로비 배경
  bgm.scene(musicScene(room, inRoom));
  // 전투가 시작되면 열려 있던 다시 보기는 닫는다. (판이 두 개 겹치지 않게)
  if (S.modal === "replay" && room?.phase === "combat") S.modal = null;
  // 전투 재생은 화면을 다시 그릴 때만 다시 시작한다.
  stopPlayback();
  const modalScroll = document.querySelector(".modal-body")?.scrollTop ?? 0;
  app.innerHTML = (inRoom ? roomShell(room) : S.quick ? quickView() : S.status === "connecting" ? `<div class="center-msg">접속하는 중...</div>` : lobbyView())
    + (S.modal === "guestroom" && S.guestRoom ? guestRoomModal() : S.modal === "live" ? liveModal() : S.modal === "myrooms" ? myRoomsModal() : S.modal === "guide" ? guideModal() : S.modal === "packs" ? packsModal() : S.modal === "ranking" ? rankingModal() : S.modal === "replay" && S.replay ? replayModal() : "");
  const modalBody = document.querySelector(".modal-body");
  if (modalBody) modalBody.scrollTop = modalScroll;
  if (S.modal === "replay") startReplay();
  else if (inRoom && room.phase === "combat") startPlayback(room);
  if (keepFocus) {
    const el = document.getElementById(keepFocus.id);
    if (el) {
      el.focus();
      try { el.setSelectionRange(keepFocus.start, keepFocus.end); } catch { /* 입력칸이 아니면 무시 */ }
    }
  }
  const phaseKey = room ? `${room.phase}:${room.chess?.round ?? 0}` : "";
  applyFx(room, inRoom);
  if (room?.phase === "result" && lastPhaseKey !== phaseKey) {
    const seat = mySeat();
    const winner = room.result?.winner;
    sfx.play(winner == null ? "click" : winner === seat ? "win" : "lose");
  }
  lastPhaseKey = phaseKey;
  // 빠른 대전으로 들어온 방은 로비에서 자동으로 준비한다.
  if (inRoom && S.autoReady && room.phase === "lobby" && me() && !me().ready) act.ready(true);
  if (inRoom && room.phase !== "lobby") S.autoReady = false;
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

// ---- 빠른 대전 ----

let quickTimer = null;

async function quickMatch() {
  if (S.quick) return;
  update({ message: "" });
  const joined = await api.matchJoin(S.user?.nickname ?? S.name);
  if (joined.error) {
    toast(joined.status === 401 ? "로그인이 필요해요. 로그인하기를 눌러 주세요." : "매칭을 시작할 수 없어요.");
    return;
  }
  if (joined.code) return startQuickRoom(joined.code);
  update({ quick: { ticket: joined.ticket, startedAt: Date.now(), waiting: joined.waiting } });
  clearInterval(quickTimer);
  quickTimer = setInterval(async () => {
    if (!S.quick) return clearInterval(quickTimer);
    const status = await api.matchPoll(S.quick.ticket);
    if (status.error) {
      clearInterval(quickTimer);
      update({ quick: null });
      toast("매칭이 끊겼어요. 다시 시도해 주세요.");
    } else if (status.code) {
      clearInterval(quickTimer);
      startQuickRoom(status.code);
    } else {
      S.quick.waiting = status.waiting;
    }
  }, 1500);
}

function startQuickRoom(code) {
  update({ quick: null });
  join(code);
  S.autoReady = true; // join()이 먼저 비우므로 그 뒤에 켠다
}

async function cancelQuick() {
  clearInterval(quickTimer);
  const ticket = S.quick?.ticket;
  update({ quick: null });
  if (ticket) await api.matchCancel(ticket);
}

async function createRoom() {
  update({ creating: true, message: "" });
  const result = await api.createRoom(false, S.mobius);
  update({ creating: false });
  if (result.code) join(result.code);
  else if (result.status === 401) toast("로그인이 필요해요. 로그인하기를 눌러 주세요.");
  else toast("방을 만들 수 없어요.");
}

document.addEventListener("click", (event) => {
  const el = event.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const d = el.dataset;
  if (d.act.startsWith("replay-") && d.act !== "replay-match") { replayAction(d.act, d); return; }
  // 조합 방식: 아이템 둘을 차례로 눌러 합친다.
  if (S.combineMode && d.kind && (d.act === "smelt" || d.act === "pick-weapon")) {
    const item = { kind: d.kind, id: d.id };
    if (!S.combineFirst) update({ combineFirst: item });
    else {
      sfx.play("combine");
      act.combine(S.combineFirst, item);
      update({ combineFirst: null });
    }
    return;
  }
  const SFX = { buy: "buy", market: "buy", smelt: "buy", sell: "sell", "sell-sel": "sell", cell: "place", auto: "place", done: "ready", ready: "ready", reroll: "click", "pick-weapon": "click", "bench-slot": "click" };
  if (SFX[d.act]) sfx.play(SFX[d.act]);
  switch (d.act) {
    case "create": createRoom(); break;
    case "mute": sfx.toggle(); render(); break;
    case "sel-close": update({ selUid: null }); break;
    case "combine-mode": update({ combineMode: !S.combineMode, combineFirst: null }); break;
    case "bgm": bgm.toggle(); render(); break;
    case "create-guest": createGuestRoom(); break;
    case "live": openLive(); break;
    case "myrooms": openMyRooms(); break;
    case "myrooms-clear": closeAllMyRooms(); break;
    case "room-close": closeRoom(d.code, d.from); break;
    case "live-refresh": refreshLive(); break;
    case "live-watch": update({ modal: null }); join(d.code, "", true); break;
    case "guestroom-play": update({ modal: null }); join(d.code); break;
    case "guestroom-watch": update({ modal: null }); join(d.code, "", true); break;
    case "watch": join(S.watchCode ?? "", "", true); break;
    case "copy-watch": copyWatchLink(d.code); break;
    case "rewatch": {
      const keys = Object.keys(S.sessionRounds).map(Number).sort((a, b) => a - b);
      if (keys.length) openReplay([S.sessionRounds[keys[keys.length - 1]]], mySeat() ?? 0, "지난 전투 다시 보기");
      break;
    }
    case "rewatch-all": {
      const rounds = Object.keys(S.sessionRounds).map(Number).sort((a, b) => a - b).map((k) => S.sessionRounds[k]);
      openReplay(rounds, mySeat() ?? 0, "이번 판 전투 다시 보기");
      S.replay && (S.replay.idx = 0);
      break;
    }
    case "replay-match": openMatchReplay(d.id); break;
    case "quick": quickMatch(); break;
    case "quick-cancel": cancelQuick(); break;
    case "join-code": join(d.code, S.botLevel); break;
    case "ranking": openRanking(); break;
    case "guide": openGuide(d.tab); break;
    case "packs": update({ modal: "packs" }); break;
    case "pack-guide":
      update({ modal: "guide", guideTab: "packs", guidePack: d.id });
      requestAnimationFrame(() => document.getElementById(`pack-${d.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
      break;
    case "guide-tab": update({ guideTab: d.tab }); break;
    case "close-modal": update({ modal: null }); break;
    case "logout": refreshUser(); break;
    case "linked-logout":
      // GL 연결 서버: 이 서버의 세션 쿠키만 지운다 (GL 계정 로그아웃은 account.officialgl.com)
      fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).finally(refreshUser);
      break;
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
    case "gene": if (S.selUid && d.to) act.gene(S.selUid, d.to); break;
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

document.addEventListener("change", (event) => {
  if (event.target.id === "mobius") {
    S.mobius = event.target.checked;
    store("edbot.mobius", S.mobius ? "1" : "0");
    return;
  }
  if (event.target.id === "botlevel") {
    S.botLevel = event.target.value;
    store("edbot.botLevel", S.botLevel);
  }
});

async function copyWatchLink(code) {
  const link = `${location.origin}/?watch=${code}`;
  try {
    await navigator.clipboard.writeText(link);
    toast("관전 링크를 복사했어요. 보내 주세요!");
  } catch {
    toast(link);
  }
}

document.addEventListener("input", (event) => {
  const id = event.target.id;
  if (id === "gid") {
    const cleaned = event.target.value.replace(/\D/g, "").slice(0, 10);
    if (cleaned !== event.target.value) event.target.value = cleaned;
    S.guest.studentId = cleaned;
  }
  if (id === "gname") S.guest.name = event.target.value;
  if (id === "gcode") {
    const cleaned = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    if (cleaned !== event.target.value) event.target.value = cleaned;
    S.guestCode = cleaned;
  }
  if (event.target.id === "scrub") replayScrub(event.target.value);
  if (event.target.id === "watch") {
    const cleaned = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    if (cleaned !== event.target.value) event.target.value = cleaned;
    S.watchCode = cleaned;
  }
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
  if (form.dataset.form === "watch") join(S.watchCode ?? "", "", true);
  if (form.dataset.form === "guest") joinAsGuest();
});

// 드래그: 기물은 판·대기석·판매 칸·무기 보관함으로, 무기는 기물 위로, 재료는 재련대로 끌어다 놓는다.
let drag = null; // { kind: "unit" | "weapon" | "material", id }

/** 끌고 있는 것이 이 칸에 놓일 수 있는가 */
function accepts(kind, zoneKind) {
  if (kind === "unit") return ["cell", "bench", "sell", "inventory"].includes(zoneKind);
  if (kind === "weapon") return ["cell", "bench", "combine"].includes(zoneKind);
  if (kind === "material") return ["smelter", "combine"].includes(zoneKind);
  return false;
}

const clearDragOver = () => document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));

document.addEventListener("dragstart", (event) => {
  const el = event.target.closest?.("[data-drag]");
  if (!el) return;
  drag = { kind: el.dataset.drag, id: el.dataset.id ?? el.dataset.uid };
  event.dataTransfer.setData("text/plain", `${drag.kind}:${drag.id}`);
  event.dataTransfer.effectAllowed = "move";
  el.classList.add("dragging");
  sfx.play("pickup");
});
document.addEventListener("dragend", (event) => {
  drag = null;
  event.target.classList?.remove("dragging");
  clearDragOver();
});
document.addEventListener("dragover", (event) => {
  if (!drag) return;
  const zone = event.target.closest?.("[data-drop]");
  if (zone && accepts(drag.kind, zone.dataset.drop)) event.preventDefault();
});
document.addEventListener("dragenter", (event) => {
  if (!drag) return;
  const zone = event.target.closest?.("[data-drop]");
  clearDragOver();
  if (zone && accepts(drag.kind, zone.dataset.drop)) zone.classList.add("drag-over");
  // 아이템 위로 끌고 가면 합친 결과를 미리 보여 준다.
  if (zone?.dataset.drop === "combine") {
    const hint = document.getElementById("combine-hint");
    const target = { kind: zone.dataset.kind, id: zone.dataset.id };
    const result = combineItems({ kind: drag.kind, id: drag.id }, target, S.catalog);
    if (hint) {
      hint.classList.toggle("ok", !!result);
      hint.innerHTML = result
        ? `${esc(itemName({ kind: drag.kind, id: drag.id }, S.catalog))} + ${esc(itemName(target, S.catalog))} → <b>${esc(itemName(result, S.catalog))}</b>`
        : "이 둘은 합칠 수 없어요";
    }
  }
});
document.addEventListener("drop", (event) => {
  const zone = event.target.closest?.("[data-drop]");
  const item = drag;
  drag = null;
  clearDragOver();
  const mine = S.room?.chess?.me;
  if (!zone || !item || !mine || mine.done || !accepts(item.kind, zone.dataset.drop)) return;
  event.preventDefault();
  const where = zone.dataset.drop;
  if (where === "combine") {
    // 아이템을 다른 아이템 위에 놓으면 합친다.
    sfx.play("combine");
    act.combine({ kind: item.kind, id: item.id }, { kind: zone.dataset.kind, id: zone.dataset.id });
    return;
  }
  if (item.kind === "unit") {
    if (where === "cell") { sfx.play("drop"); act.deploy(item.id, num(zone.dataset.col), num(zone.dataset.row)); }
    else if (where === "sell") act.sell(item.id);
    else if (where === "bench" && mine.board.some((u) => u.uid === item.id)) { sfx.play("drop"); act.bench(item.id); }
    else if (where === "inventory") {
      const unit = mine.board.find((u) => u.uid === item.id) ?? mine.bench.find((u) => u && u.uid === item.id);
      if (unit?.weapon) act.unequip(unit.uid);
      else toast("무기가 없는 기물이에요.");
    }
  } else if (item.kind === "weapon") {
    // 칸이나 대기석 위의 기물에 무기를 낀다. (이미 낀 무기가 있으면 서로 바뀐다)
    const unit = where === "cell"
      ? mine.board.find((u) => u.col === num(zone.dataset.col) && u.row === num(zone.dataset.row))
      : mine.bench[num(zone.dataset.slot)];
    if (unit) act.equip(item.id, unit.uid);
    else toast("무기는 기물 위에 놓아요.");
  } else if (item.kind === "material") {
    sfx.play("smelt");
    act.smelt(item.id);
  }
});

// ---- 시간 표시: 화면을 다시 그리지 않고 글자만 갱신한다 ----

setInterval(() => {
  for (const el of document.querySelectorAll("[data-quick]")) {
    el.textContent = `${Math.floor((Date.now() - Number(el.dataset.quick)) / 1000)}초 · 대기 중 ${S.quick?.waiting ?? 1}명`;
  }
  // 준비 시간이 5초 남으면 1초마다 똑딱 소리
  if (S.room?.phase === "prep" && S.room.phaseEndsAt) {
    const left = Math.ceil((conn.remainingMs(S.room.phaseEndsAt) ?? 0) / 1000);
    if (left > 0 && left <= 5 && left !== S.fx.tick) { S.fx.tick = left; sfx.play("tick"); }
    if (left > 5) S.fx.tick = -1;
  }
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

async function refreshServer() {
  try {
    S.server = await api.server();
  } catch {
    S.server = null;
  }
  if (S.server && S.server.protocol > PROTOCOL_VERSION) toast("서버가 더 새로운 버전이에요. 페이지를 새로고침해 주세요.");
  await loadPacks(); // 엑스퍼트 서버의 팩: 로비 목록, 가이드 "팩" 탭, 리소스(색·그림·소리)
  render();
  document.title = S.server && S.server.env !== "production" ? `${S.server.name} · COMMANDER` : document.title;
}

(async function start() {
  render();
  await refreshServer();
  await refreshUser();
  try {
    const catalog = await api.chessCatalog();
    if (catalog) update({ catalog });
  } catch { /* 가이드를 열 때 다시 시도하지 않아도 게임은 된다 */ }
  // 주소의 ?room=ABCD 로 바로 들어갈 수 있다.
  const params = new URLSearchParams(location.search);
  if (params.get("watch")) join(params.get("watch"), "", true);
  else if (params.get("room")) join(params.get("room"));
})();

