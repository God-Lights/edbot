// Cloudflare Durable Object를 흉내 낸다: 이름으로 찾는 객체, 저장소(JSON 파일), 알람, WebSocket 연결 목록.
// 서버 코드(room.ts, auth-store.ts, matchmaker.ts, registry.ts)가 쓰는 기능만 구현한다.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ServerSocket } from "./websocket";
import type { SocketOwner } from "./websocket";

const MAX_TIMER_MS = 2 ** 31 - 1;
const FLUSH_DELAY_MS = 150;

// ---- JSON 저장 (Map, Set, Date도 되살릴 수 있게 표시를 단다) ----

function encode(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v instanceof Map) return { $map: [...v.entries()] };
    if (v instanceof Set) return { $set: [...v] };
    if (v instanceof Date) return { $date: v.toISOString() };
    return v;
  });
}

function decode(text: string): unknown {
  return JSON.parse(text, (_key, v) => {
    if (v && typeof v === "object") {
      if ("$map" in v) return new Map(v.$map);
      if ("$set" in v) return new Set(v.$set);
      if ("$date" in v) return new Date(v.$date);
    }
    return v;
  });
}

const clone = <T>(value: T): T => (value === undefined ? value : (decode(encode(value)) as T));

/** 파일을 임시 파일에 쓰고 이름을 바꿔서, 중간에 꺼져도 깨진 파일이 남지 않게 한다. */
function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

interface StoredObject {
  entries: Record<string, string>;
  alarm: number | null;
}

class ObjectStorage {
  private entries = new Map<string, unknown>();
  private alarmAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  onAlarm: () => void = () => {};

  constructor(private readonly file: string) {
    if (existsSync(file)) {
      try {
        const saved = JSON.parse(readFileSync(file, "utf8")) as StoredObject;
        for (const [key, text] of Object.entries(saved.entries ?? {})) this.entries.set(key, decode(text));
        this.alarmAt = typeof saved.alarm === "number" ? saved.alarm : null;
      } catch (error) {
        console.warn(`[저장소] ${file} 을(를) 읽지 못해 빈 상태로 시작한다:`, error);
      }
    }
  }

  // ---- DurableObjectStorage ----

  async get<T = unknown>(key: string | string[]): Promise<T | undefined | Map<string, T>> {
    if (Array.isArray(key)) {
      const found = new Map<string, T>();
      for (const k of key) if (this.entries.has(k)) found.set(k, clone(this.entries.get(k) as T));
      return found;
    }
    return this.entries.has(key) ? clone(this.entries.get(key) as T) : undefined;
  }

  async put(keyOrEntries: string | Record<string, unknown>, value?: unknown): Promise<void> {
    if (typeof keyOrEntries === "string") this.entries.set(keyOrEntries, clone(value));
    else for (const [k, v] of Object.entries(keyOrEntries)) this.entries.set(k, clone(v));
    this.touch();
  }

  async delete(key: string | string[]): Promise<boolean | number> {
    const keys = Array.isArray(key) ? key : [key];
    let count = 0;
    for (const k of keys) if (this.entries.delete(k)) count += 1;
    if (count > 0) this.touch();
    return Array.isArray(key) ? count : count > 0;
  }

  async deleteAll(): Promise<void> {
    this.entries.clear();
    this.clearAlarm();
    this.dirty = false;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    rmSync(this.file, { force: true });
  }

  async list<T = unknown>(options: { prefix?: string; limit?: number; reverse?: boolean } = {}): Promise<Map<string, T>> {
    let keys = [...this.entries.keys()].filter((k) => (options.prefix ? k.startsWith(options.prefix) : true)).sort();
    if (options.reverse) keys.reverse();
    if (options.limit) keys = keys.slice(0, options.limit);
    return new Map(keys.map((k) => [k, clone(this.entries.get(k) as T)]));
  }

  async getAlarm(): Promise<number | null> {
    return this.alarmAt;
  }

  async setAlarm(time: number | Date): Promise<void> {
    this.alarmAt = typeof time === "number" ? time : time.getTime();
    this.arm();
    this.touch();
  }

  async deleteAlarm(): Promise<void> {
    this.clearAlarm();
    this.touch();
  }

  // ---- 알람과 저장 ----

  /** 켜질 때 저장되어 있던 알람을 다시 건다. */
  arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.alarmAt === null) return;
    const wait = Math.min(MAX_TIMER_MS, Math.max(0, this.alarmAt - Date.now()));
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.alarmAt !== null && this.alarmAt - Date.now() > 50) return this.arm(); // 아주 긴 알람은 나눠서 기다린다
      this.alarmAt = null;
      this.touch();
      this.onAlarm();
    }, wait);
  }

  private clearAlarm(): void {
    this.alarmAt = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private touch(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
  }

  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.dirty) return;
    this.dirty = false;
    if (this.entries.size === 0 && this.alarmAt === null) {
      rmSync(this.file, { force: true });
      return;
    }
    const saved: StoredObject = { entries: {}, alarm: this.alarmAt };
    for (const [key, value] of this.entries) saved.entries[key] = encode(value);
    writeAtomic(this.file, JSON.stringify(saved));
  }

  hasAlarm(): boolean {
    return this.alarmAt !== null;
  }
}

// ---- DurableObjectState ----

export class ObjectState {
  readonly id: { name: string; toString(): string };
  readonly storage: ObjectStorage;
  /** 시작할 때 맡은 일(저장된 상태 읽기)이 끝나기 전에는 요청을 받지 않는다. */
  ready: Promise<void> = Promise.resolve();
  owner: (SocketOwner & { alarm?: () => void | Promise<void> }) | null = null;
  private sockets = new Set<ServerSocket>();

  constructor(name: string, file: string) {
    this.id = { name, toString: () => name };
    this.storage = new ObjectStorage(file);
    this.storage.onAlarm = () => {
      void this.ready
        .then(() => this.owner?.alarm?.())
        .catch((error) => console.error(`[알람] ${name}:`, error));
    };
  }

  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.ready.then(fn);
    this.ready = run.then(() => undefined, () => undefined);
    return run;
  }

  waitUntil(promise: Promise<unknown>): void {
    void promise.catch((error) => console.error("[waitUntil]", error));
  }

  acceptWebSocket(ws: ServerSocket, tags: string[] = []): void {
    ws.tags = tags;
    ws.owner = {
      webSocketMessage: (socket, message) => this.dispatch("webSocketMessage", socket, message),
      webSocketClose: (socket, code, reason, wasClean) => {
        this.sockets.delete(socket);
        return this.dispatch("webSocketClose", socket, code, reason, wasClean);
      },
      webSocketError: (socket, error) => this.dispatch("webSocketError", socket, error),
    };
    this.sockets.add(ws);
  }

  getWebSockets(tag?: string): ServerSocket[] {
    return [...this.sockets].filter((ws) => ws.readyState === 1 && (tag === undefined || ws.tags.includes(tag)));
  }

  getTags(ws: ServerSocket): string[] {
    return [...ws.tags];
  }

  private async dispatch(method: "webSocketMessage" | "webSocketClose" | "webSocketError", ...args: unknown[]): Promise<void> {
    await this.ready;
    const owner = this.owner as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined> | null;
    try {
      await owner?.[method]?.call(this.owner, ...args);
    } catch (error) {
      console.error(`[${this.id.name}] ${method} 오류:`, error);
    }
  }

  flush(): void {
    this.storage.flush();
  }
}

// ---- 이름으로 찾는 객체들(Durable Object 네임스페이스) ----

type ObjectClass = new (ctx: ObjectState, env: unknown) => SocketOwner & Record<string, unknown>;

export class ObjectNamespace {
  private instances = new Map<string, { obj: SocketOwner & Record<string, unknown>; ctx: ObjectState }>();
  private readonly dir: string;

  constructor(
    readonly className: string,
    private readonly Ctor: ObjectClass,
    private readonly env: () => unknown,
    dataDir: string,
  ) {
    this.dir = join(dataDir, "objects", className);
    mkdirSync(this.dir, { recursive: true });
  }

  idFromName(name: string): { name: string; toString(): string } {
    return { name, toString: () => name };
  }

  private instance(name: string) {
    let inst = this.instances.get(name);
    if (!inst) {
      const ctx = new ObjectState(name, join(this.dir, `${encodeURIComponent(name)}.json`));
      const obj = new this.Ctor(ctx, this.env());
      ctx.owner = obj as unknown as ObjectState["owner"];
      inst = { obj, ctx };
      this.instances.set(name, inst);
      ctx.storage.arm(); // 저장되어 있던 알람을 다시 건다
    }
    return inst;
  }

  /** 서버를 켤 때: 알람이 걸려 있던 객체(진행 중인 방 등)를 다시 깨운다. */
  wakeAll(): number {
    let woken = 0;
    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const saved = JSON.parse(readFileSync(join(this.dir, file), "utf8")) as StoredObject;
        if (typeof saved.alarm === "number") {
          this.instance(decodeURIComponent(file.slice(0, -5)));
          woken += 1;
        }
      } catch {
        /* 깨진 파일은 건너뛴다 */
      }
    }
    return woken;
  }

  get(id: { name: string }): unknown {
    const { obj, ctx } = this.instance(id.name);
    return new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === "then") return undefined; // await stub 이 스텁을 풀려고 하지 않게
          return async (...args: unknown[]) => {
            await ctx.ready;
            const method = obj[prop as string];
            if (typeof method !== "function") throw new Error(`${this.className}.${String(prop)} 은(는) 없는 메서드다.`);
            return (method as (...a: unknown[]) => unknown).apply(obj, args);
          };
        },
      },
    );
  }

  flushAll(): void {
    for (const { ctx } of this.instances.values()) ctx.flush();
  }
}
