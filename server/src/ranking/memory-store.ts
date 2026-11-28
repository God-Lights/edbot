// 메모리에 전적과 랭킹을 두는 저장소. D1 저장소(store.ts)와 같은 결과를 내야 한다. (같은 시험을 둘 다 통과한다)
// 로컬 서버는 이것을 이어받아 파일에 저장한다. (local-server/src/runtime/json-store.ts)
// 행의 모양은 D1 표(migrations/)의 열과 같아서, 내보낸 JSON을 D1 행으로 바로 바꿀 수 있다.

import { START_RATING, nextRating } from "./elo";
import { MAX_LEADERBOARD, matchIdOf } from "./store";
import type {
  LeaderboardEntry, MatchInput, MatchSummary, PlayerRow, PlayerStats, RankingStore, RatingChange,
} from "./store";

/** matches 표의 한 행 */
export interface StoredMatch {
  id: string;
  room_code: string;
  started_at: number;
  ended_at: number;
  user0: string;
  user1: string;
  winner_seat: number | null;
  reason: string;
  score0: number;
  score1: number;
  kills0: number;
  kills1: number;
  /** JSON 문자열 */
  picks0: string;
  picks1: string;
  rating0_before: number;
  rating1_before: number;
  rating0_after: number;
  rating1_after: number;
  /** 판에 적힌 닉네임 (봇은 선수 표에 없다). 파일 저장소는 이 기록만으로 선수 표를 다시 만든다. */
  nickname0?: string;
  nickname1?: string;
  /** false 면 레이팅·승패 수에 넣지 않은 게임 기록 (봇과 한 판). 없으면 true */
  rated?: boolean;
}

/** replays 표의 한 행 */
export interface StoredReplay {
  id: string;
  created_at: number;
  data: string;
}

/** 내보내고 불러오는 JSON 한 덩어리 */
export interface RankingData {
  schemaVersion: 1;
  players: PlayerRow[];
  matches: StoredMatch[];
  replays: StoredReplay[];
}

export class MemoryRankingStore implements RankingStore {
  protected players = new Map<string, PlayerRow>();
  protected matches: StoredMatch[] = [];
  protected matchIds = new Set<string>();
  protected replays = new Map<string, StoredReplay>();

  /** 한 판이 저장될 때마다 불린다. (파일 저장소가 이어받아 디스크에 쓴다) */
  protected onMatchRecorded(_match: StoredMatch, _changedPlayers: PlayerRow[]): void {}
  /** 다시 보기가 저장될 때 불린다. */
  protected onReplaySaved(_replay: StoredReplay): void {}

  async recordMatch(input: MatchInput): Promise<[RatingChange, RatingChange] | null> {
    const id = matchIdOf(input.roomCode, input.startedAt);
    if (this.matchIds.has(id)) return null;

    const rows = input.users.map((u) => this.players.get(u.userId) ?? null);
    const before = rows.map((row) => row?.rating ?? START_RATING) as [number, number];
    const games = rows.map((row) => row?.games ?? 0) as [number, number];
    const scoreOf = (seat: 0 | 1): 0 | 0.5 | 1 => (input.winnerSeat === null ? 0.5 : input.winnerSeat === seat ? 1 : 0);
    const after: [number, number] = [
      nextRating(before[0], before[1], scoreOf(0), games[0]),
      nextRating(before[1], before[0], scoreOf(1), games[1]),
    ];

    // 봇과 한 판: 게임 기록만 남기고 선수 표(레이팅·승패 수)는 그대로
    const rated = input.rated !== false;
    const changed: PlayerRow[] = [];
    for (const seat of [0, 1] as const) {
      if (!rated) break;
      const user = input.users[seat];
      const score = scoreOf(seat);
      const old = this.players.get(user.userId);
      const next: PlayerRow = {
        user_id: user.userId,
        nickname: user.nickname,
        rating: after[seat],
        games: (old?.games ?? 0) + 1,
        wins: (old?.wins ?? 0) + (score === 1 ? 1 : 0),
        losses: (old?.losses ?? 0) + (score === 0 ? 1 : 0),
        draws: (old?.draws ?? 0) + (score === 0.5 ? 1 : 0),
        updated_at: input.endedAt,
      };
      this.players.set(user.userId, next);
      changed.push(next);
    }
    const match: StoredMatch = {
      id,
      room_code: input.roomCode,
      started_at: input.startedAt,
      ended_at: input.endedAt,
      user0: input.users[0].userId,
      user1: input.users[1].userId,
      winner_seat: input.winnerSeat,
      reason: input.reason,
      score0: input.score[0],
      score1: input.score[1],
      kills0: input.kills[0],
      kills1: input.kills[1],
      picks0: JSON.stringify(input.picks[0]),
      picks1: JSON.stringify(input.picks[1]),
      rating0_before: before[0],
      rating1_before: before[1],
      rating0_after: rated ? after[0] : before[0],
      rating1_after: rated ? after[1] : before[1],
      nickname0: input.users[0].nickname,
      nickname1: input.users[1].nickname,
      ...(rated ? {} : { rated: false }),
    };
    this.matches.push(match);
    this.matchIds.add(id);
    this.onMatchRecorded(match, changed);
    return [
      { before: before[0], after: match.rating0_after },
      { before: before[1], after: match.rating1_after },
    ];
  }

  /** 레이팅 순위. 같은 레이팅이면 판수가 많은 쪽, 그다음 먼저 도달한 쪽이 위. */
  private ranked(): PlayerRow[] {
    return [...this.players.values()]
      .filter((p) => p.games > 0)
      .sort((a, b) => b.rating - a.rating || b.games - a.games || a.updated_at - b.updated_at);
  }

  async getLeaderboard(limit: number, meUserId: string | null): Promise<LeaderboardEntry[]> {
    const size = Math.max(1, Math.min(MAX_LEADERBOARD, Math.floor(limit)));
    return this.ranked().slice(0, size).map((row, index) => ({
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

  async getPlayerStats(userId: string): Promise<PlayerStats | null> {
    const row = this.players.get(userId);
    if (!row || row.games === 0) return null;
    const better = this.ranked().filter(
      (p) => p.rating > row.rating
        || (p.rating === row.rating && p.games > row.games)
        || (p.rating === row.rating && p.games === row.games && p.updated_at < row.updated_at),
    ).length;
    return {
      nickname: row.nickname,
      rating: row.rating,
      rank: better + 1,
      games: row.games,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
    };
  }

  async getRecentMatches(userId: string, limit: number): Promise<MatchSummary[]> {
    const size = Math.max(1, Math.min(50, Math.floor(limit)));
    // 끝난 시각이 같으면 나중에 저장된 판이 위.
    const mine = this.matches
      .map((m, order) => ({ m, order }))
      .filter(({ m }) => m.user0 === userId || m.user1 === userId)
      .sort((a, b) => b.m.ended_at - a.m.ended_at || b.order - a.order)
      .slice(0, size);
    return mine.map(({ m }) => {
      const seat = m.user0 === userId ? 0 : 1;
      const pick = <T>(a: T, b: T): T => (seat === 0 ? a : b);
      const other = <T>(a: T, b: T): T => (seat === 0 ? b : a);
      return {
        id: m.id,
        endedAt: m.ended_at,
        opponent: this.players.get(pick(m.user1, m.user0))?.nickname ?? pick(m.nickname1, m.nickname0) ?? "?",
        result: m.winner_seat === null ? "draw" : m.winner_seat === seat ? "win" : "loss",
        reason: m.reason,
        score: [pick(m.score0, m.score1), other(m.score0, m.score1)],
        kills: [pick(m.kills0, m.kills1), other(m.kills0, m.kills1)],
        picks: JSON.parse(pick(m.picks0, m.picks1)) as string[],
        opponentPicks: JSON.parse(other(m.picks0, m.picks1)) as string[],
        ratingBefore: pick(m.rating0_before, m.rating1_before),
        ratingAfter: pick(m.rating0_after, m.rating1_after),
        rated: m.rated !== false,
      } satisfies MatchSummary;
    });
  }

  async saveReplay(id: string, data: string, now = Date.now()): Promise<void> {
    if (this.replays.has(id)) return;
    const replay: StoredReplay = { id, created_at: now, data };
    this.replays.set(id, replay);
    this.onReplaySaved(replay);
  }

  /** 랭킹을 처음부터 (선수 표와 판 기록을 비운다). 다시 보기는 남긴다. */
  async resetRanking(_now?: Date): Promise<string | null> {
    this.players.clear();
    this.matches.length = 0;
    this.matchIds.clear();
    return null;
  }

  async getReplay(id: string): Promise<string | null> {
    return this.replays.get(id)?.data ?? null;
  }

  // ---- 내보내기와 불러오기 ----

  exportData(): RankingData {
    return {
      schemaVersion: 1,
      players: [...this.players.values()].map((p) => ({ ...p })),
      matches: this.matches.map((m) => ({ ...m })),
      replays: [...this.replays.values()].map((r) => ({ ...r })),
    };
  }

  /**
   * JSON 한 덩어리를 합친다. 이미 있는 판(id)과 다시 보기, 이미 있는 선수는 그대로 두고 없는 것만 넣는다.
   * (저장 훅은 부르지 않는다. 불러온 쪽이 한꺼번에 저장한다.) 새로 들어온 개수를 돌려준다.
   */
  mergeData(data: Partial<RankingData>): { players: number; matches: number; replays: number } {
    const added = { players: 0, matches: 0, replays: 0 };
    for (const p of data.players ?? []) {
      if (this.players.has(p.user_id)) continue;
      this.players.set(p.user_id, { ...p });
      added.players += 1;
    }
    for (const m of data.matches ?? []) {
      if (this.matchIds.has(m.id)) continue;
      this.matches.push({ ...m });
      this.matchIds.add(m.id);
      added.matches += 1;
    }
    for (const r of data.replays ?? []) {
      if (this.replays.has(r.id)) continue;
      this.replays.set(r.id, { ...r });
      added.replays += 1;
    }
    return added;
  }

  isEmpty(): boolean {
    return this.players.size === 0 && this.matches.length === 0 && this.replays.size === 0;
  }
}
