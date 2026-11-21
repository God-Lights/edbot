// 체스판 자동 전투 상태를 보는 사람에 맞춰 줄인다. 상대의 상점, 골드, 판은 준비 단계에서 보이지 않는다.

import type { ChessSelfSnapshot, ChessSnapshot, ChessUnitView, Seat } from "../protocol";
import { MAX_ROUNDS, bothDone, deployCap, interest, rerollCost, shopOdds, BASE_INCOME } from "./game";
import type { ChessGame, ChessPlayer } from "./game";
import { activeSynergies } from "./synergy";

function self(player: ChessPlayer): ChessSelfSnapshot {
  const view = (u: { uid: string; defId: string; star: 1 | 2 }): ChessUnitView => ({ uid: u.uid, defId: u.defId, star: u.star });
  return {
    hp: player.hp,
    gold: player.gold,
    shop: [...player.shop],
    bench: player.bench.map((u) => (u ? view(u) : null)),
    board: player.board.map((u) => ({ ...view(u), col: u.col, row: u.row })),
    done: player.done,
    rerollCost: rerollCost(player),
    nextIncome: BASE_INCOME + interest(player.gold),
    synergies: activeSynergies(player.board.map((u) => u.defId)),
  };
}

export function toChessSnapshot(game: ChessGame, viewerSeat: Seat | null, showCombat: boolean): ChessSnapshot {
  const other = viewerSeat === null ? null : game.players[viewerSeat === 0 ? 1 : 0];
  return {
    round: game.round,
    maxRounds: MAX_ROUNDS,
    deployCap: deployCap(game.round),
    shopOdds: shopOdds(game.round, game.lite),
    lite: game.lite,
    me: viewerSeat === null ? null : self(game.players[viewerSeat]),
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
          }
        : null,
    lastRound: game.lastRound,
    roundWins: game.roundWins,
  };
}

export { bothDone };
