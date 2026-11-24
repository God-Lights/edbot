// 테스트 대전(ADMN)의 상대 봇. 사람처럼 같은 함수(playerBan, playerPick ...)로 행동하므로 규칙을 따로 흉내 내지 않는다.
// 솜씨는 일부러 단순하다: 무작위로 밴·뽑기·배치하고, 간단히 채집·조합·장착하고, 적과 맞붙으면 궁극기를 쓴다.

import { availableIds, currentTurnSeat } from "./game";
import { deployCap } from "./chess/game";
import { EVOLUTION, unitDef } from "./chess/roster";
import { MARKET_PRICE, materialDef } from "./chess/weapons";
import { combine, parseWeapon } from "./chess/crafting";
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

export type BotLevel = "easy" | "normal" | "hard";
export const BOT_LEVELS: readonly BotLevel[] = ["easy", "normal", "hard"];

/** 한 번 부르면 준비 단계에서 할 수 있는 것을 하고 준비를 끝낸다. 무언가 했으면 true. 난이도는 봇 플레이어의 botLevel(기본 normal). */
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
  const level: BotLevel = player.botLevel ?? "normal";
  // 어려운 봇은 라운드마다 골드 +1(자원 시스템이 있는 판은 +2) (AI가 사람 고수만큼 약아지기는 어려워서 주는 이점)
  if (level === "hard" && player.botBonusRound !== chess.round) {
    player.botBonusRound = chess.round;
    me.gold += chess.resources ? 2 : 1;
  }

  const cmd = (command: Parameters<typeof playerChess>[2]) => playerChess(state, botId, command, now, scale, rng).ok;
  const cap = deployCap(chess.round);
  const units = () => [...me.board, ...me.bench.filter((u): u is NonNullable<typeof u> => u !== null)];

  // 0) 자원: 광물 시장에서 재료를 사고, 재료를 재련대에 넣는다. (자원 시스템이 있는 판, 쉬운 봇은 쓰지 않는다)
  const rarityRank = (id: string): number => ["common", "uncommon", "rare", "legendary"].indexOf(materialDef(id)?.rarity ?? "common");
  // 데보이트 계보: 데도키온이 있으면 E 코드를 만들어 끼우고, 진화 재료(고대의 파편·재상트)는 재련하지 않고 남긴다. (쉬운 봇은 안 한다)
  const dedokion = units().find((u) => u.defId === EVOLUTION.from);
  const keep = new Set<string>();
  // 데보이트를 모으는 중이면 미리 E 코드 재료와 진화 재료를 모아 둔다 (데도키온이 된 뒤에 모으면 8라운드 안에 진화하지 못한다)
  if (chess.resources && level !== "easy" && !dedokion && units().some((u) => u.defId === "devoit")) {
    for (const id of ["bit", "edgem", "ancient-shard"]) keep.add(id);
  }
  if (chess.resources && level !== "easy" && !dedokion && keep.size) {
    // 데보이트 단계에서도 짝이 맞으면 E 코드(X-E)를 미리 만들어 둔다
    if ((me.materials.bit ?? 0) > 0 && (me.materials.edgem ?? 0) > 0) cmd({ t: "combine", a: { kind: "material", id: "bit" }, b: { kind: "material", id: "edgem" } });
  }
  if (chess.resources && level !== "easy" && dedokion) {
    const fuse = (a: string, b: string) => {
      if ((me.materials[a] ?? 0) > 0 && (me.materials[b] ?? 0) > 0) cmd({ t: "combine", a: { kind: "material", id: a }, b: { kind: "material", id: b } });
    };
    const hasCode = (code: string) => (me.weapons[code] ?? 0) > 0 || units().some((u) => u.weapon && parseWeapon(u.weapon)?.parts.includes(code));
    // 아직 E 코드가 없으면 만든다: 비트 + 에드잼 -> X-E, 비트 + 레드오션 -> V-E
    if (!hasCode("e-code-xe") && !hasCode("e-code-ve") && !(me.materials["xe-code"] || me.materials["ve-code"])) {
      fuse("bit", "edgem");
      fuse("bit", "redocean");
    }
    // V-E 쪽이면 재상트를 만든다 (클로우스톤 + 타이타늄)
    const veSide = hasCode("e-code-ve") || (me.materials["ve-code"] ?? 0) > 0 || me.smelters.includes("e-code-ve");
    const xeSide = hasCode("e-code-xe") || (me.materials["xe-code"] ?? 0) > 0 || me.smelters.includes("e-code-xe");
    if (veSide) fuse("clawstone", "titanium");
    // 남겨 둘 재료: E 코드가 아직 없으면 E 코드 재료, 갈래가 정해지면 그 갈래의 진화 재료
    if (!xeSide && !veSide) for (const id of ["bit", "edgem", "redocean"]) keep.add(id);
    if (!veSide) keep.add("ancient-shard");
    if (!xeSide) { keep.add("zesent"); if (veSide) { keep.add("clawstone"); keep.add("titanium"); } }
    // 다른 기물에 끼워 둔 E 코드는 빼서 데도키온에게 옮긴다
    for (const u of units()) {
      if (u.uid !== dedokion.uid && u.weapon && EVOLUTION.branches.some((b) => parseWeapon(u.weapon!)?.parts.includes(b.code)) && !dedokion.weapon) {
        cmd({ t: "unequip", uid: u.uid });
      }
    }
    // E 코드를 낀다
    for (const branch of EVOLUTION.branches) {
      if ((me.weapons[branch.code] ?? 0) > 0 && !(dedokion.weapon && parseWeapon(dedokion.weapon)?.parts.includes(branch.code))) {
        cmd({ t: "equip", weaponId: branch.code, uid: dedokion.uid });
      }
    }
  }
  if (chess.resources && level !== "easy") {
    if (!me.marketBought && chess.round >= 2) {
      const margin = level === "hard" ? 2 : 4;
      // 데도키온이 있으면 진화에 필요한 재료(남겨 두는 재료)를 먼저 산다
      const options = chess.market
        .map((id, slot) => ({ slot, price: MARKET_PRICE[materialDef(id)?.rarity ?? "common"] ?? 99, rank: rarityRank(id) + (keep.has(id) ? 10 : 0) }))
        .filter((o) => o.price + margin <= me.gold)
        .sort((a, b) => b.rank - a.rank || a.slot - b.slot);
      if (options[0]) cmd({ t: "market", slot: options[0].slot });
    }
    const owned = Object.entries(me.materials).filter(([id, n]) => n > 0 && !keep.has(id)).map(([id]) => id).sort((a, b) => rarityRank(b) - rarityRank(a));
    for (const id of owned) {
      while ((me.materials[id] ?? 0) > 0 && me.smelters.some((w) => w === null)) {
        if (!cmd({ t: "smelt", material: id })) break;
      }
    }
    // 어려운 봇: 재련대에 못 넣고 남은 재료는 같은 희귀도끼리 합쳐서 한 단계 위 재료로 만들고, 재련대가 비면 그것을 재련한다.
    if (level === "hard") {
      const leftovers = () => Object.entries(me.materials).filter(([id, n]) => n > 0 && !keep.has(id)).map(([id]) => id).sort();
      for (let guard = 0; guard < 4; guard++) {
        const ids = leftovers();
        let fused = false;
        for (let i = 0; i < ids.length && !fused; i++) {
          for (let j = i + 1; j < ids.length && !fused; j++) {
            const result = combine({ kind: "material", id: ids[i]! }, { kind: "material", id: ids[j]! });
            if (result && cmd({ t: "combine", a: { kind: "material", id: ids[i]! }, b: { kind: "material", id: ids[j]! } })) fused = true;
          }
        }
        if (!fused) break;
      }
      for (const id of leftovers().sort((a, b) => rarityRank(b) - rarityRank(a))) {
        while ((me.materials[id] ?? 0) > 0 && me.smelters.some((w) => w === null)) {
          if (!cmd({ t: "smelt", material: id })) break;
        }
      }
    }
  }

  // 1) 사기. 쉬운 봇: 되는 대로 5개까지. 보통: 이미 가진 캐릭터(합치려고) > 비싼 캐릭터. 어려운 봇: 보통 + 이자를 챙기고 새로고침으로 합칠 캐릭터를 찾는다.
  const owned = (defId: string) => units().filter((u) => u.defId === defId && u.star === 1).length;
  /** 기물별로 서로 다른 캐릭터가 몇 명인지 (시너지 계산) */
  const pieceCounts = (): Map<string, number> => {
    const seen = new Set<string>();
    const counts = new Map<string, number>();
    for (const u of me.board) {
      if (seen.has(u.defId)) continue;
      seen.add(u.defId);
      const piece = unitDef(u.defId)?.piece;
      if (piece) counts.set(piece, (counts.get(piece) ?? 0) + 1);
    }
    return counts;
  };
  /** 어려운 봇이 상점 칸을 고르는 점수: 합쳐질수록, 비쌀수록, 시너지가 새로 켜질수록 높다. */
  const score = (defId: string): number => {
    const def = unitDef(defId)!;
    const have = owned(defId);
    let value = have * 8 + (have >= 2 ? 20 : 0) + def.cost * 4;
    const thresholds = def.piece === "pawn" ? [2, 4] : [2, 3];
    const onBoard = me.board.some((u) => u.defId === defId);
    const count = pieceCounts().get(def.piece) ?? 0;
    if (!onBoard && thresholds.includes(count + 1)) value += 6;
    return value;
  };
  const buyRound = (maxBuys: number): void => {
    for (let i = 0; i < maxBuys; i++) {
      let options = me.shop
        .map((defId, slot) => ({ defId, slot }))
        .filter((o): o is { defId: string; slot: number } => o.defId !== null && unitDef(o.defId)!.cost <= me.gold);
      if (level === "easy") options = options.sort(() => rng() - 0.5);
      else if (level === "hard") options = options.sort((a, b) => score(b.defId) - score(a.defId) || a.slot - b.slot);
      else options = options.sort((a, b) => owned(b.defId) - owned(a.defId) || unitDef(b.defId)!.cost - unitDef(a.defId)!.cost || a.slot - b.slot);
      const pick = options[0];
      if (!pick || !cmd({ t: "buy", slot: pick.slot })) break;
    }
  };
  if (level === "easy") {
    buyRound(5);
  } else if (level === "normal") {
    buyRound(12);
  } else {
    // 어려움: 합칠 캐릭터와 시너지를 보고 사고, 남는 골드로는 새로고침해서 더 찾는다.
    buyRound(12);
    for (let r = 0; r < 3 && chess.round >= 2 && me.gold >= 4; r++) {
      if (!cmd({ t: "reroll" })) break;
      buyRound(6);
    }
  }

  // 2) 놓기: 가치가 높은 기물을 판 위로. 판이 가득 차면 더 약한 기물과 자리를 바꾼다. (쉬운 봇은 줄을 아무렇게나 고르고, 자리를 바꾸지 않는다)
  const limit = cap;
  const cellFree = (col: number, row: number) => !me.board.some((u) => u.col === col && u.row === row);
  /** 내 쪽(앞 두 줄)에 있는 자원 칸을 내 시점 좌표로 */
  const myTiles = chess.tiles
    .map((t) => (player.seat === 0 ? { col: t.x, row: t.y - 4 } : { col: 7 - t.x, row: 3 - t.y }))
    .filter((c) => c.row >= 0 && c.row <= 3);
  const bestCell = (defId: string): { col: number; row: number } | undefined => {
    // 어려운 봇: 앞줄~가운데 역할은 자원 칸 위에 서서 재료를 캔다.
    if (level === "hard" && BOT_ROW[unitDef(defId)!.role] <= 1) {
      const tile = myTiles.find((c) => cellFree(c.col, c.row));
      if (tile) return tile;
    }
    const base = level === "easy" ? Math.floor(rng() * 4) : BOT_ROW[unitDef(defId)!.role];
    for (let row = base; row < 4; row++) for (const col of BOT_COLS) if (cellFree(col, row)) return { col, row };
    for (let row = 0; row < base; row++) for (const col of BOT_COLS) if (cellFree(col, row)) return { col, row };
    return undefined;
  };
  const benchUnits = me.bench.filter((u): u is NonNullable<typeof u> => u !== null).sort((a, b) => unitValue(b.defId, b.star) - unitValue(a.defId, a.star));
  for (const unit of benchUnits) {
    if (me.board.length < limit) {
      const cell = bestCell(unit.defId);
      if (cell) cmd({ t: "deploy", uid: unit.uid, col: cell.col, row: cell.row });
    } else if (level !== "easy") {
      const weakest = [...me.board].sort((a, b) => unitValue(a.defId, a.star) - unitValue(b.defId, b.star))[0];
      if (weakest && unitValue(weakest.defId, weakest.star) < unitValue(unit.defId, unit.star)) {
        cmd({ t: "deploy", uid: unit.uid, col: weakest.col, row: weakest.row });
      }
    }
  }

  // 3) 무기: 가진 무기를 판 위의 가치 높은 기물부터 낀다. (쉬운 봇은 무기를 안 쓴다)
  //    같은 무기 둘은 ★2로 합치고, 어려운 봇은 무기가 기물보다 많으면 서로 다른 무기를 융합한다.
  if (chess.resources && level !== "easy") {
    for (const [weaponId, count] of Object.entries(me.weapons)) {
      if (count >= 2 && parseWeapon(weaponId)?.kind === "single") {
        for (let i = 0; i < Math.floor(count / 2); i++) cmd({ t: "combine", a: { kind: "weapon", id: weaponId }, b: { kind: "weapon", id: weaponId } });
      }
    }
    if (level === "hard") {
      for (let guard = 0; guard < 4; guard++) {
        const singles = Object.entries(me.weapons).filter(([id, n]) => n > 0 && parseWeapon(id)?.kind === "single").map(([id]) => id).sort();
        const free = me.board.filter((u) => !u.weapon).length;
        const total = Object.values(me.weapons).reduce((a, b) => a + b, 0);
        if (singles.length < 2 || total <= free) break;
        if (!cmd({ t: "combine", a: { kind: "weapon", id: singles[0]! }, b: { kind: "weapon", id: singles[1]! } })) break;
      }
    }
    // E 코드는 데도키온에게만 낀다 (데보이트를 모으는 중이면 보관해 둔다)
    const lineagePlan = units().some((u) => u.defId === "devoit" || u.defId === EVOLUTION.from);
    for (const [weaponId, count] of Object.entries(me.weapons)) {
      if (lineagePlan && EVOLUTION.branches.some((b) => b.code === weaponId)) continue;
      for (let i = 0; i < count; i++) {
        const target = me.board.filter((u) => !u.weapon).sort((a, b) => unitValue(b.defId, b.star) - unitValue(a.defId, a.star))[0];
        if (!target || !cmd({ t: "equip", weaponId, uid: target.uid })) break;
      }
    }
  }

  cmd({ t: "done" });
  return true;
}
