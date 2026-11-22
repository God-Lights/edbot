// 준비 단계 화면: 판, 대기석, 상점, 자원 패널. HTML 문자열을 만들고, 클릭/드래그는 main.js가 한꺼번에 처리한다.

import { itemName } from "./crafting.js";
import { S, conn, materialInfo, mySeat, synergyInfo, unitInfo, weaponInfo } from "./state.js";
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
    <span class="star">${starText(star)}</span>${opts.armed ? '<span class="armed" title="무기">🛡</span>' : ""}</div>`;
}

export function hpPill(name, hp, color) {
  const ratio = Math.min(1, Math.max(0, hp / START_HP));
  return `<div class="hp"><div class="hp-top"><b>${esc(name)}</b><span>♥ ${Math.max(0, hp)}</span></div>
    <div class="hp-bar"><i style="width:${ratio * 100}%;background:${color}"></i></div></div>`;
}

function lastRoundText(last, seat) {
  const outcome = last.winner == null ? "무승부" : last.winner === seat ? "승리" : "패배";
  return `지난 라운드 ${last.round}: ${outcome} · 내 체력 -${last.damage[seat] ?? 0}, 상대 체력 -${last.damage[1 - seat] ?? 0}`;
}

/** 준비와 전투 화면 위쪽: 라운드, 남은 시간, 체력, 항복 */
export function header(room, chess) {
  const seat = mySeat();
  const mine = room.players.find((p) => p.seat === seat)?.name ?? "나";
  const theirs = room.players.find((p) => p.seat !== seat)?.name ?? "상대";
  const last = room.phase === "prep" && chess.lastRound ? `<div class="sub">${esc(lastRoundText(chess.lastRound, seat))}</div>` : "";
  return `<div class="panel header">
    <div class="hrow">
      ${hpPill(mine, chess.me?.hp ?? 0, "var(--mine)")}
      <div class="center"><b>라운드 ${chess.round} / ${chess.maxRounds}</b>
        <span class="sub" data-timer="${room.phaseEndsAt ?? ""}" data-label="${PHASE_NAME[room.phase]}">${PHASE_NAME[room.phase]} ${countdown(conn.remainingMs(room.phaseEndsAt))}</span></div>
      ${hpPill(theirs, chess.opponent?.hp ?? 0, "var(--theirs)")}
      <span class="grow"></span>
      <button class="btn sec" data-act="surrender">🏳 항복</button>
    </div>${last}</div>`;
}

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
  return `<div class="board">${html}</div>`;
}

function benchHtml(me) {
  return `<div class="bench">${me.bench
    .map((u, i) => `<div class="slot" data-act="bench-slot" data-drop="bench" data-slot="${i}">${
      u ? token(u.defId, u.star, { uid: u.uid, selected: S.selUid === u.uid, armed: !!u.weapon, weapon: u.weapon }) : ""
    }</div>`)
    .join("")}</div>`;
}

// ---- 오른쪽 패널 ----

function shopHtml(chess, me) {
  const sig = me.shop.join("|");
  // 상점이 통째로 새로 채워졌을 때(새로고침, 새 라운드)만 카드가 차례로 나타난다. 하나를 산 경우는 아니다.
  const deal = S.fx.shop !== "" && S.fx.shop !== sig && me.shop.every(Boolean) ? " deal" : "";
  const cards = me.shop
    .map((id, slot) => {
      if (!id) return `<div class="shopcard sold">구매 완료</div>`;
      const info = unitInfo(id);
      const cost = info?.cost ?? 0;
      const off = me.gold < cost ? " dim" : "";
      return `<button class="shopcard${off}${deal}" data-act="buy" data-slot="${slot}" style="--bc:${COST_COLOR[cost]};--i:${slot}">
        ${token(id, 1)}
        <span class="si"><b>${esc(info?.nameKo ?? id)} <em style="color:${PIECE_COLOR[info?.piece]}">${PIECE_NAME[info?.piece] ?? ""}</em></b>
        <small>${esc(info?.abilityText ?? "")}</small></span><span class="cost" style="background:${COST_COLOR[cost]}40">${cost}</span></button>`;
    })
    .join("");
  const names = ["1골드", "2골드", "3골드", "4골드"];
  const odds = chess.shopOdds.map((p, i) => (p > 0 ? `${names[i]} ${p}%` : "")).filter(Boolean).join(" · ");
  return `<div class="shop${coachStep(chess, me)?.n === 1 && showCoach(chess) ? " hl" : ""}">${cards}
    <button class="btn sec wide" data-act="reroll"${me.gold < me.rerollCost ? " disabled" : ""}>⟳ 새로고침 (${me.rerollCost}골드)</button>
    <div class="odds">등장 확률: ${odds}</div></div>`;
}

const itemLabel = (item) => itemName(item, S.catalog);

function resourceHtml(chess, me) {
  const materials = Object.entries(me.materials).filter(([, n]) => n > 0).sort();
  const weapons = Object.entries(me.weapons).filter(([, n]) => n > 0).sort();
  if (!chess.market.length && !chess.tiles.length && !materials.length && !weapons.length) return "";
  const free = me.smelters.some((s) => s == null);
  const tileNames = [...new Set(chess.tiles.map((t) => materialInfo(t.material)?.nameKo ?? t.material))].sort();
  let html = `<div class="panel res"><b>자원</b>`;
  if (chess.tiles.length) html += `<div class="sub">이번 라운드 자원 칸(◆): ${esc(tileNames.join(", "))}. 칸 위에 기물을 놓거나 걸어가면 얻어요.</div>`;
  if (chess.market.length) {
    html += `<div class="sub">광물 시장 · 한 라운드에 한 개</div>`;
    chess.market.forEach((item, i) => {
      const info = materialInfo(item.material);
      const rarity = info?.rarity ?? "common";
      const on = !me.marketBought && me.gold >= item.price;
      html += `<button class="mrow${on ? "" : " dim"}" data-act="market" data-slot="${i}"${on ? "" : " disabled"}>
        <i style="color:${RARITY_COLOR[rarity]}">◆</i><span><b>${esc(info?.nameKo ?? item.material)}</b><small>${RARITY_NAME[rarity]} → ${esc(weaponInfo(info?.weaponId)?.nameKo ?? "")}</small></span>
        <em>${me.marketBought ? "구매함" : `${item.price}골드`}</em></button>`;
    });
  }
  const itemCount = materials.length + weapons.length;
  if (itemCount) {
    html += `<div class="combinebar"><button class="btn sec${S.combineMode ? " on" : ""}" data-act="combine-mode">⚗ 조합${S.combineMode ? " 중 (둘을 차례로 누르세요)" : ""}</button>
      <button class="btn sec" data-act="guide" data-tab="recipes">📜 조합 도감</button></div>
      <div class="combine-hint" id="combine-hint">${S.combineFirst ? `<b>${esc(itemLabel(S.combineFirst))}</b>와(과) 합칠 아이템을 누르세요` : "아이템을 다른 아이템 위로 끌어다 놓으면 합쳐져요 (재료+재료, 무기+무기, 무기+원재료)"}</div>`;
  }
  const mode = S.combineMode;
  const first = S.combineFirst;
  const chipClass = (kind, id, extra = "") => `chip${extra}${S.fx.items && !S.fx.items.has(`${kind}:${id}`) ? " pop" : ""}${first && first.kind === kind && first.id === id ? " on" : ""}`;
  if (materials.length) {
    const usable = free || mode;
    html += `<div class="sub">재료 · 누르면 재련, <b>재련대로</b> 끌어 놓아도 돼요 (다른 재료 위로 끌면 <b>조합</b>)</div><div class="chips">${materials
      .map(([id, n]) => {
        const r = materialInfo(id)?.rarity ?? "common";
        return `<button class="${chipClass("material", id, usable ? "" : " dim")}" style="--rc:${RARITY_COLOR[r]}" data-act="smelt" data-id="${esc(id)}" data-kind="material" data-drag="material" data-drop="combine" draggable="true"${usable ? "" : " disabled"}>${esc(materialInfo(id)?.nameKo ?? id)} ×${n}</button>`;
      })
      .join("")}</div>`;
  }
  html += `<div class="smelters">${me.smelters
    .map((w, i) => `<div class="smelter${w ? " busy" : ""}" data-drop="smelter"><small>재련대 ${i + 1}</small><b>${w ? "⚒ " + esc(weaponInfo(w)?.nameKo ?? w) : "비어 있음"}</b></div>`)
    .join("")}</div>`;
  if (me.smelters.some(Boolean)) html += `<div class="sub tiny">재련 중인 무기는 다음 라운드 시작에 완성돼요.</div>`;
  if (!weapons.length && me.board.some((u) => u.weapon)) html += `<div class="chips emptybox" data-drop="inventory">🛡 무기를 뺄 기물을 여기로 끌어다 놓아요</div>`;
  if (weapons.length) {
    html += `<div class="sub">무기 · <b>기물 위로 끌어다</b> 놓으면 껴요 (누른 뒤 기물을 눌러도 돼요)</div><div class="chips" data-drop="inventory">${weapons
      .map(([id, n]) => {
        const r = weaponInfo(id)?.rarity ?? "common";
        return `<button class="${chipClass("weapon", id, S.selWeapon === id ? " on" : "")}" style="--rc:${RARITY_COLOR[r]}" data-act="pick-weapon" data-id="${esc(id)}" data-kind="weapon" data-drag="weapon" data-drop="combine" draggable="true">${esc(weaponInfo(id)?.nameKo ?? id)} ×${n}</button>`;
      })
      .join("")}</div>`;
    if (S.selWeapon) html += `<div class="sub warn">${esc(weaponInfo(S.selWeapon)?.text ?? "")}</div>`;
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
    <div class="mid${bump}"><span class="coin">🪙</span><b>${gold}</b></div>
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
    return `<div class="synchip${tier ? " on" : ""}${tier >= 2 ? " max" : ""}" style="--pc:${PIECE_COLOR[p]}" title="${esc(detail)}">
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
  return `<div class="panel selected"><b>${esc(info?.nameKo ?? unit.defId)} ${starText(unit.star)}</b>
    <span class="sub">${PIECE_NAME[info?.piece] ?? ""} · ${esc(info?.faction ?? "")} · ${esc(info?.role ?? "")}</span>
    ${info ? `<div>♥ ${Math.round(info.hp * f)} &nbsp; ⚔ ${Math.round(info.atk * f)}</div><div class="sub">${esc(info.abilityText)}</div>` : ""}
    ${w ? `<div class="wline">🛡 <b>${esc(w.nameKo)}</b> <small>${esc(w.text)}</small> <button class="btn sec" data-act="unequip-sel">무기 빼기</button></div>` : ""}
    <div class="btnrow">${onBoard ? `<button class="btn sec" data-act="bench-sel">대기석으로</button>` : ""}
    <button class="btn sec" data-act="sell-sel">판매 +${sellValue(info?.cost ?? 1, unit.star)}</button></div>
    <div class="sub tiny">칸을 누르면 거기에 놓아요.</div></div>`;
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
    const s = coachStep(chess, me);
    return `<div class="panel coach"><span class="dots">${[1, 2, 3, 4].map((n) => `<i class="${n <= s.n ? "on" : ""}"></i>`).join("")}</span>
      <div><b class="warn">처음이시네요! ${s.n} / 4</b><div>${esc(s.text)}</div></div><span class="grow"></span>
      <button class="btn sec" data-act="guide" data-tab="prep">가이드</button><button class="btn sec" data-act="coach-dismiss">건너뛰기</button></div>`;
  }
  if (!S.tipSeen && chess.round === 2) {
    return `<div class="panel coach"><div><b class="warn">다음 단계 팁</b><div>① 골드 10마다 이자 +1 (최대 +3) ② 같은 캐릭터 3장 = ★2, 훨씬 강해져요 ③ 같은 기물(킹·룩·비숍·폰...)을 2명 이상 올리면 시너지 보너스</div></div>
      <span class="grow"></span><button class="btn sec" data-act="guide" data-tab="synergy">가이드</button><button class="btn sec" data-act="tip-seen">알겠어요</button></div>`;
  }
  return "";
}

export function prepView(room) {
  const chess = room.chess;
  const me = chess?.me;
  const seat = mySeat();
  if (!chess || !me || seat == null) return `<div class="center-msg">불러오는 중...</div>`;
  const canAuto = me.bench.some(Boolean) && me.board.length < chess.deployCap;
  const opp = chess.opponent;
  const step = showCoach(chess) ? coachStep(chess, me).n : 0;
  return `${header(room, chess)}${coachHtml(chess, me)}
    <div class="prep">
      <div class="left">
        <div class="boardbar"><b>판 ${me.board.length} / ${chess.deployCap}</b><span class="sub">(위쪽이 앞줄, 상대와 가까워요)</span>
          ${chess.lite ? `<span class="badge">입문 모드</span>` : ""}<span class="grow"></span>
          ${Object.keys(S.sessionRounds).length ? `<button class="btn sec" data-act="rewatch">↺ 지난 전투</button>` : ""}
          ${opp ? `<span class="sub ${opp.done ? "good" : ""}">상대 ${opp.boardCount}기 배치 · ${opp.done ? "준비 끝" : "준비 중"}</span>` : ""}
          ${canAuto ? `<button class="btn sec" data-act="auto">✨ 자동 배치</button>` : ""}</div>
        <div class="${step === 2 ? "hl" : ""}">${boardHtml(chess, me, seat)}</div>
        <div class="sub">대기석</div>${benchHtml(me)}
      </div>
      <div class="right">
        <div class="panel topstat">${ringHtml(me.board.length, chess.deployCap, me.gold)}
          <div class="synbox"><div class="sub">시너지 · 다음 라운드 🪙 +${me.nextIncome}</div>${synergyHtml(me)}</div></div>
        ${shopHtml(chess, me)}
        <div class="sellzone" data-drop="sell">🗑 여기로 끌어서 팔기</div>
        ${resourceHtml(chess, me)}
        ${selectedHtml(me)}
        <button class="btn primary wide${step === 4 ? " hl" : ""}" data-act="done"${me.done ? " disabled" : ""}>${me.done ? "준비 완료 · 상대를 기다리는 중" : "준비 끝"}</button>
      </div>
    </div>`;
}

