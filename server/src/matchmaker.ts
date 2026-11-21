// 빠른 대전 매칭을 맡은 Durable Object (전체에서 하나). 대기열은 메모리에 두고, 사라져도 다시 줄 서면 되도록 가볍게 저장한다.

import { DurableObject } from "cloudflare:workers";
import { generateRoomCode } from "./codes";
import { MatchQueue } from "./matchmaking";
import type { Ticket } from "./matchmaking";

export interface TicketStatus {
  ticket: string;
  status: "waiting" | "matched";
  code: string | null;
  /** 기다린 시간(ms) */
  waitedMs: number;
  /** 지금 줄 서 있는 사람 수 */
  waiting: number;
}

export class Matchmaker extends DurableObject<Env> {
  private queue = new MatchQueue();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<Ticket[]>("tickets");
      for (const t of saved ?? []) this.queue.tickets.set(t.id, t);
    });
  }

  private async settle(now: number): Promise<void> {
    const pairs = this.queue.tick(now, generateRoomCode);
    for (const pair of pairs) {
      // 코드가 겹쳐서 이미 있는 방이면(드묾) 다른 코드로 다시 시도한다.
      let code = pair.code;
      for (let attempt = 0; attempt < 8; attempt++) {
        if (await this.env.ROOM.get(this.env.ROOM.idFromName(code)).init(code, false, "chess")) break;
        code = generateRoomCode();
      }
      pair.a.code = pair.b.code = code;
    }
    await this.ctx.storage.put("tickets", [...this.queue.tickets.values()]);
  }

  private status(t: Ticket, now: number): TicketStatus {
    return { ticket: t.id, status: t.code ? "matched" : "waiting", code: t.code, waitedMs: now - t.joinedAt, waiting: this.queue.waitingCount() };
  }

  async join(entry: { userId: string; name: string; rating: number }, now = Date.now()): Promise<TicketStatus> {
    const ticket = this.queue.join(entry, now, () => crypto.randomUUID());
    await this.settle(now);
    return this.status(ticket, now);
  }

  async poll(ticketId: string, now = Date.now()): Promise<TicketStatus | null> {
    const ticket = this.queue.poll(ticketId, now);
    if (!ticket) return null;
    await this.settle(now);
    const fresh = this.queue.tickets.get(ticketId);
    return fresh ? this.status(fresh, now) : null;
  }

  async cancel(ticketId: string): Promise<boolean> {
    const ok = this.queue.cancel(ticketId);
    if (ok) await this.ctx.storage.put("tickets", [...this.queue.tickets.values()]);
    return ok;
  }
}
