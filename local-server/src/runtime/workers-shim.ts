// `cloudflare:workers` 모듈의 대신. 서버 코드는 `import { DurableObject } from "cloudflare:workers"`를 그대로 쓴다.
// 빌드할 때(`plugin.ts`, `build.ts`) 이 파일로 바꿔치기한다.

export class DurableObject<Env = unknown> {
  readonly ctx: unknown;
  readonly env: Env;
  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
