// 빠른 대전 매칭 대기열. Cloudflare에 의존하지 않는 순수 로직이라 단위 테스트로 검증한다.
// 비슷한 레이팅의 상대를 짝지어 주고, 오래 기다릴수록 허용하는 레이팅 차이를 넓힌다.

export const BASE_WINDOW = 100;
export const WINDOW_PER_SECOND = 40;
/** 기다리는 사람이 이 시간 동안 poll하지 않으면 떠난 것으로 본다. */
export const WAITING_TTL_MS = 15_000;
/** 짝이 지어진 표는 이 시간 뒤에 지운다(그 안에 코드를 받아 가야 한다). */
export const MATCHED_TTL_MS = 60_000;

export interface Ticket {
  id: string;
  userId: string;
  name: string;
  rating: number;
  joinedAt: number;
  lastSeen: number;
  /** 짝이 지어지면 방 코드가 채워진다. */
  code: string | null;
  matchedAt: number | null;
}

export interface Pair {
  code: string;
  a: Ticket;
  b: Ticket;
}

/** 기다린 시간(ms)에 따라 허용하는 레이팅 차이 */
export const ratingWindow = (waitedMs: number): number => BASE_WINDOW + Math.floor(waitedMs / 1000) * WINDOW_PER_SECOND;

export class MatchQueue {
  tickets = new Map<string, Ticket>();

  /** 줄을 선다. 같은 사용자가 이미 기다리고 있으면 그 표를 돌려준다. */
  join(entry: { userId: string; name: string; rating: number }, now: number, newId: () => string): Ticket {
    for (const t of this.tickets.values()) {
      if (t.userId === entry.userId && !t.code) {
        t.lastSeen = now;
        return t;
      }
    }
    const ticket: Ticket = { id: newId(), ...entry, joinedAt: now, lastSeen: now, code: null, matchedAt: null };
    this.tickets.set(ticket.id, ticket);
    return ticket;
  }

  /** 표의 상태를 확인한다(기다리는 중이면 살아 있다는 표시도 한다). 없으면 null. */
  poll(id: string, now: number): Ticket | null {
    const ticket = this.tickets.get(id);
    if (!ticket) return null;
    ticket.lastSeen = now;
    return ticket;
  }

  cancel(id: string): boolean {
    const ticket = this.tickets.get(id);
    if (!ticket || ticket.code) return false;
    return this.tickets.delete(id);
  }

  /** 떠난 사람을 치우고, 짝지을 수 있는 사람들을 짝짓는다. 새로 생긴 짝(방을 만들어야 하는 쪽)을 돌려준다. */
  tick(now: number, makeCode: () => string): Pair[] {
    for (const [id, t] of this.tickets) {
      if (!t.code && now - t.lastSeen > WAITING_TTL_MS) this.tickets.delete(id);
      else if (t.code && t.matchedAt !== null && now - t.matchedAt > MATCHED_TTL_MS) this.tickets.delete(id);
    }
    const pairs: Pair[] = [];
    const waiting = [...this.tickets.values()].filter((t) => !t.code).sort((x, y) => x.joinedAt - y.joinedAt);
    const used = new Set<string>();
    for (const a of waiting) {
      if (used.has(a.id)) continue;
      let best: Ticket | null = null;
      for (const b of waiting) {
        if (b.id === a.id || used.has(b.id) || b.userId === a.userId) continue;
        const diff = Math.abs(a.rating - b.rating);
        const allowed = Math.max(ratingWindow(now - a.joinedAt), ratingWindow(now - b.joinedAt));
        if (diff <= allowed && (!best || diff < Math.abs(a.rating - best.rating))) best = b;
      }
      if (!best) continue;
      const code = makeCode();
      used.add(a.id);
      used.add(best.id);
      a.code = best.code = code;
      a.matchedAt = best.matchedAt = now;
      pairs.push({ code, a, b: best });
    }
    return pairs;
  }

  waitingCount(): number {
    let n = 0;
    for (const t of this.tickets.values()) if (!t.code) n++;
    return n;
  }
}
