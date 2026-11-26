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
import { installHostTimers } from "./host-timers";
import type { HostTimers } from "./host-timers";
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
  /**
   * 로그인 방식. 없으면 open(이름만).
   * linked: GL 연결 서버 — 로그인은 GL 계정(공식 서버가 확인, 인터넷 필요), 전적·랭킹은 이 기기. 주인 관리는 /server-admin.html
   */
  auth?: { mode: "open" | "linked"; owner?: string; guests?: boolean; linkOrigin?: string };
  /** 앱이 타이머를 대신 돌린다(안드로이드: 숨은 웹뷰의 타이머가 늦어지지 않게). 없으면 웹뷰 타이머를 쓴다. */
  timers?: HostTimers;
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
  if (options.timers) installHostTimers(options.timers);
  const fs = new MemFs(options.files, (ops: FsOp[]) => host.post({ t: "fs", ops }));
  for (const level of ["log", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => host.post({ t: "log", level, text: args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") });
  }

  fs.mkdir("data");
  const store = new JsonRankingStore("data", "backups", fs);
  store.backup();

  let plugins: ReturnType<typeof loadPlugins> | null = null;
  if (options.edition === "expert") plugins = loadPlugins(".", fs);

  const linked = options.auth?.mode === "linked";
  const env: Record<string, unknown> = {
    STORE: store,
    PHASE_SCALE: options.phaseScale ?? "1",
    AUTH_MODE: linked ? "linked" : "open",
    ...(linked
      ? { LINK_OWNER: options.auth?.owner ?? "", LINK_GUESTS: options.auth?.guests ? "true" : "false", LINK_ORIGIN: options.auth?.linkOrigin ?? "" }
      : {}),
    SERVER_ENV: "local",
    SERVER_NAME: options.name,
    EDITION: options.edition,
    SERVER_VERSION: options.version ?? "0.1.0",
    // open 은 이름으로 전적을 남기고, linked 는 GL 계정끼리만
    RECORD_ANONYMOUS: linked ? "false" : "true",
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
      // 웹뷰의 Request 는 cookie·origin 헤더를 조용히 버린다. 서버가 읽는 다른 이름(x-commander-*)으로 바꿔 넘긴다.
      // (GL 연결 서버의 웹 로그인 쿠키, 주인 관리의 출처 확인에 필요하다. auth.ts 의 cookieHeader·originHeader)
      const headers = req.headers.map(([k, v]): [string, string] => {
        const name = k.toLowerCase();
        return name === "cookie" || name === "origin" ? [`x-commander-${name}`, v] : [k, v];
      });
      const request = new Request(req.url, { method: req.method, headers, body: hasBody ? fromBase64(req.body!) : undefined });
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
      // 웹뷰의 Response 는 set-cookie 를 지운다: 서버가 같이 보낸 x-commander-set-cookie 를 set-cookie 로 되돌린다 (link-routes.ts)
      const outHeaders = [...response.headers.entries()]
        .filter(([k]) => k.toLowerCase() !== "set-cookie")
        .map(([k, v]): [string, string] => (k.toLowerCase() === "x-commander-set-cookie" ? ["set-cookie", v] : [k, v]));
      return { status: response.status, headers: outHeaders, body: toBase64(new Uint8Array(await response.arrayBuffer())) };
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
