// 전투 단계: 서버가 기록한 전투를 8x8 판에서 재생한다. 내 쪽이 항상 아래에 보인다.

import { header, token } from "./prep.js";
import { S, conn, materialInfo, mySeat, synergyInfo } from "./state.js";
import { BOARD, DEPLOY_ROWS, MINE, RARITY_COLOR, THEIRS, esc } from "./util.js";

/** 박자 위치(소수)에서 기물 i의 모습. 두 박자 사이는 위치·체력만 부드럽게 잇는다. */
export function interpolated(combat, position, index) {
  const last = Math.max(0, combat.frames.length - 1);
  const clamped = Math.min(Math.max(position, 0), last);
  const k = Math.min(Math.floor(clamped), last);
  const a = combat.frames[k]?.[index];
  if (!a) return null; // 아직 나타나지 않은 소환수
  const unit = (v) => ({ x: v[0], y: v[1], hp: v[2], energy: v[3], shield: v[4], alive: (v[5] & 1) !== 0 });
  const A = unit(a);
  const b = k < last ? combat.frames[k + 1]?.[index] : null;
  if (!b) return A;
  const B = unit(b);
  if (!A.alive || !B.alive) return A;
  const t = clamped - k;
  const mix = (p, q) => p + (q - p) * t;
  return { x: mix(A.x, B.x), y: mix(A.y, B.y), hp: mix(A.hp, B.hp), energy: mix(A.energy, B.energy), shield: mix(A.shield, B.shield), alive: true };
}

export function minedTiles(combat, beat) {
  return new Set(combat.mines.filter((m) => m[0] <= beat).map((m) => m[1]));
}

function teamList(title, color, placements) {
  const body = placements.length
    ? `<div class="team">${placements.map((p) => `<div class="mini">${token(p.defId, p.star, { tint: color, armed: !!p.weapon })}</div>`).join("")}</div>`
    : `<div class="sub">없음</div>`;
  return `<div class="panel"><b style="color:${color}">${title}</b>${body}</div>`;
}

export function combatView(room) {
  const chess = room.chess;
  const combat = chess?.combat;
  const seat = mySeat();
  if (!chess || !combat || seat == null) return `<div class="center-msg">전투를 불러오는 중...</div>`;
  let cells = "";
  for (let row = 0; row < BOARD; row++) {
    for (let col = 0; col < BOARD; col++) {
      cells += `<div class="acell ${(row + col) % 2 ? "dark" : ""} ${row >= BOARD - DEPLOY_ROWS ? "mine" : "theirs"}"></div>`;
    }
  }
  const units = combat.units
    .map((u, i) => `<div class="au" data-i="${i}" style="display:none">${token(u.defId, u.star, { tint: u.seat === seat ? MINE : THEIRS, armed: !!u.weapon })}
      <div class="ubar"><i class="shield"></i><div><b style="background:${u.seat === seat ? MINE : THEIRS}"></b></div></div></div>`)
    .join("");
  const tiles = combat.tiles
    .map((t, i) => `<text class="atile" data-t="${i}" fill="${RARITY_COLOR[materialInfo(t.material)?.rarity ?? "common"]}" text-anchor="middle" dominant-baseline="central" font-size="0.55">◆</text>`)
    .join("");
  const synergies = chess.me?.synergies?.length ? `<div class="sub">${chess.me.synergies.map((id) => `🔗 ${esc(synergyInfo(id)?.nameKo ?? id)}`).join(" ")}</div>` : "";
  return `${header(room, chess)}
    <div class="combat">
      <div class="arena-wrap"><div class="arena" id="arena">${cells}${units}
        <svg class="fx" viewBox="0 0 ${BOARD} ${BOARD}" preserveAspectRatio="none">${tiles}<g id="lines"></g></svg>
        <div class="banner" id="banner" style="display:none"></div></div></div>
      <div class="side">
        ${teamList("내 기물", MINE, combat.boards[seat] ?? [])}
        ${teamList("상대 기물", THEIRS, combat.boards[1 - seat] ?? [])}
        ${synergies}
      </div>
    </div>`;
}

let runId = 0;

/** 화면을 그린 뒤 부른다. 매 프레임 기물 위치를 갱신한다. */
export function startPlayback(room) {
  const myRun = ++runId;
  const combat = room.chess?.combat;
  const seat = mySeat();
  const arena = document.getElementById("arena");
  if (!combat || seat == null || !arena) return;
  const els = [...arena.querySelectorAll(".au")];
  const tileEls = [...arena.querySelectorAll(".atile")];
  const lines = arena.querySelector("#lines");
  const banner = arena.querySelector("#banner");
  const flip = (x, y) => (seat === 0 ? [x, y] : [BOARD - 1 - x, BOARD - 1 - y]);
  const duration = (room.phaseEndsAt ?? 0) - room.phaseStartedAt;
  const beatMs = duration / (combat.beats + 3);

  const tick = () => {
    if (myRun !== runId || !arena.isConnected) return;
    const remaining = conn.remainingMs(room.phaseEndsAt);
    const elapsed = duration - (remaining ?? 0);
    const pos = beatMs > 0 ? Math.min(Math.max(elapsed / beatMs - 1, 0), combat.beats) : 0;
    const k = Math.floor(pos);
    const mined = minedTiles(combat, k);

    combat.units.forEach((u, i) => {
      const el = els[i];
      const f = interpolated(combat, pos, i);
      if (!f || !f.alive) { el.style.display = "none"; return; }
      const [x, y] = flip(f.x, f.y);
      el.style.display = "";
      el.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
      const next = combat.frames[k + 1]?.[i];
      const dying = next && (next[5] & 1) === 0;
      el.style.opacity = dying ? String(Math.max(0, 1 - (pos - k))) : "1";
      el.querySelector(".ubar b").style.width = `${u.maxHp > 0 ? Math.min(100, Math.max(0, (f.hp / u.maxHp) * 100)) : 0}%`;
      el.querySelector(".ubar .shield").style.display = f.shield > 0 ? "block" : "none";
    });
    combat.tiles.forEach((t, i) => {
      const [x, y] = flip(t.x, t.y);
      tileEls[i].setAttribute("x", x + 0.5);
      tileEls[i].setAttribute("y", y + 0.5);
      tileEls[i].style.display = mined.has(i) ? "none" : "";
    });

    // 이번 박자의 공격과 능력을 선으로
    let svg = "";
    if (pos < combat.beats) {
      const fade = 1 - (pos - k);
      for (const e of combat.events) {
        if (e[0] !== k + 1 || (e[1] !== "attack" && e[1] !== "ability") || e[3] < 0) continue;
        const a = interpolated(combat, pos, e[2]);
        const b = interpolated(combat, pos, e[3]);
        if (!a || !b) continue;
        const [ax, ay] = flip(a.x, a.y);
        const [bx, by] = flip(b.x, b.y);
        svg += `<line x1="${ax + 0.5}" y1="${ay + 0.5}" x2="${bx + 0.5}" y2="${by + 0.5}" stroke="${e[1] === "ability" ? "#b040be" : "#fff"}" stroke-width="${e[1] === "ability" ? 0.09 : 0.05}" opacity="${(fade * 0.8).toFixed(2)}"/>`;
      }
    }
    lines.innerHTML = svg;

    if (pos >= combat.beats) {
      const win = combat.winner;
      banner.style.display = "";
      banner.textContent = win == null ? "무승부" : win === seat ? "라운드 승리" : "라운드 패배";
      banner.style.color = win == null ? "#d1d1d6" : win === seat ? "#6bd98c" : "#ff7566";
    } else {
      banner.style.display = "none";
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function stopPlayback() { runId += 1; }
