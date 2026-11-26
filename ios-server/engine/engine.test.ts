// 번들한 엔진을 웹뷰와 비슷한 환경(Node 전역 없이, 웹 표준 API만)에서 돌려 본다.
import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

type Msg = { t: string; [k: string]: unknown };
const code = readFileSync(join(import.meta.dir, "dist", "engine.js"), "utf8");

// 브라우저의 Request 처럼 금지 헤더를 조용히 지우는 Request. (Bun에는 그 규칙이 없어서 시험에서 흉내 낸다)
const FORBIDDEN = new Set(["upgrade", "connection", "host", "origin", "cookie", "content-length", "keep-alive"]);
class BrowserLikeRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const source = init?.headers ?? (typeof input === "object" && "headers" in input ? (input as Request).headers : undefined);
    const kept = new Headers();
    new Headers(source as HeadersInit | undefined).forEach((value, name) => {
      if (!FORBIDDEN.has(name.toLowerCase()) && !name.toLowerCase().startsWith("sec-")) kept.set(name, value);
    });
    super(input as RequestInfo, { ...init, headers: kept });
  }
}

function boot() {
  const posts: Msg[] = [];
  // 웹뷰에 있는 것만 준다. process, Buffer, require 는 없다.
  const sandbox: Record<string, unknown> = {
    Request: BrowserLikeRequest, Response, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, crypto, atob, btoa,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, structuredClone, console: { log() {}, warn() {}, error() {} },
    Uint8Array, ArrayBuffer, Promise, JSON, Math, Date, Map, Set,
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(code, context);
  const engineApi = (sandbox as { CommanderEngine: { start(o: unknown): any } }).CommanderEngine;
  return { engineApi, posts, sandbox };
}

const b64 = (text: string) => btoa(unescape(encodeURIComponent(text)));
const unb64 = (data: string) => decodeURIComponent(escape(atob(data)));

async function json(engine: any, method: string, url: string, body?: unknown) {
  const res = await engine.fetch({ method, url: `http://app${url}`, headers: body ? [["content-type", "application/json"]] : [], body: body ? b64(JSON.stringify(body)) : null });
  return { status: res.status as number, data: res.body ? JSON.parse(unb64(res.body)) : null };
}

test("번들에 Node 전용 API가 남아 있지 않다", () => {
  expect(code).not.toMatch(/require\("node:/);
  expect(code).not.toMatch(/process\.env\.(?!COMMANDER_EDITION)/);
});

test("서버 정보와 도감이 나온다", async () => {
  const { engineApi, posts } = boot();
  const engine = engineApi.start({ host: { post: (m: Msg) => posts.push(m) }, files: {}, name: "아이폰 서버", edition: "vanilla" });
  const info = await json(engine, "GET", "/api/server");
  expect(info.data.name).toBe("아이폰 서버");
  expect(info.data.authMode).toBe("open");
  expect(info.data.edition).toBe("vanilla");
  const chess = await json(engine, "GET", "/api/chess");
  expect(chess.data.units.length).toBeGreaterThan(10);
});

test("엑스퍼트는 plugins 파일의 팩을 적용하고, 바닐라는 무시한다", async () => {
  const pack = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "server", "packs", "example-pack.json"), "utf8"));
  const files = { "plugins/example-pack.json": JSON.stringify(pack) };
  const a = boot();
  const expert = a.engineApi.start({ host: { post() {} }, files, name: "x", edition: "expert" });
  expect(expert.plugins.accepted.map((p: { id: string }) => p.id)).toEqual(["example"]);
  const list = (await json(expert, "GET", "/api/chess")).data.units.map((u: { id: string }) => u.id);
  expect(list).toContain("example:moon-guard");
  const b = boot();
  const vanilla = b.engineApi.start({ host: { post() {} }, files, name: "x", edition: "vanilla" });
  expect(vanilla.plugins).toBeNull();
  expect((await json(vanilla, "GET", "/api/chess")).data.units.map((u: { id: string }) => u.id)).not.toContain("example:moon-guard");
});

test("두 사람이 한 판 하면 전적이 파일 변경으로 넘어가고, 다시 켜도 남아 있다", async () => {
  const { engineApi, posts } = boot();
  const engine = engineApi.start({ host: { post: (m: Msg) => posts.push(m) }, files: {}, name: "x", edition: "vanilla", phaseScale: "0.05" });
  const room = (await json(engine, "POST", "/api/rooms")).data.code as string;
  const ids: number[] = [];
  for (const name of ["가나", "다라"]) {
    const res = await engine.fetch({ method: "GET", url: `http://app/ws/${room}?name=${encodeURIComponent(name)}`, headers: [["upgrade", "websocket"]], body: null });
    expect(res.status).toBe(101);
    ids.push(res.ws);
  }
  const phases = new Map<number, string>();
  const sent = new Set<string>();
  const tick = () => {
    for (const m of posts.splice(0)) {
      if (m.t !== "ws-send") continue;
      const msg = JSON.parse(m.data as string);
      const id = m.id as number;
      const phase = msg.room?.phase as string | undefined;
      if (!phase) continue;
      phases.set(id, phase);
      if (phase === "lobby" && !sent.has(`r${id}`)) { sent.add(`r${id}`); engine.wsMessage(id, JSON.stringify({ t: "ready", ready: true })); }
      if (phase === "prep" && id === ids[1] && !sent.has("s")) { sent.add("s"); engine.wsMessage(id, JSON.stringify({ t: "surrender" })); }
    }
  };
  const fsOps: Msg[] = [];
  const keep = posts;
  for (let i = 0; i < 200 && ![...phases.values()].includes("result"); i++) {
    await new Promise((r) => setTimeout(r, 25));
    for (const m of keep) if (m.t === "fs") fsOps.push(m);
    tick();
  }
  expect([...phases.values()]).toContain("result");
  await new Promise((r) => setTimeout(r, 400));
  engine.flush();
  const ops = [...fsOps, ...posts.filter((m) => m.t === "fs")].flatMap((m) => m.ops as Array<{ op: string; path?: string; text?: string; to?: string }>);
  expect(ops.some((o) => o.op === "append" && o.path === "data/matches.jsonl")).toBe(true);
  const board = (await json(engine, "GET", "/api/leaderboard?limit=10")).data.entries as Array<{ nickname: string }>;
  expect(board.map((e) => e.nickname).sort()).toEqual(["가나", "다라"]);

  // 앱이 파일을 읽어 두었다가 다시 시작해 주는 상황: 변경 기록을 순서대로 적용해 파일 표를 만든다.
  const files = new Map<string, string>();
  for (const o of ops) {
    if (o.op === "write") files.set(o.path!, o.text!);
    else if (o.op === "append") files.set(o.path!, (files.get(o.path!) ?? "") + o.text!);
    else if (o.op === "rename") { files.set(o.to!, files.get((o as { from: string }).from)!); files.delete((o as { from: string }).from); }
    else if (o.op === "rm") for (const k of [...files.keys()]) if (k === o.path || k.startsWith(`${o.path}/`)) files.delete(k);
  }
  const again = boot().engineApi.start({ host: { post() {} }, files: Object.fromEntries(files), name: "x", edition: "vanilla" });
  const board2 = (await json(again, "GET", "/api/leaderboard?limit=10")).data.entries as Array<{ nickname: string }>;
  expect(board2.map((e) => e.nickname).sort()).toEqual(["가나", "다라"]);
}, 30000);

test("앱이 돌리는 타이머 (안드로이드): setTimeout 이 앱에 맡겨지고, 앱이 부르면 실행된다", async () => {
  const { engineApi, sandbox } = boot();
  const scheduled: Array<[number, number]> = [];
  const cancelled: number[] = [];
  const engine = engineApi.start({
    host: { post() {} }, files: {}, name: "타이머", edition: "vanilla",
    timers: { schedule: (id: number, ms: number) => scheduled.push([id, ms]), cancel: (id: number) => cancelled.push(id) },
  });
  // 방을 만들면 단계 타이머(알람)가 앱에 맡겨진다
  const res = await engine.fetch({ method: "POST", url: "http://x/api/rooms", headers: [], body: null });
  expect(res.status).toBeLessThan(300);
  // 저장 미루기(0.15초)나 방 알람이 앱에 맡겨진다. 앱이 부르면(__hostTimer) 실행되고, 지운 타이머는 cancel 로 알린다.
  expect(scheduled.length).toBeGreaterThan(0);
  const ids = scheduled.map(([id]) => id);
  // 앱이 시간이 되어 부르는 것처럼 실행해 본다 (오류 없이 돈다)
  for (const id of ids) (sandbox.__hostTimer as (id: number) => void)(id);
  expect(scheduled.every(([id, ms]) => Number.isInteger(id) && ms >= 0)).toBe(true);
});
