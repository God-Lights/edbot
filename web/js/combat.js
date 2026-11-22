// 전투 단계: 서버가 기록한 전투를 8x8 판에서 재생한다. 내 쪽이 항상 아래에 보인다.

import { header, token } from "./prep.js";
import { sfx } from "./sfx.js";
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

/** 8x8 판과 기물·자원 칸·연출 층. 내용은 playArena가 채운다. */
export function arenaHtml(combat, seat) {
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
  return `<div class="arena-wrap"><div class="arena" id="arena">${cells}${units}
    <svg class="fx" viewBox="0 0 ${BOARD} ${BOARD}" preserveAspectRatio="none">${tiles}<g id="lines"></g></svg>
    <div class="fxlayer" id="fxlayer"></div>
    <div class="sd" id="sd" style="display:none">돌발 사망!</div>
    <div class="banner" id="banner" style="display:none"></div></div></div>`;
}

export function teamPanels(combat, seat) {
  return `${teamList(seat === 0 ? "플레이어 1" : "내 기물", MINE, combat.boards[seat] ?? [])}
    ${teamList(seat === 0 ? "플레이어 2" : "상대 기물", THEIRS, combat.boards[1 - seat] ?? [])}`;
}

export function combatView(room) {
  const chess = room.chess;
  const combat = chess?.combat;
  const seat = mySeat();
  if (!chess || !combat || seat == null) return `<div class="center-msg">전투를 불러오는 중...</div>`;
  const synergies = chess.me?.synergies?.length ? `<div class="sub">${chess.me.synergies.map((id) => `🔗 ${esc(synergyInfo(id)?.nameKo ?? id)}`).join(" ")}</div>` : "";
  return `${header(room, chess)}
    <div class="combat">
      ${arenaHtml(combat, seat)}
      <div class="side">
        ${teamList("내 기물", MINE, combat.boards[seat] ?? [])}
        ${teamList("상대 기물", THEIRS, combat.boards[1 - seat] ?? [])}
        ${synergies}
      </div>
    </div>`;
}

let runId = 0;

/** 화면을 그린 뒤 부른다. 매 프레임 기물 위치를 갱신한다. */
export function playArena(combat, seat, getPos) {
  const myRun = ++runId;
  const arena = document.getElementById("arena");
  if (!combat || !arena) return;
  const els = [...arena.querySelectorAll(".au")];
  const tileEls = [...arena.querySelectorAll(".atile")];
  const lines = arena.querySelector("#lines");
  const banner = arena.querySelector("#banner");
  const flip = (x, y) => (seat === 0 ? [x, y] : [BOARD - 1 - x, BOARD - 1 - y]);
  const fxlayer = arena.querySelector("#fxlayer");
  const sd = arena.querySelector("#sd");
  let spawned = null; // 마지막으로 연출을 낸 박자
  let bannerSounded = false;
  let sdSounded = false;

  /** 판 위(칸 좌표)에 떠오르는 글자 */
  const floatText = (cx, cy, text, cls) => {
    const el = document.createElement("div");
    el.className = `float ${cls}`;
    el.textContent = text;
    el.style.left = `${(cx + 0.5) * 12.5}%`;
    el.style.top = `${(cy + 0.15) * 12.5}%`;
    fxlayer.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  };
  const ring = (cx, cy, color) => {
    const el = document.createElement("div");
    el.className = "ring";
    el.style.left = `${(cx + 0.5) * 12.5}%`;
    el.style.top = `${(cy + 0.5) * 12.5}%`;
    el.style.borderColor = color;
    fxlayer.appendChild(el);
    setTimeout(() => el.remove(), 700);
  };
  const flash = (i, cls) => {
    const el = els[i];
    if (!el) return;
    el.classList.remove("hit", "heal");
    void el.offsetWidth;
    el.classList.add(cls);
  };

  /** 공격하는 기물이 대상 쪽으로 살짝 몸을 내밀었다가 돌아온다. */
  const lunge = (from, to, j) => {
    const a = combat.frames[j]?.[from];
    const b = combat.frames[j]?.[to] ?? combat.frames[j + 1]?.[to];
    const tok = els[from]?.querySelector(".token");
    if (!a || !b || !tok || !tok.animate) return;
    const [ax, ay] = flip(a[0], a[1]);
    const [bx, by] = flip(b[0], b[1]);
    const dx = Math.sign(bx - ax) * 22;
    const dy = Math.sign(by - ay) * 22;
    tok.animate([{ transform: "translate(0,0)" }, { transform: `translate(${dx}%, ${dy}%)`, offset: 0.4 }, { transform: "translate(0,0)" }], { duration: 260, easing: "ease-out" });
  };

  /** k박자에서 k+1박자로 넘어가는 순간의 연출과 소리: 피해 숫자, 회복, 능력, 쓰러짐, 승급, 채굴 */
  const spawnBeat = (j) => {
    if (j < 0 || j >= combat.beats) return;
    let hits = 0;
    combat.units.forEach((u, i) => {
      const a = combat.frames[j]?.[i];
      const b = combat.frames[j + 1]?.[i];
      if (!a || !b || (a[5] & 1) === 0) return;
      const delta = b[2] - a[2];
      const [x, y] = flip(a[0], a[1]);
      if (delta <= -1) {
        floatText(x, y, `-${Math.round(-delta)}`, u.seat === seat ? "dmg mine" : "dmg theirs");
        flash(i, "hit");
        hits += 1;
      } else if (delta >= 1) {
        floatText(x, y, `+${Math.round(delta)}`, "heal");
        flash(i, "heal");
      }
    });
    if (hits > 0) sfx.play("hit");
    for (const e of combat.events) {
      if (e[0] !== j + 1) continue;
      const a = combat.frames[j]?.[e[2]] ?? combat.frames[j + 1]?.[e[2]];
      const [x, y] = a ? flip(a[0], a[1]) : [0, 0];
      if (e[1] === "attack" && e[3] >= 0) lunge(e[2], e[3], j);
      if (e[1] === "ability" && a) { ring(x, y, "#b040be"); sfx.play("ability"); }
      else if (e[1] === "death") sfx.play("death");
      else if (e[1] === "promote" && a) { floatText(x, y, "♛ 승급!", "promo"); sfx.play("promote"); }
      else if (e[1] === "mine") {
        const tile = combat.tiles[e[3]];
        if (tile) {
          const [tx, ty] = flip(tile.x, tile.y);
          floatText(tx, ty, `+${materialInfo(e[4])?.nameKo ?? "재료"}`, "mine-get");
          sfx.play("mine");
        }
      }
    }
  };

  const tick = () => {
    if (myRun !== runId || !arena.isConnected) return;
    const pos = Math.min(Math.max(getPos(), 0), combat.beats);
    const k = Math.floor(pos);
    const mined = minedTiles(combat, k);
    // 새로 넘어간 박자마다 연출을 낸다. (탭이 가려졌다 돌아와서 많이 밀렸으면 건너뛴다)
    if (spawned === null) spawned = k - 1;
    if (k - spawned > 3) spawned = k - 1;
    while (spawned < k && pos < combat.beats) { spawned += 1; spawnBeat(spawned); }
    sd.style.display = k + 1 >= 20 && pos < combat.beats ? "" : "none";
    if (k + 1 >= 20 && !sdSounded) { sdSounded = true; sfx.play("suddenDeath"); }

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
      el.firstElementChild.style.scale = dying ? String(0.55 + 0.45 * Math.max(0, 1 - (pos - k))) : "1";
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
      if (!bannerSounded) { bannerSounded = true; sfx.play(win == null ? "click" : win === seat ? "roundWin" : "roundLose"); }
    } else {
      banner.style.display = "none";
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** 서버 시계에 맞춰 재생한다 (전투 단계). 서버는 전투 단계를 (박자 수 + 3)칸으로 나눠서, 앞 1칸은 준비, 뒤 2칸은 마무리다. */
export function startPlayback(room) {
  const combat = room.chess?.combat;
  const seat = mySeat() ?? 0; // 관전자는 seat 0이 아래에 보인다
  if (!combat) return;
  const duration = (room.phaseEndsAt ?? 0) - room.phaseStartedAt;
  const beatMs = duration / (combat.beats + 3);
  playArena(combat, seat, () => {
    const remaining = conn.remainingMs(room.phaseEndsAt);
    return beatMs > 0 ? (duration - (remaining ?? 0)) / beatMs - 1 : 0;
  });
}

export function stopPlayback() { runId += 1; }
