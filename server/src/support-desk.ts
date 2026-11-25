// 문의 데스크 (Durable Object 하나, 이름 "global"). 로직은 support-core.ts 에 있고, 여기서는 저장소를 꽂는다.
import { DurableObject } from "cloudflare:workers";
import { SupportDeskCore } from "./support-core";
import type { SupportStorage } from "./support-core";

export class SupportDesk extends DurableObject {
  private core(): SupportDeskCore {
    return new SupportDeskCore(this.ctx.storage as unknown as SupportStorage);
  }

  post(input: { thread?: string; name?: unknown; text: unknown; client: string }) { return this.core().post(input); }
  view(id: string) { return this.core().view(id); }
  list() { return this.core().list(); }
  adminView(id: string) { return this.core().adminView(id); }
  reply(id: string, text: unknown) { return this.core().reply(id, text); }
  setClosed(id: string, closed: boolean) { return this.core().setClosed(id, closed); }
}
