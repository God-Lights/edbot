// iOS 서버 앱의 엔진: 서버 엔진(server/src)을 숨은 웹뷰(WKWebView) 안에서 돌리는 묶음의 진입점.
// 앱(Swift)은 접속을 받는 일(HTTP/WebSocket)과 파일 저장을 맡고, 요청을 이 엔진에 넘긴다.
//
//   const engine = CommanderEngine.start({ host, files, name, edition, ... })
//   await engine.fetch({ method, url, headers, body })   -> { status, headers, body, ws? }
//   engine.wsMessage(id, text) / engine.wsClose(id, code, reason)
//
// host.post(메시지)로 앱에 알린다:
//   { t: "fs", ops: [...] }                       파일 변경(순서대로 적용)
//   { t: "ws-send", id, data } / { t: "ws-close", id, code, reason }
//   { t: "log", level, text }

import "./globals";
import { ObjectNamespace } from "../../../local-server/src/runtime/objects";
import { JsonRankingStore } from "../../../local-server/src/runtime/json-store";
import { upgradeTarget } from "../../../local-server/src/runtime/websocket";
import type { ServerSocket } from "../../../local-server/src/runtime/websocket";
import { loadPlugins } from "../../../local-server/src/plugins";
import { MemFs } from "./memfs";
import type { FsOp } from "./memfs";
import worker, { Room, AuthStore, Matchmaker, LiveRegistry, SupportDesk } from "../../../server/src/index";

export interface Host {
  post(message: unknown): void;
}

export interface StartOptions {
  host: Host;
  /** 앱이 읽어 준 데이터 파일 전체 (경로는 데이터 폴더 기준, 예: "data/players.json") */
  files: Record<string, string>;
  name: string;
  edition: "vanilla" | "expert";
  version?: string;
  /** 단계 시간 배율(시험용). 기본 "1" */
  phaseScale?: string;
}

export interface EngineRequest {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  /** base64 */
  body?: string | null;
}

export interface EngineResponse {
  status: number;
  headers: Array<[string, string]>;
  /** base64 */
  body: string;
  /** WebSocket으로 올려야 하면 연결 번호 */
  ws?: number;
}

const toBase64 = (bytes: Uint8Array): string => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};
const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

class HostSocket {
  constructor(private readonly id: number, private readonly host: Host) {}
  send(data: string | ArrayBuffer | Uint8Array): void {
    this.host.post({ t: "ws-send", id: this.id, data: typeof data === "string" ? data : toBase64(new Uint8Array(data as ArrayBuffer)), binary: typeof data !== "string" });
  }
  close(code = 1000, reason = ""): void {
    this.host.post({ t: "ws-close", id: this.id, code, reason });
  }
}

export function start(options: StartOptions) {
  const { host } = options;
  const fs = new MemFs(options.files, (ops: FsOp[]) => host.post({ t: "fs", ops }));
  for (const level of ["log", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => host.post({ t: "log", level, text: args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") });
  }

  fs.mkdir("data");
  const store = new JsonRankingStore("data", "backups", fs);
  store.backup();

  let plugins: ReturnType<typeof loadPlugins> | null = null;
  if (options.edition === "expert") plugins = loadPlugins(".", fs);

  const env: Record<string, unknown> = {
    STORE: store,
    PHASE_SCALE: options.phaseScale ?? "1",
    AUTH_MODE: "open",
    SERVER_ENV: "local",
    SERVER_NAME: options.name,
    EDITION: options.edition,
    SERVER_VERSION: options.version ?? "0.1.0",
    RECORD_ANONYMOUS: "true",
  };
  const envOf = () => env;
  const namespaces = {
    ROOM: new ObjectNamespace("Room", Room as never, envOf, ".", fs),
    AUTH: new ObjectNamespace("AuthStore", AuthStore as never, envOf, ".", fs),
    MATCH: new ObjectNamespace("Matchmaker", Matchmaker as never, envOf, ".", fs),
    LIVE: new ObjectNamespace("LiveRegistry", LiveRegistry as never, envOf, ".", fs),
    SUPPORT: new ObjectNamespace("SupportDesk", SupportDesk as never, envOf, ".", fs),
  };
  Object.assign(env, namespaces);
  const woken = Object.values(namespaces).reduce((sum, ns) => sum + ns.wakeAll(), 0);

  const sockets = new Map<number, ServerSocket>();
  let nextSocket = 1;

  return {
    woken,
    plugins: plugins && { accepted: plugins.accepted, rejected: plugins.rejected, notes: plugins.notes, ruleset: plugins.ruleset },

    async fetch(req: EngineRequest): Promise<EngineResponse> {
      const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body;
      const request = new Request(req.url, { method: req.method, headers: req.headers, body: hasBody ? fromBase64(req.body!) : undefined });
      let response: Response;
      try {
        response = await (worker as { fetch(r: Request, e: unknown): Promise<Response> }).fetch(request, env);
      } catch (error) {
        console.error("[요청 오류]", req.method, req.url, error);
        return { status: 500, headers: [["content-type", "application/json"]], body: btoa('{"error":"internal_error"}') };
      }
      const peer = upgradeTarget(response);
      if (peer) {
        const id = nextSocket++;
        sockets.set(id, peer);
        peer.attach(new HostSocket(id, host) as never);
        return { status: 101, headers: [], body: "", ws: id };
      }
      return { status: response.status, headers: [...response.headers.entries()], body: toBase64(new Uint8Array(await response.arrayBuffer())) };
    },

    wsMessage(id: number, data: string, binary = false): void {
      const peer = sockets.get(id);
      if (!peer) return;
      void peer.owner?.webSocketMessage(peer, binary ? fromBase64(data) : data);
    },

    wsClose(id: number, code = 1006, reason = ""): void {
      const peer = sockets.get(id);
      if (!peer) return;
      sockets.delete(id);
      peer.detached();
      void peer.owner?.webSocketClose(peer, code, reason, true);
    },

    /** 앱이 곧 멈출 때: 모아 둔 저장을 지금 하게 한다. */
    flush(): void {
      for (const ns of Object.values(namespaces)) ns.flushAll();
      fs.flush();
    },
  };
}

(globalThis as unknown as { CommanderEngine: unknown }).CommanderEngine = { start };
