// 체스판 자동 전투 상태를 보는 사람에 맞춰 줄인다. 상대의 상점, 골드, 판은 준비 단계에서 보이지 않는다.

import type { ChessSelfSnapshot, ChessSnapshot, ChessUnitView, Seat } from "../protocol";
import { rules } from "./content";
import { DEATHMATCH_GOLD, bothDone, deployCap, interest, rerollCost, shopOdds, winTarget } from "./game";
import type { ChessGame, ChessPlayer } from "./game";
import { activeSynergies } from "./synergy";
import { MARKET_PRICE, materialDef } from "./weapons";

function self(player: ChessPlayer): ChessSelfSnapshot {
  const view = (u: { uid: string; defId: string; star: 1 | 2; weapon?: string; evo?: { engine: number; core: number } }): ChessUnitView => ({
    uid: u.uid, defId: u.defId, star: u.star, ...(u.weapon ? { weapon: u.weapon } : {}), ...(u.evo ? { evo: { ...u.evo } } : {}),
  });
  return {
    hp: player.hp,
    gold: player.gold,
    shop: [...player.shop],
    bench: player.bench.map((u) => (u ? view(u) : null)),
    board: player.board.map((u) => ({ ...view(u), col: u.col, row: u.row })),
    done: player.done,
    rerollCost: rerollCost(player),
    nextIncome: rules().baseIncome + interest(player.gold),
    synergies: activeSynergies(player.board.map((u) => u.defId)),
    materials: Object.fromEntries(Object.entries(player.materials).filter(([, n]) => n > 0)),
    weapons: Object.fromEntries(Object.entries(player.weapons).filter(([, n]) => n > 0)),
    smelters: [...player.smelters],
    marketBought: player.marketBought,
    evolved: [...(player.evolved ?? [])],
  };
}

export function toChessSnapshot(game: ChessGame, viewerSeat: Seat | null, showCombat: boolean): ChessSnapshot {
  const other = viewerSeat === null ? null : game.players[viewerSeat === 0 ? 1 : 0];
  return {
    round: game.round,
    maxRounds: rules().maxRounds,
    // 8전 5승제: 예전 앱은 이 값을 시작 체력으로, hps 를 남은 체력으로 보여 준다 (남은 목숨 5 → 0)
    startHp: winTarget(),
    winTarget: winTarget(),
    ...((game.deathmatch ?? 0) > 0 ? { deathmatch: game.deathmatch, deathmatchGold: DEATHMATCH_GOLD } : {}),
    // 라운드별 승자 (이 판의 기록 화면). 데스매치 라운드는 몇 번째인지도
    roundResults: game.history.map((r) => ({ round: r.round, winner: r.winner, ...(r.deathmatch ? { deathmatch: r.deathmatch } : {}) })),
    deployCap: deployCap(game.round),
    shopOdds: shopOdds(game.round, game.lite),
    lite: game.lite,
    mobius: game.mobius,
    hps: [game.players[0].hp, game.players[1].hp],
    me: viewerSeat === null ? null : self(game.players[viewerSeat]),
    tiles: game.resources ? game.tiles.map((t) => ({ ...t })) : [],
    market: game.resources
      ? game.market.map((id) => ({ material: id, price: MARKET_PRICE[materialDef(id)?.rarity ?? "common"] ?? 0 }))
      : [],
    opponent: other ? { hp: other.hp, done: other.done, boardCount: other.board.length } : null,
    combat:
      showCombat && game.combat
        ? {
            boards: game.combat.boards,
            units: game.combat.units,
            frames: game.combat.frames,
            events: game.combat.events,
            winner: game.combat.result.winner,
            survivors: game.combat.result.survivors,
            damage: game.combat.damage,
            beats: game.combat.result.beats,
            tiles: game.combat.tiles,
            mines: game.combat.mines,
            goldBonus: game.combat.goldBonus,
            ...(game.mobius ? { mobius: true } : {}),
          }
        : null,
    lastRound: game.lastRound,
    roundWins: game.roundWins,
  };
}

export { bothDone };
