// GL Account 로그인 연동. 가이드: god-lights/gl-account 의 docs/INTEGRATION.md
//
// - 브라우저(`*.officialgl.com`)에는 `gl_session` 쿠키가 오고, 서버가 GL Account API로 검증한다.
// - 게임 클라이언트(Unity)는 브라우저가 아니라서 "기기 로그인"으로 게임 전용 세션 토큰을 받는다.
//   (start -> 브라우저에서 로그인하고 확인 -> poll로 토큰 수령) 토큰은 Authorization 헤더로 보낸다.
// GL_ACCOUNT_KEY는 Worker 시크릿으로만 쓴다. 코드, 로그, 응답에 넣지 않는다.

export const ACCOUNT_ORIGIN = "https://account.officialgl.com";
/** Worker가 확인한 사용자를 방(Durable Object)에 전달하는 내부 헤더. 밖에서 온 값은 항상 지운다. */
export const USER_HEADER = "x-edbot-user";
export const SESSION_COOKIE = "gl_session";
/** 같은 세션 토큰의 검증 결과를 이 시간만 기억한다. 로그아웃이 이만큼 늦게 반영된다. */
export const VERIFY_CACHE_MS = 30_000;

export interface GlUser {
  id: string;
  email: string;
  username: string;
  nickname: string;
  emailVerified: boolean;
}

/** 게임이 쓰는 사용자 정보. 이메일은 서버 밖으로 내보내지 않는다. */
export interface PublicUser {
  id: string;
  username: string;
  nickname: string;
  emailVerified: boolean;
}

export interface AuthEnv {
  GL_ACCOUNT_KEY?: string;
  /** 예전 방식: "false"면 로그인 검사를 끈다(open). AUTH_MODE가 있으면 그쪽이 먼저다. */
  REQUIRE_AUTH?: string;
  /** 이 서버의 로그인 방식: gl | hybrid | open */
  AUTH_MODE?: string;
}

/**
 * 서버마다 다른 로그인 방식.
 * - gl: GL 계정 로그인이 필요하다. 게스트는 GL 계정으로 만든 게스트 방에만 들어온다. 전적은 GL 계정 둘이 한 판일 때 남는다. (운영)
 * - hybrid: GL 계정으로 로그인하면 그 계정으로, 안 하면 이름만으로 논다. 전적은 GL 계정 둘일 때만 남는다. (개발)
 * - open: 로그인 없이 이름만 쓴다. GL 계정을 확인하지 않는다. (로컬 서버, 인터넷이 없어도 된다)
 */
export type AuthMode = "gl" | "hybrid" | "open";

export function authMode(env: AuthEnv): AuthMode {
  if (env.AUTH_MODE === "gl" || env.AUTH_MODE === "hybrid" || env.AUTH_MODE === "open") return env.AUTH_MODE;
  return env.REQUIRE_AUTH === "false" ? "open" : "gl";
}

/** GL 로그인이 꼭 필요한가 (gl 방식일 때만) */
export function authRequired(env: AuthEnv): boolean {
  return authMode(env) === "gl";
}

export function toPublicUser(user: GlUser | PublicUser): PublicUser {
  return { id: user.id, username: user.username, nickname: user.nickname, emailVerified: user.emailVerified };
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match ? match[1]! : null;
}

// ---- GL Account 세션 검증 (짧은 캐시) ----

const verifyCache = new Map<string, { user: PublicUser | null; until: number }>();

export async function verifyGlSession(
  env: AuthEnv,
  token: string,
  now = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<PublicUser | null> {
  if (!env.GL_ACCOUNT_KEY) return null;
  const cached = verifyCache.get(token);
  if (cached && cached.until > now) return cached.user;

  let user: PublicUser | null = null;
  try {
    const res = await fetcher(`${ACCOUNT_ORIGIN}/api/internal/verify-session`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.GL_ACCOUNT_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (res.status === 200) {
      const body = (await res.json()) as { user?: GlUser };
      user = body.user ? toPublicUser(body.user) : null;
    } else if (res.status !== 401) {
      return null; // 장애일 때는 캐시하지 않는다
    }
  } catch {
    return null;
  }
  if (verifyCache.size > 500) verifyCache.clear();
  verifyCache.set(token, { user, until: now + VERIFY_CACHE_MS });
  return user;
}

/** 브라우저의 gl_session 쿠키로 현재 사용자를 찾는다. */
export function userFromCookie(env: AuthEnv, request: Request): Promise<PublicUser | null> {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  return token ? verifyGlSession(env, token) : Promise.resolve(null);
}

export function loginRedirectUrl(returnTo: string): string {
  return `${ACCOUNT_ORIGIN}/?return=${encodeURIComponent(returnTo)}`;
}

// ---- 요청에서 사용자 찾기 ----

/** 게임 세션 토큰(Authorization 헤더) 또는 gl_session 쿠키로 사용자를 찾는다. */
export async function identify(env: Env & AuthEnv, request: Request): Promise<PublicUser | null> {
  const bearer = bearerToken(request);
  if (bearer) return authStore(env).session(bearer);
  return userFromCookie(env, request);
}

export type ClaimResult =
  | { status: "pending" }
  | { status: "approved"; token: string; user: PublicUser }
  | { status: "unknown" };

export function authStore(env: Env) {
  return env.AUTH.get(env.AUTH.idFromName("global"));
}
