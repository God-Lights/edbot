// 진행 중인 게스트 방 목록 (관전할 곳 고르기). Cloudflare에 의존하지 않는 순수 로직.

export const LIVE_TTL_MS = 20 * 60_000;

export interface LiveRoom {
  code: string;
  /** 방을 만든 GL 계정의 닉네임 */
  host: string;
  /** 방을 만든 GL 계정의 id. 밖으로 내보내지 않는다. */
  hostId: string;
  /** 게스트 방 (학번과 이름으로 들어올 수 있다) */
  guest: boolean;
  players: Array<{ name: string; studentId?: string; connected: boolean }>;
  phase: string;
  round: number;
  maxRounds: number;
  /** seat별 체력 (게임이 시작되기 전에는 null) */
  hps: [number, number] | null;
  updatedAt: number;
}

export class LiveBoard {
  rooms = new Map<string, LiveRoom>();

  upsert(room: LiveRoom): void {
    this.rooms.set(room.code, room);
  }

  remove(code: string): boolean {
    return this.rooms.delete(code);
  }

  /** 오래 갱신되지 않은 방을 치우고, 최근에 바뀐 순서로 돌려준다. */
  list(now: number): LiveRoom[] {
    for (const [code, room] of this.rooms) if (now - room.updatedAt > LIVE_TTL_MS) this.rooms.delete(code);
    return [...this.rooms.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }
}
