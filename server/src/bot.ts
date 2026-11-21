// 테스트 대전(ADMN)의 상대 봇. 사람처럼 같은 함수(playerBan, playerPick ...)로 행동하므로 규칙을 따로 흉내 내지 않는다.
// 솜씨는 일부러 단순하다: 무작위로 밴·뽑기·배치하고, 간단히 채집·조합·장착하고, 적과 맞붙으면 궁극기를 쓴다.

import { availableIds, currentTurnSeat } from "./game";
import { deployCap } from "./chess/game";
import { unitDef } from "./chess/roster";
import { MARKET_PRICE, materialDef } from "./chess/weapons";
import type { Role } from "./chess/types";
import { CHARACTERS } from "./characters";
import type { Lane } from "./protocol";
import { LANES } from "./protocol";
import {
  BOT_ID,
  playerBan,
  playerChess,
  playerExplore,
  playerForge,
  playerLock,
  playerPick,
  playerPlace,
  playerUltimate,
  setReady,
} from "./room-state";
import type { RoomState } from "./room-state";

const pickRandom = <T>(items: readonly T[], rng: () => number): T | undefined =>
  items.length === 0 ? undefined : items[Math.min(items.length - 1, Math.floor(rng() * items.length))];

/**
 * 봇이 할 수 있는 행동을 한 번씩 한다. 무언가 했으면 true.
 * 방이 알람이나 사람의 행동을 처리한 뒤에 부른다. (한 번에 여러 단계가 넘어갈 수 있어서 바뀔 때까지 반복해 부른다)
 */
export function runBot(state: RoomState, now: number, scale: number, rng: () => number): boolean {
  const bot = state.players.find((p) => p.bot);
  if (!bot || !state.testMatch) return false;
  if (state.mode === "chess") return runChessBot(state, bot.id, now, scale, rng);
  const seat = bot.seat;
  const game = state.game;
  const act = (ok: { ok: boolean }): boolean => ok.ok;

  switch (state.phase) {
    case "lobby": {
      const humanHere = state.players.some((p) => !p.bot && p.connected);
      if (humanHere && !bot.ready) return act(setReady(state, BOT_ID, true, now, scale, rng));
      return false;
    }
    case "ban": {
      if (!game || game.banLocked[seat]) return false;
      const id = pickRandom(CHARACTERS.map((c) => c.id), rng);
      return id ? act(playerBan(state, BOT_ID, id, now, scale, rng)) : false;
    }
    case "draft": {
      if (!game || currentTurnSeat(game) !== seat) return false;
      const id = pickRandom(availableIds(game), rng);
      return id ? act(playerPick(state, BOT_ID, id, now, scale, rng)) : false;
    }
    case "placement": {
      if (!game || game.placementLocked[seat]) return false;
      for (const id of game.picks[seat]) {
        if (!game.lanes[seat][id]) playerPlace(state, BOT_ID, id, pickRandom(LANES, rng) as Lane, now, scale, rng);
      }
      return act(playerLock(state, BOT_ID, now, scale, rng));
    }
    case "explore":
    case "forge":
    case "battle":
    case "deathmatch":
      return runBotEconomyAndBattle(state, now, scale, rng);
    default:
      return false;
  }
}

function runBotEconomyAndBattle(state: RoomState, now: number, scale: number, rng: () => number): boolean {
  const bot = state.players.find((p) => p.bot)!;
  const seat = bot.seat;
  const explore = state.explore;
  const game = state.game;
  if (!explore || !game) return false;
  let did = false;

  // 채집: 아는 자원 칸 하나
  if (explore.gauge[seat] >= 1) {
    const index = explore.tiles.findIndex(
      (t, i) =>
        explore.known[seat][i] &&
        (t.kind === "tree" || t.kind === "rock" || t.kind === "ore") &&
        t.depletedUntil === null &&
        !explore.gathers.some((g) => g.seat === seat && g.tile === i) &&
        !explore.ambushes.some((a) => a.seat === seat && a.tile === i),
    );
    if (index >= 0 && playerExplore(state, BOT_ID, "gather", index, now, scale, rng).ok) did = true;
  }

  // 무기: 가진 게 있으면 맨손인 캐릭터에게 끼우고, 없으면 만들 수 있는 1등급 무기를 하나 만든다.
  const forge = explore.forge;
  const owned = Object.entries(forge.inventory[seat]).find(([, n]) => n > 0)?.[0];
  if (owned) {
    const bare = game.picks[seat].find((id) => !forge.equipped[seat][id] && !forge.equipping[seat][id]);
    if (bare && playerForge(state, BOT_ID, { t: "forge", action: "equip", weaponId: owned, characterId: bare }, now, scale, rng).ok) did = true;
  } else {
    const recipes = ["stone-axe", "wood-spear", "wood-bow"];
    const start = Math.floor(rng() * recipes.length);
    for (let i = 0; i < recipes.length; i++) {
      const weaponId = recipes[(start + i) % recipes.length]!;
      if (playerForge(state, BOT_ID, { t: "forge", action: "craft", weaponId }, now, scale, rng).ok) {
        did = true;
        break;
      }
    }
  }

  // 궁극기: 스팀포스가 있고, 같은 레인에서 적과 맞붙었을 때
  const battle = state.battle;
  if (battle && !battle.finished) {
    for (const unit of battle.units) {
      if (unit.seat !== seat || unit.summon || !unit.alive) continue;
      if (battle.tick < unit.ultReadyTick || battle.steam[seat] < 5) continue;
      const engaged = battle.units.some((o) => o.alive && o.seat !== seat && o.lane === unit.lane && Math.abs(o.pos - unit.pos) <= 14);
      if (!engaged) continue;
      const lane =
        unit.characterId === "ankio"
          ? pickRandom(LANES.filter((l) => battle.towers.some((t) => t.seat !== seat && t.lane === l && t.kind === "guard" && t.alive)), rng)
          : undefined;
      if (unit.characterId === "ankio" && !lane) continue;
      if (playerUltimate(state, BOT_ID, unit.characterId, lane, now, scale, rng).ok) {
        did = true;
        break; // 스팀포스를 한 번에 몰아 쓰지 않는다
      }
    }
  }
  return did;
}

/** 봇이 더 할 일이 없을 때까지 부른다(무한 반복을 막으려고 횟수를 제한). */
export function runBotUntilIdle(state: RoomState, now: number, scale: number, rng: () => number): boolean {
  let changed = false;
  for (let i = 0; i < 8; i++) {
    if (!runBot(state, now, scale, rng)) break;
    changed = true;
  }
  return changed;
}


// ---- 체스판 자동 전투 봇 ----
// 사람과 같은 명령(사기, 놓기, 준비 끝)으로만 행동한다. 솜씨는 일부러 단순하다:
// 같은 캐릭터를 모으려고 하고, 비싼 캐릭터를 우선 사서 역할에 맞는 줄에 놓는다.

/** 역할별로 놓는 줄(0이 앞줄) */
const BOT_ROW: Record<Role, number> = { 탱커: 0, 지휘: 1, 암살: 1, 기동: 1, 제어: 2, 딜러: 2, 서포터: 3 };
const BOT_COLS = [3, 4, 2, 5, 1, 6, 0, 7];

const unitValue = (defId: string, star: number): number => (unitDef(defId)?.cost ?? 1) * (star === 2 ? 3 : 1);

/** 한 번 부르면 준비 단계에서 할 수 있는 것을 하고 준비를 끝낸다. 무언가 했으면 true. */
export function runChessBot(state: RoomState, botId: string, now: number, scale: number, rng: () => number): boolean {
  const player = state.players.find((p) => p.id === botId);
  const chess = state.chess;
  if (!player) return false;

  if (state.phase === "lobby") {
    const humanHere = state.players.some((p) => !p.bot && p.connected);
    if (humanHere && !player.ready) return setReady(state, botId, true, now, scale, rng).ok;
    return false;
  }
  if (!chess || state.phase !== "prep") return false;
  const me = chess.players[player.seat];
  if (me.done) return false;

  const cmd = (command: Parameters<typeof playerChess>[2]) => playerChess(state, botId, command, now, scale, rng).ok;

  // 0) 자원: 광물 시장에서 재료를 사고, 재료를 재련대에 넣는다. (자원 시스템이 있는 판만)
  const rarityRank = (id: string): number => ["common", "uncommon", "rare", "legendary"].indexOf(materialDef(id)?.rarity ?? "common");
  if (chess.resources) {
    if (!me.marketBought && chess.round >= 2) {
      const options = chess.market
        .map((id, slot) => ({ slot, price: MARKET_PRICE[materialDef(id)?.rarity ?? "common"] ?? 99, rank: rarityRank(id) }))
        .filter((o) => o.price + 4 <= me.gold)
        .sort((a, b) => b.rank - a.rank || a.slot - b.slot);
      if (options[0]) cmd({ t: "market", slot: options[0].slot });
    }
    const owned = Object.entries(me.materials).filter(([, n]) => n > 0).map(([id]) => id).sort((a, b) => rarityRank(b) - rarityRank(a));
    for (const id of owned) {
      while ((me.materials[id] ?? 0) > 0 && me.smelters.some((w) => w === null)) {
        if (!cmd({ t: "smelt", material: id })) break;
      }
    }
  }

  // 1) 사기: 이미 가진 캐릭터(합치려고) > 비싼 캐릭터 순. 이자(10골드마다 +1)를 위해 10골드 단위는 조금 남긴다.
  for (let i = 0; i < 12; i++) {
    const owned = (defId: string) =>
      [...me.board, ...me.bench.filter((u): u is NonNullable<typeof u> => u !== null)].filter((u) => u.defId === defId && u.star === 1).length;
    const reserve = 0;
    const options = me.shop
      .map((defId, slot) => ({ defId, slot }))
      .filter((o): o is { defId: string; slot: number } => o.defId !== null && unitDef(o.defId)!.cost <= me.gold - reserve)
      .sort((a, b) => owned(b.defId) - owned(a.defId) || unitDef(b.defId)!.cost - unitDef(a.defId)!.cost || a.slot - b.slot);
    const pick = options[0];
    if (!pick || !cmd({ t: "buy", slot: pick.slot })) break;
  }

  // 2) 놓기: 가치가 높은 기물을 판 위로. 판이 가득 차면 더 약한 기물과 자리를 바꾼다.
  const cap = deployCap(chess.round);
  const cellFree = (col: number, row: number) => !me.board.some((u) => u.col === col && u.row === row);
  const bestCell = (defId: string): { col: number; row: number } | undefined => {
    const base = BOT_ROW[unitDef(defId)!.role];
    for (let row = base; row < 4; row++) for (const col of BOT_COLS) if (cellFree(col, row)) return { col, row };
    for (let row = 0; row < base; row++) for (const col of BOT_COLS) if (cellFree(col, row)) return { col, row };
    return undefined;
  };
  const benchUnits = me.bench.filter((u): u is NonNullable<typeof u> => u !== null).sort((a, b) => unitValue(b.defId, b.star) - unitValue(a.defId, a.star));
  for (const unit of benchUnits) {
    if (me.board.length < cap) {
      const cell = bestCell(unit.defId);
      if (cell) cmd({ t: "deploy", uid: unit.uid, col: cell.col, row: cell.row });
    } else {
      const weakest = [...me.board].sort((a, b) => unitValue(a.defId, a.star) - unitValue(b.defId, b.star))[0];
      if (weakest && unitValue(weakest.defId, weakest.star) < unitValue(unit.defId, unit.star)) {
        cmd({ t: "deploy", uid: unit.uid, col: weakest.col, row: weakest.row });
      }
    }
  }

  // 3) 무기: 가진 무기를 판 위의 가치 높은 기물부터 낀다.
  if (chess.resources) {
    for (const [weaponId, count] of Object.entries(me.weapons)) {
      for (let i = 0; i < count; i++) {
        const target = me.board.filter((u) => !u.weapon).sort((a, b) => unitValue(b.defId, b.star) - unitValue(a.defId, a.star))[0];
        if (!target || !cmd({ t: "equip", weaponId, uid: target.uid })) break;
      }
    }
  }

  cmd({ t: "done" });
  return true;
}
