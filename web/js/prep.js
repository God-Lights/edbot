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
  const border = opts.tint ?? COST_COLOR[info?.cost ?? 1];
  const drag = opts.uid ? ` data-uid="${esc(opts.uid)}" data-drag="unit" draggable="true"` : "";
  // 새로 생긴 기물은 튀어나오고(★2는 반짝), 무기가 새로 끼워진 기물은 번쩍인다.
  let fx = "";
  if (opts.uid && S.fx.phase === "prep") {
    if (!S.fx.uids.has(opts.uid)) fx += star >= 2 ? " pop merge" : " pop";
    else if (opts.armed && S.fx.weapons[opts.uid] !== opts.weapon) fx += " equipflash";
  }
  return `<div class="token${opts.selected ? " sel" : ""}${fx}" style="--pc:${PIECE_COLOR[piece]};--bc:${border}"${drag}>
    <span class="icon" style="--img:url(assets/pieces/${piece}.png)"></span>
    <span class="nm">${esc(info?.nameKo ?? defId)}</span>
    <span class="star">${starText(star)}</span>${opts.armed ? '<span class="armed" title="무기">${ic("shield")}</span>' : ""}</div>`;
}

export function hpPill(name, hp, color) {
  const ratio = Math.min(1, Math.max(0, hp / START_HP));
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
    <div class="gb-side"><b class="mono gb-code">${esc(room.code)}</b>${room.mobius ? `<span class="badge mob" title="무한 모드">${ic("infinity")}</span>` : ""}${hpPill(mine, chess.me?.hp ?? 0, "var(--mine)")}</div>
    <div class="gb-center"><b>R${chess.round}/${chess.maxRounds}</b>
      <span class="sub gb-timer" data-timer="${room.phaseEndsAt ?? ""}" data-label="${PHASE_NAME[room.phase]}">${PHASE_NAME[room.phase]} ${countdown(conn.remainingMs(room.phaseEndsAt))}</span>
      ${last ? `<span class="gb-last" title="${esc(last)}">${esc(last)}</span>` : ""}</div>
    <div class="gb-side gb-right">${hpPill(theirs, chess.opponent?.hp ?? 0, "var(--theirs)")}${opp}
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
        ? `<div class="tile ${unit ? "under" : ""}" style="--rc:${RARITY_COLOR[rarity]}"><i>◆</i>${unit ? "" : `<small>${esc(materialInfo(tile.material)?.nameKo ?? "")}</small>`}</div>`
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

function shopHtml(chess, me) {
  const sig = me.shop.join("|");
  // 상점이 통째로 새로 채워졌을 때(새로고침, 새 라운드)만 카드가 차례로 나타난다. 하나를 산 경우는 아니다.
  const deal = S.fx.shop !== "" && S.fx.shop !== sig && me.shop.every(Boolean) ? " deal" : "";
  const cards = me.shop
    .map((id, slot) => {
      if (!id) return `<div class="shopcard sold"><span>구매<br>완료</span></div>`;
      const info = unitInfo(id);
      const cost = info?.cost ?? 0;
      const off = me.gold < cost ? " dim" : "";
      return `<button class="shopcard${off}${deal}" data-act="buy" data-slot="${slot}" style="--bc:${COST_COLOR[cost]};--i:${slot}" title="${esc((info?.nameKo ?? id) + " · " + (info?.abilityText ?? ""))}">
        ${token(id, 1)}
        <span class="si"><b>${esc(info?.nameKo ?? id)}</b><small>${esc(info?.abilityText ?? "")}</small></span>
        <span class="cost" style="background:${COST_COLOR[cost]}55">${ic("coin")}${cost}</span></button>`;
    })
    .join("");
  const names = ["1골드", "2골드", "3골드", "4골드"];
  const odds = chess.shopOdds.map((p, i) => (p > 0 ? `${names[i]} ${p}%` : "")).filter(Boolean).join(" · ");
  return `<div class="shop${coachStep(chess, me)?.n === 1 && showCoach(chess) ? " hl" : ""}">${cards}
    <button class="shopcard reroll" data-act="reroll"${me.gold < me.rerollCost ? " disabled" : ""} title="새로고침 · 등장 확률: ${esc(odds)}"><span class="rr">${ic("refresh")}</span><small>새로고침</small><b>${ic("coin")}${me.rerollCost}</b></button></div>`;
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
    <div class="mid${bump}"><span class="coin">${ic("coin")}</span><b>${gold}</b></div>
    <div class="cap">판 ${count}/${cap}</div></div>`;
}

const SYN_PIECES = ["king", "queen", "rook", "bishop", "knight", "pawn"];

/** 판 위의 기물로 모은 시너지: 켜진 것은 밝게, 모으는 중인 것은 진행도(예: 1/2)와 함께 */
function synergyHtml(me) {
  const seen = new Set();
  const counts = {};
  for (const u of me.board) {
    if (seen.has(u.defId)) continue;
    seen.add(u.defId);
    const piece = unitInfo(u.defId)?.piece;
    if (piece) counts[piece] = (counts[piece] ?? 0) + 1;
  }
  const chips = SYN_PIECES.filter((p) => counts[p]).map((p) => {
    const th = p === "pawn" ? [2, 4] : [2, 3];
    const n = counts[p];
    const tier = th.filter((t) => n >= t).length;
    const need = tier >= 2 ? th[1] : th[tier];
    const shown = synergyInfo(`${p}-${tier || 1}`);
    const detail = tier ? shown?.text : `${need - n}명 더 모으면 ${shown?.text ?? ""}`;
    return `<div class="synchip${tier ? " on" : ""}${tier >= 2 ? " max" : ""}" style="--pc:${PIECE_COLOR[p]}" title="${esc(PIECE_NAME[p] + " " + n + "/" + need + " · " + detail)}">
      <span class="gicon" style="--pc:${PIECE_COLOR[p]};--img:url(assets/pieces/${p}.png)"></span>
      <span><b>${PIECE_NAME[p]} ${n}/${need}</b><small>${esc(detail)}</small></span></div>`;
  });
  return chips.length ? chips.join("") : `<div class="sub">같은 기물(킹·룩·비숍...)을 2명 이상 올리면 시너지가 켜져요.</div>`;
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
        <div class="gboardwrap"><div class="gboardbox">
          <div class="${step === 2 ? "hl" : ""}">${boardHtml(chess, me, seat)}</div>
          ${benchHtml(me, canAuto)}
        </div></div>
        <div class="gshop">${shopHtml(chess, me)}</div>
      </section>
      <aside class="gside">
        <div class="gstat">${ringHtml(me.board.length, chess.deployCap, me.gold)}
          <div class="synbox"><div class="sub gnext">다음 라운드 ${ic("coin")}+${me.nextIncome}${chess.lite ? ' · <span class="badge">입문</span>' : ""}</div>${synergyHtml(me)}</div></div>
        <div class="gres">${res}<div class="sellzone" data-drop="sell" title="기물을 여기로 끌어다 놓으면 팔아요">${ic("trash")} 끌어서 팔기</div></div>
        <button class="btn primary gdone${step === 4 ? " hl" : ""}" data-act="done"${me.done ? " disabled" : ""}>${me.done ? "준비 완료 · 상대를 기다리는 중" : "준비 끝"}</button>
      </aside>
      ${selectedHtml(me)}
    </main></div>`;
}

