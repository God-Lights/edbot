// 다시 보기: 서버가 기록한 전투를 내 시계로 재생한다. (일시정지, 속도, 라운드 선택, 되감기)

import { api } from "./api.js";
import { arenaHtml, playArena, teamPanels } from "./combat.js";
import { S, toast, update } from "./state.js";
import { esc } from "./util.js";

/** rounds: 라운드 기록 배열, seat: 내 쪽(아래에 보이는 쪽), title: 제목 */
export function openReplay(rounds, seat, title = "전투 다시 보기") {
  if (!rounds.length) return toast("다시 볼 전투가 없어요.");
  update({ modal: "replay", replay: { rounds, seat, title, idx: rounds.length - 1, speed: 1, playing: true, base: 0, t0: performance.now() } });
}

/** 끝난 판(랭킹의 내 전적)의 다시 보기를 서버에서 불러와 연다. */
export async function openMatchReplay(matchId) {
  const data = await api.replay(matchId);
  if (!data) return toast("이 판의 다시 보기 기록이 없어요. (이 기능이 생기기 전의 판이에요)");
  const seat = S.user ? Math.max(0, data.players.findIndex((p) => p.name === S.user.nickname)) : 0;
  const names = data.players.map((p) => p.name).join(" vs ");
  openReplay(data.rounds, seat, `${names} · 전투 다시 보기`);
  S.replay.idx = 0;
}

const position = (r) => (r.playing ? r.base + ((performance.now() - r.t0) / 1000) * r.speed : r.base);

function setRound(idx) {
  const r = S.replay;
  Object.assign(r, { idx, base: 0, t0: performance.now(), playing: true });
  update();
}

export function replayAction(act, d) {
  const r = S.replay;
  if (!r) return;
  switch (act) {
    case "replay-round": setRound(Number(d.i)); break;
    case "replay-toggle": {
      const now = position(r);
      r.base = now;
      r.t0 = performance.now();
      r.playing = !r.playing;
      update();
      break;
    }
    case "replay-restart": setRound(r.idx); break;
    case "replay-speed": {
      r.base = position(r);
      r.t0 = performance.now();
      r.speed = Number(d.v);
      update();
      break;
    }
    case "replay-next": if (r.idx < r.rounds.length - 1) setRound(r.idx + 1); break;
    default: break;
  }
}

/** 슬라이더를 끌 때: 화면을 다시 그리지 않고 위치만 바꾼다. */
export function replayScrub(value) {
  const r = S.replay;
  if (!r) return;
  r.base = Number(value) / 10;
  r.t0 = performance.now();
  r.playing = false;
}

export function replayModal() {
  const r = S.replay;
  const combat = r.rounds[r.idx];
  const tabs = r.rounds
    .map((c, i) => {
      const win = c.winner == null ? "·" : c.winner === r.seat ? "승" : "패";
      return `<button class="tab${i === r.idx ? " on" : ""}" data-act="replay-round" data-i="${i}">R${c.round ?? i + 1} ${win}</button>`;
    })
    .join("");
  const speeds = [0.5, 1, 2, 4].map((v) => `<button class="btn sec${r.speed === v ? " on" : ""}" data-act="replay-speed" data-v="${v}">${v}×</button>`).join("");
  return `<div class="modal"><div class="modal-box replay"><div class="modal-head"><h2>${esc(r.title)}</h2><button class="btn sec" data-act="close-modal">닫기</button></div>
    <div class="tabs">${tabs}</div>
    <div class="combat">${arenaHtml(combat, r.seat)}<div class="side">${teamPanels(combat, r.seat)}
      <div class="panel"><div class="sub">이 라운드: ${combat.winner == null ? "무승부" : combat.winner === r.seat ? "승리" : "패배"}</div></div></div></div>
    <div class="row controls">
      <button class="btn sec" data-act="replay-toggle">${r.playing ? "⏸ 일시정지" : "▶ 재생"}</button>
      <button class="btn sec" data-act="replay-restart">⏮ 처음부터</button>
      <input id="scrub" type="range" min="0" max="${combat.beats * 10}" value="0" class="scrub">
      ${speeds}
      ${r.idx < r.rounds.length - 1 ? `<button class="btn sec" data-act="replay-next">다음 라운드 ⏭</button>` : ""}
    </div></div></div>`;
}

/** 화면을 그린 뒤 부른다. */
export function startReplay() {
  const r = S.replay;
  if (!r) return;
  const combat = r.rounds[r.idx];
  const scrub = document.getElementById("scrub");
  let advanced = false;
  playArena(combat, r.seat, () => {
    const pos = position(r);
    if (scrub && document.activeElement !== scrub) scrub.value = String(Math.min(combat.beats, pos) * 10);
    // 끝나고 잠깐 보여 준 뒤 다음 라운드로 (재생 중일 때만)
    if (r.playing && !advanced && pos > combat.beats + 1.5 && r.idx < r.rounds.length - 1) {
      advanced = true;
      setTimeout(() => { if (S.replay === r && S.modal === "replay") setRound(r.idx + 1); }, 0);
    }
    return pos;
  });
}
