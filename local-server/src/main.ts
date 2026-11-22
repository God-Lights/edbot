// COMMANDER 로컬 서버 (시제품): 기존 서버 엔진(../server/src)을 Cloudflare 없이 Bun으로 돌린다.
//
//   bun run dev                       (개발: 포트 8787, 데이터는 ./commander-data)
//   bun run dev -- --port 9000 --data D:\commander --phase-scale 0.05
//
// 같은 와이파이의 기기에서 http://<이 컴퓨터 IP>:8787 로 접속한다. 로그인은 이름만 쓰는 방식(open)이다.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { JsonRankingStore, acquireLock } from "./runtime/json-store";
import { ObjectNamespace } from "./runtime/objects";
import { installWebSocketGlobals, upgradeTarget } from "./runtime/websocket";
import type { ServerSocket } from "./runtime/websocket";

installWebSocketGlobals();

// 실행파일로 만들 때(build.ts) 웹 화면과 마이그레이션이 이 파일에 담긴다. 개발 중에는 없다.
const embedded = (await import("./generated/embedded").catch(() => null)) as
  | { web: Record<string, string> }
  | null;

// 서버 코드는 설치 뒤에 불러온다. (Response 등 전역을 바꾼 다음에 평가되게)
const { default: worker, Room, AuthStore, Matchmaker, LiveRegistry } = await import("../../server/src/index");

// ---- 설정 ----

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : (process.env[`COMMANDER_${name.toUpperCase().replace(/-/g, "_")}`] ?? fallback);
}

const here = resolve(import.meta.dir, "..");

/** 쓸 수 있는 폴더인가 (파일을 하나 만들었다 지워 본다) */
function writable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, ".write-test");
    writeFileSync(probe, "ok");
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 데이터 폴더: --data 로 정하면 그곳, 아니면 실행파일 옆 commander-data(폴더째 옮겨 다닐 수 있게).
 * 거기에 못 쓰면(보호된 폴더 등) 사용자 폴더(Windows: %APPDATA%\CommanderServer)로 대신한다.
 */
function pickDataDir(): string {
  const given = option("data", "");
  if (given) return resolve(given);
  const beside = embedded ? join(dirname(process.execPath), "commander-data") : join(here, "commander-data");
  if (writable(beside)) return beside;
  const fallback = process.env.APPDATA ? join(process.env.APPDATA, "CommanderServer") : join(homedir(), ".commander-server");
  console.warn(`[주의] ${beside} 에 쓸 수 없어서 ${fallback} 를 쓴다.`);
  return fallback;
}

const port = Number(option("port", "8787"));
const dataDir = pickDataDir();
const webDir = resolve(option("web", join(here, "..", "web")));
const phaseScale = option("phase-scale", "1");
/** --web 으로 폴더를 주면 실행파일 안의 화면 대신 그 폴더를 쓴다. (화면을 고쳐 보고 싶을 때) */
const useEmbeddedWeb = embedded !== null && !process.argv.includes("--web");
const edition = process.env.COMMANDER_EDITION ?? "dev";
const host = option("host", "0.0.0.0");

mkdirSync(join(dataDir, "data"), { recursive: true });

// ---- 한 폴더는 서버 하나만 ----

const lock = acquireLock(dataDir);
if (!lock.ok) {
  console.error(`이 데이터 폴더(${dataDir})는 다른 서버(프로세스 ${lock.heldBy})가 쓰고 있다.`);
  console.error("이미 켜 둔 서버가 없다면, 비정상 종료로 남은 commander.lock 파일을 지우고 다시 켜 주세요.");
  process.exit(1);
}

// ---- 전적 저장소(JSON 파일) ----

const store = new JsonRankingStore(join(dataDir, "data"), join(dataDir, "backups"));
const backedUp = store.backup();

// ---- 내보내기·불러오기: commander-server export <파일> / import <파일> [--merge] ----

const subcommand = process.argv[2];
if (subcommand === "export" || subcommand === "import") {
  const file = process.argv[3];
  if (!file) {
    console.error(`사용법: commander-server ${subcommand} <파일.json>${subcommand === "import" ? " [--merge]" : ""}`);
    process.exit(2);
  }
  if (subcommand === "export") {
    const data = store.exportData();
    writeFileSync(resolve(file), JSON.stringify(data, null, 1));
    console.log(`내보냈다: ${resolve(file)}  (선수 ${data.players.length}, 판 ${data.matches.length}, 다시 보기 ${data.replays.length})`);
  } else {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(resolve(file), "utf8"));
    } catch (error) {
      console.error(`파일을 읽지 못했다: ${error instanceof Error ? error.message : error}`);
      process.exit(2);
    }
    if ((data as { schemaVersion?: number }).schemaVersion !== 1) {
      console.error("형식이 맞지 않는다. (schemaVersion 1인 내보내기 파일만 불러올 수 있다)");
      process.exit(2);
    }
    if (!store.isEmpty() && !process.argv.includes("--merge")) {
      console.error("이 서버에는 이미 전적이 있다. 없는 것만 더하려면 --merge 를 붙이세요. (이미 있는 판·선수는 그대로 둔다)");
      process.exit(2);
    }
    const added = store.mergeData(data as never);
    console.log(`불러왔다: 선수 ${added.players}, 판 ${added.matches}, 다시 보기 ${added.replays} 추가`);
  }
  lock.release();
  process.exit(0);
}

// ---- Cloudflare가 주던 것들 ----

const env: Record<string, unknown> = {
  STORE: store,
  PHASE_SCALE: phaseScale,
  REQUIRE_AUTH: "false", // 로컬 서버는 이름만 쓴다. (GL 계정 검증은 인터넷이 필요하다)
  RECORD_ANONYMOUS: "true", // GL 계정이 없으니 이름으로 전적을 남긴다. (봇과 한 판은 남기지 않는다)
};
const envOf = () => env;
const namespaces = {
  ROOM: new ObjectNamespace("Room", Room as never, envOf, dataDir),
  AUTH: new ObjectNamespace("AuthStore", AuthStore as never, envOf, dataDir),
  MATCH: new ObjectNamespace("Matchmaker", Matchmaker as never, envOf, dataDir),
  LIVE: new ObjectNamespace("LiveRegistry", LiveRegistry as never, envOf, dataDir),
};
Object.assign(env, namespaces);
const woken = Object.values(namespaces).reduce((sum, ns) => sum + ns.wakeAll(), 0);

// ---- 웹 화면(정적 파일) ----

const API_PREFIXES = ["/api", "/ws", "/auth", "/health", "/sidestore"];

function staticFile(pathname: string): Response | null {
  const clean = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  if (useEmbeddedWeb) {
    const path = embedded!.web[clean];
    if (!path) return null;
    const file = Bun.file(path);
    return new Response(file, { headers: { "cache-control": "no-cache", "content-type": file.type || "application/octet-stream" } });
  }
  const target = normalize(join(webDir, clean));
  if (target !== webDir && !target.startsWith(webDir + sep)) return null; // 폴더 밖으로 나가는 경로는 막는다
  if (!existsSync(target) || !statSync(target).isFile()) return null;
  const file = Bun.file(target);
  return new Response(file, { headers: { "cache-control": "no-cache", "content-type": file.type } });
}

// ---- 서버 ----

interface SocketData {
  peer: ServerSocket;
}

const server = Bun.serve<SocketData>({
  port,
  hostname: host,
  idleTimeout: 120,
  async fetch(request, srv) {
    const url = new URL(request.url);
    if ((request.method === "GET" || request.method === "HEAD") && !API_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      const file = staticFile(url.pathname);
      if (file) return file;
    }
    let response: Response;
    try {
      response = await (worker as { fetch(r: Request, e: unknown): Promise<Response> }).fetch(request, env);
    } catch (error) {
      console.error("[요청 오류]", request.method, url.pathname, error);
      return new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { "content-type": "application/json" } });
    }
    const peer = upgradeTarget(response);
    if (peer) {
      if (srv.upgrade(request, { data: { peer } })) return undefined;
      return new Response("WebSocket으로 올리지 못했다.", { status: 400 });
    }
    return response;
  },
  websocket: {
    open(ws) {
      ws.data.peer.attach(ws);
    },
    message(ws, message) {
      const peer = ws.data.peer;
      void peer.owner?.webSocketMessage(peer, typeof message === "string" ? message : new Uint8Array(message));
    },
    close(ws, code, reason) {
      const peer = ws.data.peer;
      peer.detached();
      void peer.owner?.webSocketClose(peer, code, reason, true);
    },
  },
});

// ---- 안내와 종료 ----

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  return out;
}

console.log(`COMMANDER 로컬 서버 (${edition}, 시제품)  |  데이터: ${dataDir}`);
console.log(`  이 컴퓨터:        http://localhost:${server.port}`);
for (const ip of lanAddresses()) console.log(`  같은 와이파이:    http://${ip}:${server.port}`);
if (woken > 0) console.log(`  이어서 진행하는 방: ${woken}개`);
for (const note of store.notes) console.warn(`  [주의] ${note}`);
if (backedUp) console.log(`  백업: ${backedUp}`);
const backupTimer = setInterval(() => store.backup(), 24 * 60 * 60 * 1000);
backupTimer.unref();
console.log("  끄려면 Ctrl+C");

let closing = false;
function shutdown(): void {
  if (closing) return;
  closing = true;
  console.log("\n저장하고 끄는 중...");
  for (const ns of Object.values(namespaces)) ns.flushAll();
  lock.release();
  void server.stop(true).then(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
