// 진행 중인 게스트 방을 모아 두는 Durable Object (전체에서 하나). 방이 바뀔 때마다 알려 주고, 관전 목록이 여기서 나온다.

import { DurableObject } from "cloudflare:workers";
import { LiveBoard } from "./liveboard";
import type { LiveRoom } from "./liveboard";

export class LiveRegistry extends DurableObject<Env> {
  private board = new LiveBoard();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<LiveRoom[]>("rooms");
      for (const room of saved ?? []) this.board.upsert(room);
    });
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put("rooms", [...this.board.rooms.values()]);
  }

  async upsert(room: LiveRoom): Promise<void> {
    this.board.upsert(room);
    await this.save();
  }

  async remove(code: string): Promise<void> {
    if (this.board.remove(code)) await this.save();
  }

  async list(now = Date.now()): Promise<LiveRoom[]> {
    return this.board.list(now);
  }
}
