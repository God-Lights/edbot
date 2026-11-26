// 전적과 랭킹을 저장하고 읽는다. 저장소는 RankingStore 하나로 감싸서, 운영·개발은 D1을, 로컬 서버는 JSON 파일을 꽂는다.

import { START_RATING, nextRating } from "./elo";

export interface MatchInput {
  roomCode: string;
  startedAt: number;
  endedAt: number;
  users: [{ userId: string; nickname: string }, { userId: string; nickname: string }];
  winnerSeat: 0 | 1 | null;
  reason: string;
  score: [number, number];
  kills: [number, number];
  picks: [string[], string[]];
}

export interface RatingChange {
  before: number;
  after: number;
}

export interface PlayerRow {
  user_id: string;
  nickname: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  updated_at: number;
}

async function loadPlayer(db: D1Database, userId: string): Promise<PlayerRow | null> {
  return db.prepare("SELECT * FROM players WHERE user_id = ?").bind(userId).first<PlayerRow>();
}

/**
 * 한 판의 결과와 레이팅 변화를 저장한다. 같은 판(방 코드 + 시작 시각)은 한 번만 저장되고,
 * 이미 저장되어 있으면 null을 돌려준다.
 */
export async function recordMatch(db: D1Database, input: MatchInput): Promise<[RatingChange, RatingChange] | null> {
  const id = matchIdOf(input.roomCode, input.startedAt);
  const existing = await db.prepare("SELECT 1 AS found FROM matches WHERE id = ?").bind(id).first();
  if (existing) return null;

  const rows = await Promise.all(input.users.map((u) => loadPlayer(db, u.userId)));
  const before = rows.map((row) => row?.rating ?? START_RATING) as [number, number];
  const games = rows.map((row) => row?.games ?? 0) as [number, number];
  const scoreOf = (seat: 0 | 1): 0 | 0.5 | 1 => (input.winnerSeat === null ? 0.5 : input.winnerSeat === seat ? 1 : 0);
  const after: [number, number] = [
    nextRating(before[0], before[1], scoreOf(0), games[0]),
    nextRating(before[1], before[0], scoreOf(1), games[1]),
  ];

  const upsert = db.prepare(
    `INSERT INTO players (user_id, nickname, rating, games, wins, losses, draws, updated_at)
     VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7)
     ON CONFLICT(user_id) DO UPDATE SET
       nickname = excluded.nickname, rating = excluded.rating, games = games + 1,
       wins = wins + ?4, losses = losses + ?5, draws = draws + ?6, updated_at = excluded.updated_at`,
  );
  const statements = ([0, 1] as const).map((seat) => {
    const score = scoreOf(seat);
    return upsert.bind(
      input.users[seat].userId,
      input.users[seat].nickname,
      after[seat],
      score === 1 ? 1 : 0,
      score === 0 ? 1 : 0,
      score === 0.5 ? 1 : 0,
      input.endedAt,
    );
  });
  statements.push(
    db
      .prepare(
        `INSERT OR IGNORE INTO matches (id, room_code, started_at, ended_at, user0, user1, winner_seat, reason,
           score0, score1, kills0, kills1, picks0, picks1,
           rating0_before, rating1_before, rating0_after, rating1_after)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
      )
      .bind(
        id, input.roomCode, input.startedAt, input.endedAt,
        input.users[0].userId, input.users[1].userId, input.winnerSeat, input.reason,
        input.score[0], input.score[1], input.kills[0], input.kills[1],
        JSON.stringify(input.picks[0]), JSON.stringify(input.picks[1]),
        before[0], before[1], after[0], after[1],
      ),
  );
  await db.batch(statements);
  return [
    { before: before[0], after: after[0] },
    { before: before[1], after: after[1] },
  ];
}

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  isMe: boolean;
}

export const MAX_LEADERBOARD = 100;

/** 레이팅 순위. 같은 레이팅이면 판수가 많은 쪽, 그다음 먼저 도달한 쪽이 위. */
export async function getLeaderboard(db: D1Database, limit: number, meUserId: string | null): Promise<LeaderboardEntry[]> {
  const size = Math.max(1, Math.min(MAX_LEADERBOARD, Math.floor(limit)));
  const { results } = await db
    .prepare("SELECT * FROM players WHERE games > 0 ORDER BY rating DESC, games DESC, updated_at ASC LIMIT ?")
    .bind(size)
    .all<PlayerRow>();
  return results.map((row, index) => ({
    rank: index + 1,
    nickname: row.nickname,
    rating: row.rating,
    games: row.games,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    isMe: meUserId !== null && row.user_id === meUserId,
  }));
}

export interface PlayerStats {
  nickname: string;
  rating: number;
  rank: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

/** 내 전적과 순위. 한 판도 안 했으면 null. */
export async function getPlayerStats(db: D1Database, userId: string): Promise<PlayerStats | null> {
  const row = await loadPlayer(db, userId);
  if (!row || row.games === 0) return null;
  const better = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM players
       WHERE games > 0 AND (rating > ?1 OR (rating = ?1 AND games > ?2) OR (rating = ?1 AND games = ?2 AND updated_at < ?3))`,
    )
    .bind(row.rating, row.games, row.updated_at)
    .first<{ n: number }>();
  return {
    nickname: row.nickname,
    rating: row.rating,
    rank: (better?.n ?? 0) + 1,
    games: row.games,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
  };
}

export interface MatchSummary {
  /** 다시 보기를 불러올 때 쓰는 판 id */
  id: string;
  endedAt: number;
  opponent: string;
  /** win | loss | draw */
  result: "win" | "loss" | "draw";
  reason: string;
  score: [number, number];
  kills: [number, number];
  picks: string[];
  opponentPicks: string[];
  ratingBefore: number;
  ratingAfter: number;
}

interface MatchRow {
  id: string;
  ended_at: number;
  user0: string;
  user1: string;
  winner_seat: number | null;
  reason: string;
  score0: number;
  score1: number;
  kills0: number;
  kills1: number;
  picks0: string;
  picks1: string;
  rating0_before: number;
  rating1_before: number;
  rating0_after: number;
  rating1_after: number;
  opponent_nickname: string | null;
}

/** 내 최근 판. 점수와 처치는 [내 쪽, 상대 쪽] 순서다. */
export async function getRecentMatches(db: D1Database, userId: string, limit: number): Promise<MatchSummary[]> {
  const size = Math.max(1, Math.min(50, Math.floor(limit)));
  const { results } = await db
    .prepare(
      `SELECT m.*, p.nickname AS opponent_nickname FROM matches m
       LEFT JOIN players p ON p.user_id = CASE WHEN m.user0 = ?1 THEN m.user1 ELSE m.user0 END
       WHERE m.user0 = ?1 OR m.user1 = ?1 ORDER BY m.ended_at DESC LIMIT ?2`,
    )
    .bind(userId, size)
    .all<MatchRow>();
  return results.map((m) => {
    const seat = m.user0 === userId ? 0 : 1;
    const mine = <T>(a: T, b: T): T => (seat === 0 ? a : b);
    const theirs = <T>(a: T, b: T): T => (seat === 0 ? b : a);
    return {
      id: m.id,
      endedAt: m.ended_at,
      opponent: m.opponent_nickname ?? "?",
      result: m.winner_seat === null ? "draw" : m.winner_seat === seat ? "win" : "loss",
      reason: m.reason,
      score: [mine(m.score0, m.score1), theirs(m.score0, m.score1)],
      kills: [mine(m.kills0, m.kills1), theirs(m.kills0, m.kills1)],
      picks: JSON.parse(mine(m.picks0, m.picks1)) as string[],
      opponentPicks: JSON.parse(theirs(m.picks0, m.picks1)) as string[],
      ratingBefore: mine(m.rating0_before, m.rating1_before),
      ratingAfter: mine(m.rating0_after, m.rating1_after),
    };
  });
}

/** 한 판의 다시 보기 데이터(JSON 문자열)를 저장한다. 이미 있으면 그대로 둔다. */
export async function saveReplay(db: D1Database, id: string, data: string, now = Date.now()): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO replays (id, created_at, data) VALUES (?1, ?2, ?3)").bind(id, now, data).run();
}

/** 다시 보기 데이터(JSON 문자열). 없으면 null. */
export async function getReplay(db: D1Database, id: string): Promise<string | null> {
  const row = await db.prepare("SELECT data FROM replays WHERE id = ?").bind(id).first<{ data: string }>();
  return row?.data ?? null;
}

/** 방 코드와 시작 시각으로 만든 판 id (recordMatch와 같은 규칙) */
export const matchIdOf = (roomCode: string, startedAt: number): string => `${roomCode}:${startedAt}`;

// ---- 저장소 한 겹 ----

/**
 * 전적과 랭킹을 저장하는 곳. 서버 코드는 이 여섯 가지만 안다.
 * 운영·개발: D1(d1RankingStore). 로컬 서버: JSON 파일(local-server). 시험: 메모리(memory-store.ts).
 */
export interface RankingStore {
  recordMatch(input: MatchInput): Promise<[RatingChange, RatingChange] | null>;
  getLeaderboard(limit: number, meUserId: string | null): Promise<LeaderboardEntry[]>;
  getPlayerStats(userId: string): Promise<PlayerStats | null>;
  getRecentMatches(userId: string, limit: number): Promise<MatchSummary[]>;
  saveReplay(id: string, data: string, now?: number): Promise<void>;
  getReplay(id: string): Promise<string | null>;
  /** 랭킹을 처음부터 (선수 표와 판 기록을 백업하고 비운다). 로컬 저장소만 */
  resetRanking?(): Promise<string | null>;
}

export function d1RankingStore(db: D1Database): RankingStore {
  return {
    recordMatch: (input) => recordMatch(db, input),
    getLeaderboard: (limit, me) => getLeaderboard(db, limit, me),
    getPlayerStats: (userId) => getPlayerStats(db, userId),
    getRecentMatches: (userId, limit) => getRecentMatches(db, userId, limit),
    saveReplay: (id, data, now) => saveReplay(db, id, data, now),
    getReplay: (id) => getReplay(db, id),
  };
}

/** env.STORE(로컬 서버가 꽂아 주는 저장소)가 있으면 그것을, 없으면 D1을 쓴다. */
export function rankingStoreOf(env: { DB?: D1Database; STORE?: RankingStore }): RankingStore {
  if (env.STORE) return env.STORE;
  if (!env.DB) throw new Error("전적 저장소가 없다. (DB 또는 STORE가 필요하다)");
  return d1RankingStore(env.DB);
}
