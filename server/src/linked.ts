// GL 연결 서버의 개인 서버 쪽 (AUTH_MODE=linked).
//
// 로그인은 GL 계정(공식 서버가 확인), 전적·랭킹은 이 서버의 데이터 폴더.
// - 앱(iPad): 예전과 같은 기기 로그인 /api/auth/start → 브라우저 → /api/auth/poll. 이 서버가 공식 서버에 대신 묻는다.
// - 웹(안드로이드 앱 포함): /auth/login → 공식 승인 페이지 → /auth/done 에서 이 서버의 세션 쿠키(cmd_session)를 받는다.
// 이 서버는 GL 비밀 키도, 사용자의 공식 토큰도 받지 않는다. 승인된 사용자의 GL id·아이디·닉네임만 받는다.
// 주인(LINK_OWNER, GL 아이디)은 /server-admin.html 에서 사람을 막고 풀거나 랭킹을 처음부터 다시 할 수 있다.

import type { PublicUser } from "./auth";
import type { LinkPoll } from "./link-hub";

export const LINK_ORIGIN_DEFAULT = "https://edgame-api.officialgl.com";
export const LINK_SESSION_COOKIE = "cmd_session";
export const LINK_LOGIN_COOKIE = "cmd_login";
const REMOTE_MS = 10 * 60_000;
/** 로그인을 끝낸 뒤에도 이만큼은 같은 요청에 같은 세션을 준다 (두 번 와도 "만료"가 되지 않게) */
const REMOTE_DONE_MS = 2 * 60_000;

export interface LinkedEnv {
  AUTH_MODE?: string;
  /** "true" 면 GL 계정 없이 이름만으로도 논다 (전적은 안 남는다) */
  LINK_GUESTS?: string;
  /** 주인 GL 아이디 */
  LINK_OWNER?: string;
  /** 공식 서버 주소 (시험용으로 바꿀 수 있다) */
  LINK_ORIGIN?: string;
}

export const isLinked = (env: LinkedEnv): boolean => String(env.AUTH_MODE) === "linked";
export const linkOrigin = (env: LinkedEnv): string => (env.LINK_ORIGIN || LINK_ORIGIN_DEFAULT).replace(/\/+$/, "");

export function isOwner(env: LinkedEnv, user: PublicUser | null): boolean {
  const owner = (env.LINK_OWNER ?? "").trim().toLowerCase();
  return !!user && !!owner && user.username.toLowerCase() === owner;
}

// ---- 저장 (이 서버의 AuthStore 안) ----

export interface LinkedStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean | void>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}

export interface LinkCredentials {
  serverId: string;
  secret: string;
}

export interface RemoteLogin {
  linkId: string;
  pollSecret: string;
  createdAt: number;
  /** 로그인을 끝냈으면 그때 만든 이 서버의 세션 */
  token?: string;
  user?: PublicUser;
  doneAt?: number;
}

const remoteExpired = (r: RemoteLogin, now: number): boolean =>
  r.doneAt !== undefined ? now - r.doneAt > REMOTE_DONE_MS : now - r.createdAt > REMOTE_MS;

export interface KnownUser {
  id: string;
  username: string;
  nickname: string;
  firstSeen: number;
  lastSeen: number;
  banned: boolean;
}

export class LinkedCore {
  constructor(private readonly storage: LinkedStorage) {}

  credentials(): Promise<LinkCredentials | undefined> {
    return this.storage.get<LinkCredentials>("lcred");
  }
  async setCredentials(cred: LinkCredentials | null): Promise<void> {
    if (cred) await this.storage.put("lcred", cred);
    else await this.storage.delete("lcred");
  }

  async saveRemote(loginId: string, remote: Omit<RemoteLogin, "createdAt">, now = Date.now()): Promise<void> {
    await this.storage.put(`lremote:${loginId}`, { ...remote, createdAt: now } satisfies RemoteLogin);
  }
  async remote(loginId: string, now = Date.now()): Promise<RemoteLogin | null> {
    if (!/^[0-9a-f]{16,64}$/.test(loginId)) return null;
    const r = await this.storage.get<RemoteLogin>(`lremote:${loginId}`);
    if (!r) return null;
    if (remoteExpired(r, now)) {
      await this.storage.delete(`lremote:${loginId}`);
      return null;
    }
    return r;
  }
  /** 로그인을 끝냈다: 같은 요청이 다시 와도 같은 세션을 준다 */
  async finishRemote(loginId: string, token: string, user: PublicUser, now = Date.now()): Promise<void> {
    const r = await this.storage.get<RemoteLogin>(`lremote:${loginId}`);
    if (r) await this.storage.put(`lremote:${loginId}`, { ...r, token, user, doneAt: now } satisfies RemoteLogin);
  }

  async dropRemote(loginId: string): Promise<void> {
    await this.storage.delete(`lremote:${loginId}`);
  }

  async rememberUser(user: PublicUser, now = Date.now()): Promise<void> {
    const old = await this.storage.get<KnownUser>(`luser:${user.id}`);
    await this.storage.put(`luser:${user.id}`, {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      firstSeen: old?.firstSeen ?? now,
      lastSeen: now,
      banned: old?.banned ?? false,
    } satisfies KnownUser);
  }

  async isBanned(userId: string): Promise<boolean> {
    return (await this.storage.get<KnownUser>(`luser:${userId}`))?.banned === true;
  }

  async setBanned(userId: string, banned: boolean): Promise<boolean> {
    const user = await this.storage.get<KnownUser>(`luser:${userId}`);
    if (!user) return false;
    await this.storage.put(`luser:${userId}`, { ...user, banned });
    return true;
  }

  async users(): Promise<KnownUser[]> {
    return [...(await this.storage.list<KnownUser>({ prefix: "luser:" })).values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  async sweep(now = Date.now()): Promise<void> {
    for (const [key, r] of await this.storage.list<RemoteLogin>({ prefix: "lremote:" })) if (remoteExpired(r, now)) await this.storage.delete(key);
  }
}

// ---- 공식 서버에 묻기 ----

export type LinkClientError = "unreachable" | "unknown_server" | "blocked" | "bad_response";

export class LinkClientFailure extends Error {
  /** detail: 무엇이 틀렸는지 (HTTP 상태, 네트워크 오류 글) — 서버 기록과 오류 응답에 남겨 원인을 찾는다 */
  constructor(readonly code: LinkClientError, readonly detail = "") {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export class LinkClient {
  constructor(
    private readonly origin: string,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private async post<T>(path: string, body: unknown): Promise<{ status: number; body: T | null }> {
    let res: Response;
    try {
      res = await this.fetcher(`${this.origin}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch (error) {
      throw new LinkClientFailure("unreachable", `${path} 요청 실패: ${String((error as Error)?.message ?? error)}`);
    }
    const parsed = (await res.json().catch(() => null)) as T | null;
    if (res.status >= 500 || res.status === 404) throw new LinkClientFailure("unreachable", `${path} HTTP ${res.status}`);
    return { status: res.status, body: parsed };
  }

  async register(name: string): Promise<LinkCredentials> {
    const { body } = await this.post<{ serverId?: string; secret?: string }>("/api/link/register", { name });
    if (!body?.serverId || !body.secret) throw new LinkClientFailure("bad_response", `/api/link/register ${JSON.stringify(body)?.slice(0, 120)}`);
    return { serverId: body.serverId, secret: body.secret };
  }

  async start(cred: LinkCredentials, name: string, returnTo: string | null): Promise<{ linkId: string; pollSecret: string; linkUrl: string }> {
    const { status, body } = await this.post<{ linkId?: string; pollSecret?: string; linkUrl?: string; error?: string }>("/api/link/start", { ...cred, name, returnTo });
    if (status === 403 && body?.error === "blocked") throw new LinkClientFailure("blocked");
    if (status === 403) throw new LinkClientFailure("unknown_server");
    if (!body?.linkId || !body.pollSecret || !body.linkUrl) throw new LinkClientFailure("bad_response", `/api/link/start HTTP ${status} ${JSON.stringify(body)?.slice(0, 120)}`);
    return { linkId: body.linkId, pollSecret: body.pollSecret, linkUrl: body.linkUrl };
  }

  async poll(linkId: string, pollSecret: string): Promise<LinkPoll> {
    const { status, body } = await this.post<{ status?: string; user?: PublicUser }>("/api/link/poll", { id: linkId, secret: pollSecret });
    if (status === 202 || body?.status === "pending") return { status: "pending" };
    if (status === 200 && body?.status === "approved" && body.user && typeof body.user.id === "string") {
      const u = body.user;
      return { status: "approved", user: { id: u.id, username: String(u.username ?? ""), nickname: String(u.nickname ?? u.username ?? ""), emailVerified: u.emailVerified === true } };
    }
    return { status: "unknown" };
  }
}

/** 이 서버의 자격(서버 id·비밀값)으로 로그인 요청을 만든다. 처음이거나 공식 서버가 모르는 자격이면 새로 받는다. */
export async function startRemoteLogin(
  core: LinkedCore,
  client: LinkClient,
  serverName: string,
  returnTo: string | null,
): Promise<{ linkId: string; pollSecret: string; linkUrl: string }> {
  let cred = await core.credentials();
  if (!cred) {
    cred = await client.register(serverName);
    await core.setCredentials(cred);
  }
  try {
    return await client.start(cred, serverName, returnTo);
  } catch (error) {
    if (!(error instanceof LinkClientFailure) || error.code !== "unknown_server") throw error;
    // 공식 서버가 이 자격을 모른다(지워졌다): 한 번만 새로 받는다
    cred = await client.register(serverName);
    await core.setCredentials(cred);
    return client.start(cred, serverName, returnTo);
  }
}

/** 오류를 사람에게 보여 줄 말로 */
export function linkErrorText(code: LinkClientError | "banned"): string {
  switch (code) {
    case "unreachable":
      return "공식 서버(GL 계정 확인)에 연결할 수 없어요. 이 서버의 인터넷 연결을 확인해 주세요.";
    case "blocked":
      return "이 서버는 공식 서버에서 막혀 있어서 GL 로그인을 쓸 수 없어요.";
    case "banned":
      return "이 서버의 주인이 이 계정을 막았어요.";
    default:
      return "로그인을 시작하지 못했어요. 잠시 뒤에 다시 해 주세요.";
  }
}
