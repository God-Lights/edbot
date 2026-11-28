// 랭킹 모달: 순위, 내 전적, 최근 판.

import { api } from "./api.js";
import { S, update } from "./state.js";
import { esc } from "./util.js";

export async function openRanking() {
  update({ modal: "ranking", ranking: { loading: true } });
  try {
    const entries = await api.leaderboard(20);
    if (!Array.isArray(entries)) {
      update({ ranking: { error: entries?.error === 503 ? "랭킹 서버가 아직 준비되지 않았어요. 잠시 뒤에 다시 시도해 주세요." : "랭킹을 불러오지 못했어요." } });
      return;
    }
    const stats = S.user ? await api.myStats() : null;
    const matches = S.user ? await api.myMatches(10) : [];
    update({ ranking: { entries, stats, matches } });
  } catch {
    update({ ranking: { error: "랭킹을 불러오지 못했어요." } });
  }
}

const RESULT = { win: ["승", "good"], loss: ["패", "bad"], draw: ["무", ""] };

export function rankingModal() {
  const r = S.ranking ?? { loading: true };
  let body;
  if (r.loading) body = `<div class="panel">불러오는 중...</div>`;
  else if (r.error) body = `<div class="panel warn">${esc(r.error)}</div>`;
  else {
    const stats = r.stats
      ? `<div class="panel"><b>${esc(r.stats.nickname)}</b> · 레이팅 <b>${r.stats.rating}</b> · ${r.stats.rank}위 · ${r.stats.games}전 ${r.stats.wins}승 ${r.stats.losses}패 ${r.stats.draws}무 (승률 ${r.stats.games ? Math.round((r.stats.wins / r.stats.games) * 100) : 0}%)</div>`
      : S.user ? `<div class="panel sub">아직 한 판도 안 했어요.</div>` : `<div class="panel sub">로그인하면 내 전적도 볼 수 있어요.</div>`;
    const rows = r.entries.map((e) => `<tr class="${e.isMe ? "me" : ""}"><td>${e.rank}</td><td>${esc(e.nickname)}</td><td>${e.rating}</td><td>${e.games}</td><td>${e.wins}/${e.losses}/${e.draws}</td></tr>`).join("");
    const recent = (r.matches ?? []).map((m) => {
      const [t, c] = RESULT[m.result] ?? [m.result, ""];
      const delta = m.ratingAfter - m.ratingBefore;
      // 봇과 한 판은 레이팅 없이 기록만 (rated: false)
      const change = m.rated === false ? `<span class="sub tiny">봇 · 레이팅 없음</span>` : `${delta >= 0 ? "+" : ""}${delta}`;
      return `<tr><td class="${c}">${t}</td><td>${esc(m.opponent)}</td><td>${change}</td><td class="sub tiny">${m.score?.[0] ?? ""}${m.score ? ` : ${m.score[1]}` : ""}</td>
        <td>${m.id ? `<button class="btn sec" data-act="replay-match" data-id="${esc(m.id)}">▶ 다시 보기</button>` : ""}</td></tr>`;
    }).join("");
    body = `${stats}<div class="panel"><table class="tbl"><thead><tr><th>#</th><th>이름</th><th>레이팅</th><th>판</th><th>승/패/무</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="sub">아직 기록이 없어요.</td></tr>`}</tbody></table></div>
      ${recent ? `<div class="panel"><b>최근 판</b><table class="tbl"><tbody>${recent}</tbody></table></div>` : ""}`;
  }
  return `<div class="modal"><div class="modal-box"><div class="modal-head"><h2>랭킹</h2><button class="btn sec" data-act="close-modal">닫기</button></div><div class="modal-body">${body}</div></div></div>`;
}
