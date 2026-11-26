// GL 연결 서버의 공식 쪽 (공식 서버 edgame-api 가 맡는다).
//
// 개인 서버는 GL Account 비밀 키를 가질 수 없어서, 로그인 확인을 공식 서버에 맡긴다.
//   1) 개인 서버가 처음 한 번 register 로 서버 id 와 비밀값을 받는다 (데이터 폴더에 저장).
//   2) 누가 로그인하려 하면 start 로 "로그인 요청"을 만든다 (서버 id + 비밀값으로 확인).
//   3) 사용자는 공식 페이지 /link?id= 에서 GL 계정으로 로그인하고 "이 서버에 들어갈까요?"를 승인한다.
//   4) 개인 서버가 poll 로 결과(GL id·아이디·닉네임)를 한 번만 받는다. 이메일과 공식 토큰은 넘기지 않는다.
// 비밀값은 해시만 저장한다. 저장은 키-값 저장소 하나(Durable Object storage 또는 시험용 Map)에 한다.

import type { PublicUser } from "./auth";

export const LINK_PENDING_MS = 10 * 60_000;
/** 승인 결과를 처음 받은 뒤에도 이만큼은 다시 받을 수 있다 (같은 요청이 두 번 와도 "만료"가 되지 않게) */
export const LINK_RESULT_MS = 2 * 60_000;
export const SERVER_NAME_MAX = 40;

export interface LinkStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean | void>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}

interface ServerRecord {
  secretHash: string;
  name: string;
  createdAt: number;
  lastSeen: number;
  blocked?: boolean;
}

interface LinkRecord {
  serverId: string;
  serverName: string;
  pollHash: string;
  /** 웹에서 시작했으면 승인 뒤 돌아갈 개인 서버 주소 (/auth/done) */
  returnTo: string | null;
  createdAt: number;
  user: PublicUser | null;
  /** 개인 서버가 승인 결과를 처음 받은 때 */
  claimedAt?: number;
}

export interface LinkInfo {
  serverId: string;
  serverName: string;
  returnTo: string | null;
}

export type LinkFailure = "bad_request" | "unknown_server" | "blocked";
export type LinkPoll = { status: "pending" } | { status: "approved"; user: PublicUser } | { status: "unknown" };

const SERVER_ID = /^[0-9a-f]{12}$/;
const TOKEN = /^[0-9a-f]{32,64}$/;

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 서버 이름: 줄바꿈·제어 문자를 빼고 40자까지. 비면 "이름 없는 서버" */
export function cleanServerName(raw: unknown): string {
  const text = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  return [...text].slice(0, SERVER_NAME_MAX).join("") || "이름 없는 서버";
}

/** 보여 주기용 서버 id: abcd-ef01-2345 */
export function serverIdLabel(id: string): string {
  return id.match(/.{1,4}/g)?.join("-") ?? id;
}

/** 승인 뒤 돌아갈 주소: http(s) 의 /auth/done 만. 개인 서버의 로그인 번호(?login=, 16진수)만 남긴다 */
export function cleanReturnTo(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 300) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.pathname !== "/auth/done" || url.username || url.password) return null;
    const login = url.searchParams.get("login");
    return login && /^[0-9a-f]{16,64}$/.test(login) ? `${url.origin}/auth/done?login=${login}` : `${url.origin}/auth/done`;
  } catch {
    return null;
  }
}

export class LinkHubCore {
  constructor(private readonly storage: LinkStorage) {}

  async register(name: unknown, now = Date.now()): Promise<{ serverId: string; secret: string }> {
    const serverId = randomHex(6);
    const secret = randomHex(32);
    await this.storage.put(`lsrv:${serverId}`, { secretHash: await sha256(secret), name: cleanServerName(name), createdAt: now, lastSeen: now } satisfies ServerRecord);
    return { serverId, secret };
  }

  async start(
    input: { serverId: unknown; secret: unknown; name: unknown; returnTo?: unknown },
    now = Date.now(),
  ): Promise<{ ok: true; linkId: string; pollSecret: string } | { ok: false; code: LinkFailure }> {
    const { serverId, secret } = input;
    if (typeof serverId !== "string" || !SERVER_ID.test(serverId) || typeof secret !== "string" || !TOKEN.test(secret)) return { ok: false, code: "bad_request" };
    const server = await this.storage.get<ServerRecord>(`lsrv:${serverId}`);
    if (!server || server.secretHash !== (await sha256(secret))) return { ok: false, code: "unknown_server" };
    if (server.blocked) return { ok: false, code: "blocked" };
    const serverName = cleanServerName(input.name);
    await this.storage.put(`lsrv:${serverId}`, { ...server, name: serverName, lastSeen: now } satisfies ServerRecord);
    const linkId = randomHex(16);
    const pollSecret = randomHex(24);
    await this.storage.put(`link:${linkId}`, {
      serverId,
      serverName,
      pollHash: await sha256(pollSecret),
      returnTo: cleanReturnTo(input.returnTo),
      createdAt: now,
      user: null,
    } satisfies LinkRecord);
    return { ok: true, linkId, pollSecret };
  }

  private async live(linkId: unknown, now: number): Promise<LinkRecord | null> {
    if (typeof linkId !== "string" || !TOKEN.test(linkId)) return null;
    const link = await this.storage.get<LinkRecord>(`link:${linkId}`);
    if (!link) return null;
    const expired = link.claimedAt !== undefined ? now - link.claimedAt > LINK_RESULT_MS : now - link.createdAt > LINK_PENDING_MS;
    if (expired) {
      await this.storage.delete(`link:${linkId}`);
      return null;
    }
    return link;
  }

  /** 승인 페이지에 보여 줄 것 */
  async info(linkId: unknown, now = Date.now()): Promise<LinkInfo | null> {
    const link = await this.live(linkId, now);
    return link ? { serverId: link.serverId, serverName: link.serverName, returnTo: link.returnTo } : null;
  }

  async approve(linkId: unknown, user: PublicUser, now = Date.now()): Promise<LinkInfo | null> {
    const link = await this.live(linkId, now);
    if (!link || link.user) return null;
    await this.storage.put(`link:${linkId as string}`, { ...link, user } satisfies LinkRecord);
    return { serverId: link.serverId, serverName: link.serverName, returnTo: link.returnTo };
  }

  /** 승인되었으면 사용자를 내준다. 처음 받은 뒤 2분 동안은 같은 결과를 다시 받을 수 있고, 그 뒤로는 unknown */
  async poll(linkId: unknown, pollSecret: unknown, now = Date.now()): Promise<LinkPoll> {
    const link = await this.live(linkId, now);
    if (!link || typeof pollSecret !== "string" || link.pollHash !== (await sha256(pollSecret))) return { status: "unknown" };
    if (!link.user) return { status: "pending" };
    if (link.claimedAt === undefined) await this.storage.put(`link:${linkId as string}`, { ...link, claimedAt: now } satisfies LinkRecord);
    return { status: "approved", user: link.user };
  }

  /** 문제 있는 서버를 막는다 (운영자용) */
  async setBlocked(serverId: string, blocked: boolean): Promise<boolean> {
    const server = await this.storage.get<ServerRecord>(`lsrv:${serverId}`);
    if (!server) return false;
    await this.storage.put(`lsrv:${serverId}`, { ...server, blocked });
    return true;
  }

  /** 오래된 로그인 요청을 치운다 */
  async sweep(now = Date.now()): Promise<void> {
    for (const [key, link] of await this.storage.list<LinkRecord>({ prefix: "link:" })) {
      const expired = link.claimedAt !== undefined ? now - link.claimedAt > LINK_RESULT_MS : now - link.createdAt > LINK_PENDING_MS;
      if (expired) await this.storage.delete(key);
    }
  }
}
