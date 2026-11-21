// 테스트 대전(ADMN)의 상대 봇. 사람처럼 같은 함수(playerBan, playerPick ...)로 행동하므로 규칙을 따로 흉내 내지 않는다.
// 솜씨는 일부러 단순하다: 무작위로 밴·뽑기·배치하고, 간단히 채집·조합·장착하고, 적과 맞붙으면 궁극기를 쓴다.

import { availableIds, currentTurnSeat } from "./game";
import { CHARACTERS } from "./characters";
import type { Lane } from "./protocol";
import { LANES } from "./protocol";
import {
  BOT_ID,
  playerBan,
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
