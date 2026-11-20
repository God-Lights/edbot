// Elo 레이팅. 시작은 1000, K는 처음 10판 동안 40으로 빠르게 자리를 찾고 그 뒤에는 24.

export const START_RATING = 1000;
export const K_PROVISIONAL = 40;
export const K_STANDARD = 24;
export const PROVISIONAL_GAMES = 10;

export function kFactor(games: number): number {
  return games < PROVISIONAL_GAMES ? K_PROVISIONAL : K_STANDARD;
}

/** 내가 이길 것으로 기대하는 확률. */
export function expectedScore(mine: number, theirs: number): number {
  return 1 / (1 + Math.pow(10, (theirs - mine) / 400));
}

/** 한 판의 결과를 반영한 새 레이팅. score: 승 1, 무 0.5, 패 0. */
export function nextRating(mine: number, theirs: number, score: 0 | 0.5 | 1, games: number): number {
  return Math.round(mine + kFactor(games) * (score - expectedScore(mine, theirs)));
}
