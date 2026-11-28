// 이 판의 기록 (8전 5승제): 라운드별 승패, 최종 승수, 마지막에 쓴 기물, 레이팅, 라운드별 다시 보기.
// 판이 끝나면(결과 단계) 기록을 잡아 두고, 방이 로비로 돌아가도 창은 닫을 때까지 남는다.
// 지면 먼저 "Checkmate!"가 화면 가득 뜬 뒤 이 기록 창으로 넘어간다.

import { S, mySeat } from "./state.js";
import { token } from "./prep.js";
import { ic } from "./icons.js";
import { REASON_TEXT, esc } from "./util.js";

const BOT_ROOMS = ["ADMN", "ADMF", "ADMX"];

/** 결과 단계의 방에서 기록을 만든다 (레이팅이 늦게 오면 다시 불러 갱신한다) */
export function captureRecord(room) {
  if (S.spectating || room.phase !== "result" || !room.result || !room.chess) return;
  const seat = mySeat();
  if (seat == null) return;
  const names = [0, 1].map((s) => room.players.find((p) => p.seat === s)?.name ?? "?");
  const rounds = room.chess.roundResults ?? Object.values(S.sessionRounds).map((r) => ({ round: r.round, winner: r.winner }));
  const last = Object.keys(S.sessionRounds).map(Number).sort((a, b) => a - b).pop();
  S.record = {
    code: room.code,
    seat,
    names,
    result: room.result,
    rounds,
    winTarget: room.chess.winTarget ?? null,
    roundWins: room.chess.roundWins ?? [0, 0],
    boards: last != null ? S.sessionRounds[last]?.boards ?? null : null,
    bot: BOT_ROOMS.includes(room.code),
  };
}

/** 진 사람에게 "Checkmate!" (화면 가득, 약 2.8초). 화면을 다시 그려도 애니메이션이 처음부터 다시 돌지 않게 body 에 따로 붙인다. */
export function showCheckmate(reason) {
  document.querySelector(".checkmate")?.remove();
  const el = document.createElement("div");
  el.className = "checkmate";
  el.setAttribute("role", "alert");
  el.innerHTML = `<div class="cm-flash"></div><div class="cm-board"></div>
    <div class="cm-king" aria-hidden="true"></div>
    <div class="cm-text">Checkmate!</div>
    <div class="cm-sub">패배 · ${esc(REASON_TEXT[reason] ?? reason ?? "")}</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2900);
}

const OUTCOME = (winner, seat) => (winner == null ? ["무승부", "draw"] : winner === seat ? ["승리", "win"] : ["패배", "loss"]);

export function recordModal() {
  const r = S.record;
  if (!r) return "";
  const { seat, result } = r;
  const [title, cls] = OUTCOME(result.winner, seat);
  const mine = r.roundWins[seat] ?? 0;
  const theirs = r.roundWins[1 - seat] ?? 0;
  const chips = r.rounds.map((x) => {
    const [, c] = OUTCOME(x.winner, seat);
    const label = x.deathmatch ? `DM${x.deathmatch > 1 ? x.deathmatch : ""}` : `R${x.round}`;
    const can = !!S.sessionRounds[x.round];
    const mark = c === "win" ? "승" : c === "loss" ? "패" : "무";
    return `<button class="rchip ${c}${x.deathmatch ? " dm" : ""}" ${can ? `data-act="rewatch-round" data-round="${x.round}" title="${label} 다시 보기"` : "disabled"}>
      <small>${label}</small><b>${mark}</b></button>`;
  }).join("");
  const rating = result.ratings?.[seat];
  const delta = rating ? rating.after - rating.before : 0;
  const ratingLine = rating
    ? `<div class="big ${delta >= 0 ? "good" : "bad"}">레이팅 ${rating.before} → ${rating.after} (${delta >= 0 ? "+" : ""}${delta})</div>`
    : r.bot ? `<div class="sub">봇과 한 판은 레이팅 없이 내 전적에 기록돼요.</div>` : "";
  const myBoard = r.boards?.[seat] ?? [];
  const units = myBoard.length
    ? `<div class="panel"><b>마지막 라운드에 낸 기물</b><div class="rec-units">${myBoard.map((u) => token(u.defId, u.star)).join("")}</div></div>` : "";
  const dm = r.rounds.filter((x) => x.deathmatch).length;
  const target = r.winTarget ? `<div class="sub center">${r.winTarget}승 먼저 · ${r.rounds.length - dm}라운드 진행${dm ? ` + 데스매치 ${dm}번` : ""}</div>` : "";
  return `<div class="modal"><div class="modal-box record"><div class="modal-head"><h2>${ic("list")} 이 판의 기록</h2><button class="btn sec" data-act="close-modal">닫기</button></div>
    <div class="modal-body">
      <div class="rec-head ${cls}"><div class="rtitle">${title}</div><div class="sub big">${esc(REASON_TEXT[result.reason] ?? result.reason)}</div></div>
      <div class="rec-score"><div><small>${esc(r.names[seat])} (나)</small><b class="mine">${mine}</b></div><span>:</span><div><small>${esc(r.names[1 - seat])}</small><b class="theirs">${theirs}</b></div></div>
      ${target}
      <div class="panel"><b>라운드별 결과</b> <span class="sub tiny">누르면 그 라운드를 다시 봐요</span><div class="rchips">${chips || '<span class="sub">라운드 기록이 없어요</span>'}</div></div>
      ${ratingLine}${units}
      <div class="row center"><button class="btn sec" data-act="rewatch-all">▶ 전체 다시 보기</button><button class="btn sec" data-act="ranking">${ic("trophy")} 내 전적</button></div>
    </div></div></div>`;
}
