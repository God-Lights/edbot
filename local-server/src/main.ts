// COMMANDER 로컬 서버 (시제품): 기존 서버 엔진(../server/src)을 Cloudflare 없이 Bun으로 돌린다.
//
//   bun run dev                       (개발: 포트 8787, 데이터는 ./commander-data)
//   bun run dev -- --port 9000 --data D:\commander --phase-scale 0.05
//
// 같은 와이파이의 기기에서 http://<이 컴퓨터 IP>:8787 로 접속한다. 로그인은 이름만 쓰는 방식(open)이다.
// GL 연결 서버: --auth linked --link-owner <주인 GL 아이디> [--link-guests]
//   로그인은 GL 계정(공식 서버가 확인, 이 컴퓨터는 인터넷이 필요), 전적·랭킹은 이 데이터 폴더. 주인 관리: /server-admin.html

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { JsonRankingStore } from "./runtime/json-store";
import { acquireLock } from "./runtime/lock";
import { ObjectNamespace } from "./runtime/objects";
import { installWebSocketGlobals, upgradeTarget } from "./runtime/websocket";
import type { ServerSocket } from "./runtime/websocket";
import { connectLink, connectPage, qrTerminal } from "./connect";
import { startMdns } from "./mdns";
import packageInfo from "../package.json" with { type: "json" };

installWebSocketGlobals();

// 실행파일로 만들 때(build.ts) 웹 화면과 마이그레이션이 이 파일에 담긴다. 개발 중에는 없다.
const embedded = (await import("./generated/embedded").catch(() => null)) as
  | { web: Record<string, string> }
  | null;

// 서버 코드는 설치 뒤에 불러온다. (Response 등 전역을 바꾼 다음에 평가되게)
const { default: worker, Room, AuthStore, Matchmaker, LiveRegistry, SupportDesk } = await import("../../server/src/index");

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

// 엑스퍼트 서버만 plugins/ 의 콘텐츠 팩을 읽는다. 바닐라 실행파일에서는 이 분기와 plugins.ts 가 빌드에서 빠진다.
let pluginReport: { accepted: Array<{ id: string; name: string; version: string; kind?: string; dir?: string }>; rejected: Array<{ id: string; errors: string[] }>; notes: string[]; ruleset: string } | null = null;
/** 팩 id -> 팩 폴더(절대 경로): 그림·소리를 /packs/<id>/ 로 내준다 */
const packDirs = new Map<string, string>();
let packAssetHandler: ((pathname: string, dirs: ReadonlyMap<string, string>) => Response | null) | null = null;
if (process.env.COMMANDER_EDITION === "expert") {
  const { loadPlugins } = await import("./plugins");
  const { extractZipPacks, packAsset } = await import("./pack-files");
  const zipNotes = extractZipPacks(join(dataDir, "plugins"));
  pluginReport = loadPlugins(dataDir);
  pluginReport.notes.push(...zipNotes);
  for (const p of pluginReport.accepted) if (p.dir) packDirs.set(p.id, resolve(dataDir, p.dir));
  packAssetHandler = packAsset;
}

const serverName = option("name", "내 컴퓨터 서버");
// 로그인 방식: open(이름만, 기본) | linked(GL 연결 서버: 로그인은 GL 계정을 공식 서버가 확인, 전적은 이 데이터 폴더)
const linked = option("auth", "open") === "linked";
const env: Record<string, unknown> = {
  STORE: store,
  PHASE_SCALE: phaseScale,
  AUTH_MODE: linked ? "linked" : "open",
  ...(linked
    ? {
        LINK_OWNER: option("link-owner", ""), // 주인 GL 아이디 (/server-admin.html)
        LINK_GUESTS: process.argv.includes("--link-guests") || process.env.COMMANDER_LINK_GUESTS === "true" ? "true" : "false",
        LINK_ORIGIN: option("link-origin", ""), // 시험용: 공식 서버 주소 바꾸기
      }
    : {}),
  SERVER_ENV: "local",
  SERVER_NAME: serverName,
  EDITION: edition === "expert" ? "expert" : "vanilla",
  SERVER_VERSION: packageInfo.version,
  // open: GL 계정이 없으니 이름으로 전적을 남긴다. linked: GL 계정끼리만 남긴다. (봇과 한 판은 남기지 않는다)
  RECORD_ANONYMOUS: linked ? "false" : "true",
  // 문의 답하기(관리자 페이지 support-admin.html)용 키: --support-key 또는 COMMANDER_SUPPORT_KEY. 없으면 답하기만 꺼진다.
  SUPPORT_ADMIN_KEY: option("support-key", ""),
};
const envOf = () => env;
const namespaces = {
  ROOM: new ObjectNamespace("Room", Room as never, envOf, dataDir),
  AUTH: new ObjectNamespace("AuthStore", AuthStore as never, envOf, dataDir),
  MATCH: new ObjectNamespace("Matchmaker", Matchmaker as never, envOf, dataDir),
  LIVE: new ObjectNamespace("LiveRegistry", LiveRegistry as never, envOf, dataDir),
  SUPPORT: new ObjectNamespace("SupportDesk", SupportDesk as never, envOf, dataDir),
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
    if (request.method === "GET" && url.pathname === "/connect") {
      const urls = lanAddresses().map((ip) => `http://${ip}:${port}`);
      return new Response(connectPage(serverName, urls), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
    }
    // 팩의 그림·소리 (엑스퍼트)
    if (packAssetHandler && request.method === "GET" && url.pathname.startsWith("/packs/")) {
      return packAssetHandler(url.pathname, packDirs) ?? new Response("없다", { status: 404 });
    }
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

console.log(`${serverName} (COMMANDER 로컬 서버 ${packageInfo.version}, ${edition}${linked ? ", GL 연결" : ""})  |  데이터: ${dataDir}`);
if (linked) console.log(`  GL 연결 서버: 로그인은 GL 계정(인터넷 필요), 전적은 이 데이터 폴더. 주인: ${String(env.LINK_OWNER) || "(없음, --link-owner)"}${env.LINK_GUESTS === "true" ? ", 게스트 허용" : ""}`);
console.log(`  이 컴퓨터:        http://localhost:${server.port}`);
for (const ip of lanAddresses()) console.log(`  같은 와이파이:    http://${ip}:${server.port}`);
const lan = lanAddresses();
if (lan[0]) {
  console.log(`  폰으로 접속: 같은 와이파이에서 앱의 서버 목록에 뜨거나, 아래 QR을 폰 카메라로 찍으세요. (화면: http://localhost:${server.port}/connect)`);
  console.log(qrTerminal(connectLink(`http://${lan[0]}:${server.port}`, serverName)).split("\n").map((l) => "    " + l).join("\n"));
}
const stopMdns = process.argv.includes("--no-discovery")
  ? null
  : startMdns(
      { name: serverName, ips: lan, port: server.port!, txt: { name: serverName, ip: lan.join(","), port: String(server.port), ed: edition === "expert" ? "expert" : "vanilla", proto: "1" } },
      (m) => console.warn(`  [주의] ${m}`),
    );
if (woken > 0) console.log(`  이어서 진행하는 방: ${woken}개`);
if (pluginReport) {
  const { accepted, rejected, notes, ruleset } = pluginReport;
  console.log(`  플러그인: ${accepted.length}개 적용${accepted.length ? ` (${accepted.map((p) => `${p.name} ${p.version}`).join(", ")})` : ""}, 규칙 묶음 ${ruleset}`);
  for (const note of notes) console.warn(`  [플러그인 주의] ${note}`);
  for (const r of rejected) for (const line of r.errors) console.warn(`  [플러그인 거절] ${line}`);
} else if (edition !== "expert" && existsSync(join(dataDir, "plugins"))) {
  console.log("  이 서버는 바닐라라서 plugins/ 폴더를 읽지 않는다. (엑스퍼트 서버에서 쓴다)");
}
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
  stopMdns?.();
  lock.release();
  void server.stop(true).then(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
