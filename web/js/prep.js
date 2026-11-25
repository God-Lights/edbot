// 준비 단계 화면: 판, 대기석, 상점, 자원 패널. HTML 문자열을 만들고, 클릭/드래그는 main.js가 한꺼번에 처리한다.

import { ic } from "./icons.js";
import { itemName } from "./crafting.js";
import { S, conn, materialInfo, mySeat, synergyInfo, unitInfo, weaponInfo } from "./state.js";
import { bgm, sfx } from "./sfx.js";
import {
  BOARD, COST_COLOR, DEPLOY_ROWS, PHASE_NAME, PIECE_COLOR, PIECE_NAME, RARITY_COLOR, RARITY_NAME, START_HP, countdown, esc, sellValue, starText,
} from "./util.js";

/** 기물 하나: 아이콘, 이름, 별. */
export function token(defId, star, opts = {}) {
  const info = unitInfo(defId);
  const piece = info?.piece ?? "pawn";
  // 테두리와 바탕은 가격 색. tint(전투의 편 색)는 아래쪽 띠로 보여 준다.
  const border = COST_COLOR[info?.cost ?? 1];
  const drag = opts.uid ? ` data-uid="${esc(opts.uid)}" data-drag="unit" draggable="true"` : "";
  // 새로 생긴 기물은 튀어나오고(★2는 반짝), 무기가 새로 끼워진 기물은 번쩍인다.
  let fx = "";
  if (opts.uid && S.fx.phase === "prep") {
    if (!S.fx.uids.has(opts.uid)) fx += star >= 2 ? " pop merge" : " pop";
    else if (opts.armed && S.fx.weapons[opts.uid] !== opts.weapon) fx += " equipflash";
  }
  return `<div class="token${opts.selected ? " sel" : ""}${fx}${opts.tint ? " sided" : ""}" style="--pc:${PIECE_COLOR[piece]};--bc:${border}${opts.tint ? `;--tc:${opts.tint}` : ""}"${drag}>
    <span class="icon" style="--img:url(assets/pieces/${piece}.png)"></span>
    <span class="nm">${esc(info?.nameKo ?? defId)}</span>
    <span class="star">${starText(star)}</span>${opts.armed ? '<span class="armed" title="무기">${ic("shield")}</span>' : ""}</div>`;
}

/** max: 시작 체력(서버가 규칙 값으로 바꿨으면 chess.startHp). 체력 막대의 기준이다. */
export function hpPill(name, hp, color, max = START_HP) {
  const ratio = Math.min(1, Math.max(0, hp / (max || START_HP)));
  return `<div class="hp"><div class="hp-top"><b>${esc(name)}</b><span>${ic("heart")} ${Math.max(0, hp)}</span></div>
    <div class="hp-bar"><i style="width:${ratio * 100}%;background:${color}"></i></div></div>`;
}

function lastRoundText(last, seat) {
  const outcome = last.winner == null ? "무승부" : last.winner === seat ? "승리" : "패배";
  return `지난 라운드 ${last.round}: ${outcome} · 내 체력 -${last.damage[seat] ?? 0}, 상대 체력 -${last.damage[1 - seat] ?? 0}`;
}

/** 준비와 전투 화면 위쪽: 라운드, 남은 시간, 체력, 항복 */
export function gameBar(room, chess) {
  const seat = mySeat();
  const mine = room.players.find((p) => p.seat === seat)?.name ?? "나";
  const theirs = room.players.find((p) => p.seat !== seat)?.name ?? "상대";
  const last = room.phase === "prep" && chess.lastRound ? lastRoundText(chess.lastRound, seat) : "";
  const opp = chess.opponent && room.phase === "prep"
    ? `<span class="opp-state ${chess.opponent.done ? "good" : ""}" title="상대 ${chess.opponent.boardCount}기 배치">${chess.opponent.done ? "준비 끝" : "준비 중"}</span>` : "";
  const btn = (act, label, title, extra = "") => `<button class="ibtn" data-act="${act}" title="${title}"${extra}>${label}</button>`;
  return `<header class="gbar">
    <div class="gb-side"><b class="mono gb-code">${esc(room.code)}</b>${room.mobius ? `<span class="badge mob" title="무한 모드">${ic("infinity")}</span>` : ""}${hpPill(mine, chess.me?.hp ?? 0, "var(--mine)", chess.startHp)}</div>
    <div class="gb-center"><b>R${chess.round}/${chess.maxRounds}</b>
      <span class="sub gb-timer" data-timer="${room.phaseEndsAt ?? ""}" data-label="${PHASE_NAME[room.phase]}">${PHASE_NAME[room.phase]} ${countdown(conn.remainingMs(room.phaseEndsAt))}</span>
      ${last ? `<span class="gb-last" title="${esc(last)}">${esc(last)}</span>` : ""}</div>
    <div class="gb-side gb-right">${hpPill(theirs, chess.opponent?.hp ?? 0, "var(--theirs)", chess.startHp)}${opp}
      <div class="gb-btns">${btn("mute", ic(sfx.muted ? "volume-off" : "volume"), "효과음")}${btn("bgm", ic(bgm.on ? "music" : "music-off"), "배경 음악")}${btn("guide", ic("book"), "가이드", ' data-tab="flow"')}
        ${room.isHost ? btn("room-close", ic("trash"), "방 닫기", ` data-code="${esc(room.code)}" data-from="room"`) : ""}${btn("surrender", ic("flag"), "항복")}${btn("leave", ic("log-out"), "나가기")}</div></div>
  </header>`;
}
export const header = gameBar;

// ---- 자원 칸 ----

/** 내 판의 칸(col,row)에 있는 자원 칸. seat 1은 판을 180도 돌려서 본다. */
function tileAt(chess, seat, col, row) {
  const x = seat === 0 ? col : BOARD - 1 - col;
  const y = seat === 0 ? BOARD - DEPLOY_ROWS + row : DEPLOY_ROWS - 1 - row;
  return chess.tiles.find((t) => t.x === x && t.y === y);
}

function boardHtml(chess, me, seat) {
  let html = "";
  for (let row = 0; row < DEPLOY_ROWS; row++) {
    for (let col = 0; col < BOARD; col++) {
      const unit = me.board.find((u) => u.col === col && u.row === row);
      const tile = tileAt(chess, seat, col, row);
      const rarity = tile ? materialInfo(tile.material)?.rarity ?? "common" : null;
      const tileHtml = tile
        ? `<div class="tile ${unit ? "under" : ""}" style="--rc:${RARITY_COLOR[rarity]}"><i class="gem"></i>${unit ? "" : `<small>${esc(materialInfo(tile.material)?.nameKo ?? "")}</small>`}</div>`
        : "";
      html += `<div class="cell ${(col + row) % 2 ? "dark" : ""}" data-act="cell" data-drop="cell" data-col="${col}" data-row="${row}"${tile ? ` style="--rc:${RARITY_COLOR[rarity]}"` : ""}>${tileHtml}${
        unit ? token(unit.defId, unit.star, { uid: unit.uid, selected: S.selUid === unit.uid, armed: !!unit.weapon, weapon: unit.weapon }) : ""
      }</div>`;
    }
  }
  return `<div class="board${chess.mobius ? " mobius" : ""}">${html}</div>`;
}

function benchHtml(me, canAuto) {
  const slots = me.bench
    .map((u, i) => `<div class="slot" data-act="bench-slot" data-drop="bench" data-slot="${i}">${
      u ? token(u.defId, u.star, { uid: u.uid, selected: S.selUid === u.uid, armed: !!u.weapon, weapon: u.weapon }) : ""
    }</div>`)
    .join("");
  const hasRewatch = Object.keys(S.sessionRounds).length > 0;
  return `<div class="bench">${slots}
    <button class="slot act${canAuto ? "" : " off"}" data-act="auto" title="대기석의 기물을 알아서 판에 놓아요"${canAuto ? "" : " disabled"}><span>${ic("sparkles")}</span><small>자동</small></button>
    <button class="slot act${hasRewatch ? "" : " off"}" data-act="rewatch" title="지난 전투 다시 보기"${hasRewatch ? "" : " disabled"}><span>${ic("rotate-ccw")}</span><small>지난 전투</small></button></div>`;
}

// ---- 오른쪽 패널 ----

/** 대기석과 판에 있는 같은 캐릭터 ★1 수 (하나 더 사면 ★2가 되는지) */
function ownedCount(me, defId) {
  return [...me.board, ...me.bench.filter(Boolean)].filter((u) => u.defId === defId && u.star === 1).length;
}

/** 상점 바 (롤토체스처럼): 왼쪽에 골드와 새로고침, 오른쪽에 그림 중심 카드 다섯 장. 능력 설명은 마우스를 올리면 보인다. */
function shopHtml(chess, me) {
  const sig = me.shop.join("|");
  // 상점이 통째로 새로 채워졌을 때(새로고침, 새 라운드)만 카드가 차례로 나타난다. 하나를 산 경우는 아니다.
  const deal = S.fx.shop !== "" && S.fx.shop !== sig && me.shop.every(Boolean) ? " deal" : "";
  const bump = S.fx.gold != null && S.fx.gold !== me.gold ? " bump" : "";
  const cards = me.shop
    .map((id, slot) => {
      if (!id) return `<div class="shopcard sold"><span>구매 완료</span></div>`;
      const info = unitInfo(id);
      const cost = info?.cost ?? 0;
      const piece = info?.piece ?? "pawn";
      const owned = ownedCount(me, id);
      const off = me.gold < cost ? " dim" : "";
      const tag = owned >= 2 ? `<span class="own star2">★2 가능</span>` : owned ? `<span class="own">보유 ${owned}</span>` : "";
      return `<button class="shopcard${off}${deal}${owned >= 2 ? " ready" : ""}" data-act="buy" data-slot="${slot}" style="--bc:${COST_COLOR[cost]};--pc:${PIECE_COLOR[piece]};--i:${slot}" title="${esc((info?.nameKo ?? id) + " · " + PIECE_NAME[piece] + " · " + cost + "골드\n" + (info?.abilityText ?? ""))}">
        <span class="art" style="--img:url(assets/pieces/${piece}.png)"></span>
        <span class="ptag">${PIECE_NAME[piece]}</span>${tag}
        <span class="foot"><b>${esc(info?.nameKo ?? id)}</b><span class="cost">${ic("coin")}${cost}</span></span></button>`;
    })
    .join("");
  const names = ["1골드", "2골드", "3골드", "4골드"];
  const odds = chess.shopOdds.map((p, i) => (p > 0 ? `${names[i]} ${p}%` : "")).filter(Boolean).join(" · ");
  return `<div class="shop${coachStep(chess, me)?.n === 1 && showCoach(chess) ? " hl" : ""}">
    <div class="goldcol"><div class="goldbox${bump}"><b>${ic("coin")} ${me.gold}</b><small>다음 +${me.nextIncome}</small></div>
      <button class="rerollbtn" data-act="reroll"${me.gold < me.rerollCost ? " disabled" : ""} title="새로고침 · 등장 확률: ${esc(odds)}">${ic("refresh")} ${ic("coin")}${me.rerollCost}</button></div>
    ${cards}</div>`;
}

/** 상점 등장 확률을 가격 색 칩으로 */
function oddsHtml(chess) {
  return `<div class="odds"><small>상점 등장 확률</small><div>${chess.shopOdds
    .map((p, i) => `<span class="${p > 0 ? "" : "zero"}" style="--bc:${COST_COLOR[i + 1]}">${p}%</span>`).join("")}</div></div>`;
}

const itemLabel = (item) => itemName(item, S.catalog);

function resourceHtml(chess, me) {
  const materials = Object.entries(me.materials).filter(([, n]) => n > 0).sort();
  const weapons = Object.entries(me.weapons).filter(([, n]) => n > 0).sort();
  if (!chess.market.length && !chess.tiles.length && !materials.length && !weapons.length) return "";
  const free = me.smelters.some((s) => s == null);
  const mode = S.combineMode;
  const first = S.combineFirst;
  const chipClass = (kind, id, extra = "") => `chip${extra}${S.fx.items && !S.fx.items.has(`${kind}:${id}`) ? " pop" : ""}${first && first.kind === kind && first.id === id ? " on" : ""}`;
  const tileNames = [...new Set(chess.tiles.map((t) => materialInfo(t.material)?.nameKo ?? t.material))].sort();
  let html = `<div class="res">`;
  if (chess.tiles.length) html += `<div class="rrow rtile" title="칸 위에 기물을 놓거나 걸어가면 재료를 얻어요">◆ 이번 라운드 자원 칸: ${esc(tileNames.join(", "))}</div>`;
  if (chess.market.length) {
    html += `<div class="rrow"><span class="rlabel" title="광물 시장 · 한 라운드에 한 개">${ic("store")}</span>${chess.market
      .map((item, i) => {
        const info = materialInfo(item.material);
        const rarity = info?.rarity ?? "common";
        const on = !me.marketBought && me.gold >= item.price;
        return `<button class="mchip${on ? "" : " dim"}" data-act="market" data-slot="${i}"${on ? "" : " disabled"} style="--rc:${RARITY_COLOR[rarity]}" title="${RARITY_NAME[rarity]} → ${esc(weaponInfo(info?.weaponId)?.nameKo ?? "")}"><i>◆</i>${esc(info?.nameKo ?? item.material)} <b>${me.marketBought ? "✓" : ic("coin") + item.price}</b></button>`;
      })
      .join("")}</div>`;
  }
  if (materials.length) {
    const usable = free || mode;
    html += `<div class="rrow chips"><span class="rlabel" title="재료 · 누르면 재련, 재련대로 끌어 놓아도 돼요 (다른 재료 위로 끌면 조합)">◆</span>${materials
      .map(([id, n]) => {
        const r = materialInfo(id)?.rarity ?? "common";
        return `<button class="${chipClass("material", id, usable ? "" : " dim")}" style="--rc:${RARITY_COLOR[r]}" data-act="smelt" data-id="${esc(id)}" data-kind="material" data-drag="material" data-drop="combine" draggable="true"${usable ? "" : " disabled"}>${esc(materialInfo(id)?.nameKo ?? id)} ×${n}</button>`;
      })
      .join("")}</div>`;
  }
  html += `<div class="rrow smelters"><span class="rlabel" title="재련대 · 재련 중인 무기는 다음 라운드 시작에 완성돼요">${ic("hammer")}</span>${me.smelters
    .map((w, i) => `<div class="smelter${w ? " busy" : ""}" data-drop="smelter" title="재련대 ${i + 1}">${w ? esc(weaponInfo(w)?.nameKo ?? w) : "비어 있음"}</div>`)
    .join("")}</div>`;
  if (!weapons.length && me.board.some((u) => u.weapon)) html += `<div class="rrow emptybox" data-drop="inventory">${ic("shield")} 무기를 뺄 기물을 여기로</div>`;
  if (weapons.length) {
    html += `<div class="rrow chips" data-drop="inventory"><span class="rlabel" title="무기 · 기물 위로 끌어 놓으면 껴요 (누른 뒤 기물을 눌러도 돼요)">${ic("shield")}</span>${weapons
      .map(([id, n]) => {
        const r = weaponInfo(id)?.rarity ?? "common";
        return `<button class="${chipClass("weapon", id, S.selWeapon === id ? " on" : "")}" style="--rc:${RARITY_COLOR[r]}" data-act="pick-weapon" data-id="${esc(id)}" data-kind="weapon" data-drag="weapon" data-drop="combine" draggable="true" title="${esc(weaponInfo(id)?.text ?? "")}">${esc(weaponInfo(id)?.nameKo ?? id)} ×${n}</button>`;
      })
      .join("")}</div>`;
  }
  if (materials.length + weapons.length) {
    html += `<div class="rrow tools"><button class="mini${S.combineMode ? " on" : ""}" data-act="combine-mode" title="아이템 둘을 차례로 눌러 합쳐요 (끌어다 놓아도 돼요)">${ic("flask")} 조합${S.combineMode ? " 중" : ""}</button>
      <button class="mini" data-act="guide" data-tab="recipes">${ic("list")} 도감</button>
      <span class="combine-hint" id="combine-hint">${S.combineFirst ? `<b>${esc(itemLabel(S.combineFirst))}</b>와(과) 합칠 아이템을 누르세요` : "다른 아이템 위로 끌면 합쳐져요"}</span></div>`;
  }
  return html + "</div>";
}

const RING_R = 38;
const RING_C = 2 * Math.PI * RING_R;

/** 판에 올린 기물 수 / 올릴 수 있는 수를 둥근 막대로, 가운데에 코인(골드)을 보여 준다. */
function ringHtml(count, cap, gold) {
  const ratio = cap > 0 ? Math.min(1, count / cap) : 0;
  const prev = S.fx.ring ?? ratio;
  const bump = S.fx.gold != null && S.fx.gold !== gold ? " bump" : "";
  return `<div class="ringbox${count >= cap ? " full" : ""}" title="판에 올린 기물 ${count} / ${cap}">
    <svg viewBox="0 0 100 100"><circle class="trk" cx="50" cy="50" r="${RING_R}"/>
      <circle class="prg" cx="50" cy="50" r="${RING_R}" stroke-dasharray="${RING_C.toFixed(2)}" style="--from:${(RING_C * (1 - prev)).toFixed(2)};--to:${(RING_C * (1 - ratio)).toFixed(2)}"/></svg>
    <div class="mid"><b>${count}/${cap}</b><small>배치</small></div></div>`;
}

const SYN_PIECES = ["king", "queen", "rook", "bishop", "knight", "pawn"];

/** 시너지 단계(필요한 수). 서버 도감에서 읽고, 없으면 기본값. */
function synergySteps(piece) {
  const needs = [...new Set((S.catalog?.synergies ?? []).filter((s) => s.piece === piece).map((s) => s.need))].sort((a, b) => a - b);
  return needs.length ? needs : piece === "pawn" ? [2, 4] : [2, 3];
}

function traitRow(name, count, steps, icon, color, text) {
  const tier = steps.filter((t) => count >= t).length;
  const stepsHtml = steps.map((t) => `<span class="${count >= t ? "on" : ""}">${t}</span>`).join(" · ");
  return `<div class="trait${tier ? " on" : ""}${tier >= 2 ? " max" : ""}" style="--pc:${color}" title="${esc(name + " " + count + "명 · " + (text ?? ""))}">
    <span class="hex">${icon}</span><span class="tt"><b>${esc(name)}</b><small><b>${count}</b> / ${stepsHtml}</small></span></div>`;
}

/** 판 왼쪽 시너지 목록 (롤토체스처럼): 기물 종류마다 육각 아이콘, 이름, 지금 수 / 단계. 켜진 것은 금색이고 위로 온다. */
function traitsHtml(me) {
  const seen = new Set(me.board.map((u) => u.defId));
  const counts = {};
  for (const id of seen) {
    const piece = unitInfo(id)?.piece;
    if (piece) counts[piece] = (counts[piece] ?? 0) + 1;
  }
  const rows = SYN_PIECES.filter((p) => counts[p]).map((p) => {
    const steps = synergySteps(p);
    const tier = steps.filter((t) => counts[p] >= t).length;
    const info = synergyInfo(`${p}-${tier || 1}`);
    return { tier, n: counts[p], html: traitRow(PIECE_NAME[p], counts[p], steps, `<span class="gicon" style="--pc:currentColor;--img:url(assets/pieces/${p}.png)"></span>`, PIECE_COLOR[p], info?.text) };
  });
  // 계보 시너지 "근원" (데보이트 계보)
  const traits = S.catalog?.traits ?? [];
  if (traits.length) {
    const n = [...seen].filter((id) => traits[0].members.includes(id)).length;
    if (n) {
      const steps = traits.map((t) => t.need).sort((a, b) => a - b);
      const tier = steps.filter((t) => n >= t).length;
      rows.push({ tier, n, html: traitRow("근원", n, steps, ic("sparkles"), "#c8aa6e", traits[Math.max(0, tier - 1)]?.text) });
    }
  }
  rows.sort((a, b) => b.tier - a.tier || b.n - a.n);
  return `<div class="traits"><small class="sub">시너지</small>${rows.length ? rows.map((r) => r.html).join("") : `<div class="sub tiny">같은 기물 2명 이상이면 켜져요</div>`}</div>`;
}

/** 데도키온의 진화 진행도: 엔진 탑재율, A-C 코어, 고대조각/재상트 */
function evolutionHtml(me, unit) {
  const evo = S.catalog?.evolution;
  if (!evo || unit.defId !== evo.from) return "";
  const branch = evo.branches.find((b) => unit.weapon && unit.weapon.split(/[+*]/).includes(b.code));
  const e = unit.evo ?? { engine: 0, core: 0 };
  const shards = branch ? Math.min(evo.shardsNeed, me.materials[branch.material] ?? 0) : 0;
  const bar = (label, value, max, text) => `<div class="evo-row"><span>${label}</span><span class="evo-bar"><i style="width:${Math.round(Math.min(1, value / max) * 100)}%"></i></span><b>${text}</b></div>`;
  const target = branch ? unitInfo(branch.to)?.nameKo ?? branch.to : "E 코드를 끼우세요";
  const matName = branch ? (materialInfo(branch.material)?.nameKo ?? branch.material) : "고대조각/재상트";
  return `<div class="evo panel"><div class="sub">진화: <b>${esc(target)}</b></div>
    ${bar("엔진", e.engine, evo.engineNeed, `${e.engine}% / ${evo.engineNeed}%`)}
    ${bar("A-C 코어", e.core, evo.coreNeed, `${e.core} / ${evo.coreNeed}`)}
    ${bar(esc(matName), shards, evo.shardsNeed, `${shards * evo.shardUnit} / ${evo.shardsNeed * evo.shardUnit}`)}
    <div class="sub">다 차면 다음 라운드 시작에 진화해요. (X-E 엔진 → 토가로가, V-E 엔진 → 드워곤)</div></div>`;
}

/** ★2 제노사우로스의 유전 갈래 고르기 (전설은 언제든, 초전설은 4라운드부터) */
function geneHtml(unit) {
  const genes = S.catalog?.genes;
  if (!genes || unit.defId !== genes.from || unit.star !== 2) return "";
  const round = S.room?.chess?.round ?? 1;
  const btn = (o) => {
    const locked = round < o.minRound;
    return `<button class="mini gene${locked ? " locked" : ""}" data-act="gene" data-to="${esc(o.to)}"${locked ? " disabled" : ""}>
      <b>${esc(unitInfo(o.to)?.nameKo ?? o.to)}</b><small>Gen ${esc(o.gen)} · ${esc(o.grade)}${locked ? ` · ${o.minRound}라운드부터` : ""}</small></button>`;
  };
  return `<div class="genes panel"><div class="sub">유전 갈래를 골라 진화해요</div><div class="gene-grid">${genes.options.map(btn).join("")}</div></div>`;
}

export function findUnit(me, uid) {
  return me.board.find((u) => u.uid === uid) ?? me.bench.find((u) => u && u.uid === uid) ?? null;
}

function selectedHtml(me) {
  const unit = S.selUid ? findUnit(me, S.selUid) : null;
  if (!unit) return "";
  const info = unitInfo(unit.defId);
  const onBoard = me.board.some((u) => u.uid === unit.uid);
  const f = unit.star >= 2 ? 1.8 : 1;
  const w = unit.weapon ? weaponInfo(unit.weapon) : null;
  return `<div class="selpop panel"><div class="selhead"><b>${esc(info?.nameKo ?? unit.defId)} ${starText(unit.star)}</b>
    <span class="sub">${PIECE_NAME[info?.piece] ?? ""} · ${esc(info?.role ?? "")}</span><span class="grow"></span><button class="ibtn" data-act="sel-close" title="닫기">✕</button></div>
    ${info ? `<div>${ic("heart")} ${Math.round(info.hp * f)} &nbsp; ${ic("sword")} ${Math.round(info.atk * f)}</div><div class="sub">${esc(info.abilityText)}</div>` : ""}
    ${w ? `<div class="wline">${ic("shield")} <b>${esc(w.nameKo)}</b> <button class="mini" data-act="unequip-sel">무기 빼기</button></div>` : ""}
    ${evolutionHtml(me, unit)}
    ${geneHtml(unit)}
    <div class="btnrow">${onBoard ? `<button class="mini" data-act="bench-sel">대기석으로</button>` : ""}
    <button class="mini" data-act="sell-sel">판매 +${sellValue(info?.cost ?? 1, unit.star)}</button></div></div>`;
}

// ---- 첫 판 안내 ----

const showCoach = (chess) => !S.coachDismissed && chess.round === 1;

export function coachStep(chess, me) {
  const benchCount = me.bench.filter(Boolean).length;
  if (!me.board.length && !benchCount) return { n: 1, text: "오른쪽 상점에서 마음에 드는 캐릭터를 눌러 사 보세요." };
  if (!me.board.length) return { n: 2, text: "산 기물을 판에 놓아요. 끌어다 놓거나, 기물을 누르고 칸을 눌러도 돼요. '자동 배치' 버튼도 있어요." };
  if (me.board.length < chess.deployCap && (benchCount > 0 || me.gold >= 1)) {
    return { n: 3, text: `이번 라운드는 ${chess.deployCap}기까지 올릴 수 있어요. 골드가 남으면 더 사서 놓아 보세요.` };
  }
  return { n: 4, text: "준비 끝! '준비 끝'을 누르면 전투가 시작돼요. 전투는 알아서 진행되고, 항복은 언제든 위에서 할 수 있어요." };
}

function coachHtml(chess, me) {
  if (showCoach(chess)) {
    const st = coachStep(chess, me);
    return `<div class="coach"><span class="dots">${[1, 2, 3, 4].map((n) => `<i class="${n <= st.n ? "on" : ""}"></i>`).join("")}</span>
      <div class="ctext"><b class="warn">처음이시네요! ${st.n}/4</b> ${esc(st.text)}</div>
      <button class="mini" data-act="guide" data-tab="prep">가이드</button><button class="mini" data-act="coach-dismiss">건너뛰기</button></div>`;
  }
  if (!S.tipSeen && chess.round === 2) {
    return `<div class="coach"><div class="ctext"><b class="warn">다음 단계 팁</b> ① 골드 10마다 이자 +1 ② 같은 캐릭터 3장 = ★2 ③ 같은 기물 2명 이상 = 시너지</div>
      <button class="mini" data-act="guide" data-tab="synergy">가이드</button><button class="mini" data-act="tip-seen">알겠어요</button></div>`;
  }
  return "";
}

export function prepView(room) {
  const chess = room.chess;
  const me = chess?.me;
  const seat = mySeat();
  if (!chess || !me || seat == null) return `<div class="center-msg">불러오는 중...</div>`;
  const canAuto = me.bench.some(Boolean) && me.board.length < chess.deployCap;
  const step = showCoach(chess) ? coachStep(chess, me).n : 0;
  const res = resourceHtml(chess, me);
  return `<div class="game prepgame">${gameBar(room, chess)}${coachHtml(chess, me)}
    <main class="gmain">
      <section class="gleft">
        <div class="gboardwrap"><div class="gboardrow">${traitsHtml(me)}<div class="gboardbox">
          <div class="${step === 2 ? "hl" : ""}">${boardHtml(chess, me, seat)}</div>
          ${benchHtml(me, canAuto)}
        </div></div></div>
        <div class="gshop">${shopHtml(chess, me)}</div>
      </section>
      <aside class="gside">
        <div class="gstat">${ringHtml(me.board.length, chess.deployCap, me.gold)}
          <div class="synbox">${oddsHtml(chess)}${chess.lite ? '<span class="badge">입문</span>' : ""}</div></div>
        <div class="gres">${res}<div class="sellzone" data-drop="sell" title="기물을 여기로 끌어다 놓으면 팔아요">${ic("trash")} 끌어서 팔기</div></div>
        <button class="btn primary gdone${step === 4 ? " hl" : ""}" data-act="done"${me.done ? " disabled" : ""}>${me.done ? "준비 완료 · 상대를 기다리는 중" : "준비 끝"}</button>
      </aside>
      ${selectedHtml(me)}
    </main></div>`;
}

