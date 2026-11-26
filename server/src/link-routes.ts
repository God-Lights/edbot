// GL 연결 서버의 HTTP 주소.
// - handleLinkHub: 공식 서버(GL_ACCOUNT_KEY 가 있는 서버)의 /api/link/*, /link 승인 페이지
// - handleLinkedServer: 개인 서버(AUTH_MODE=linked)의 로그인(/api/auth/*, /auth/*)과 주인 관리(/api/admin/*)
// 흐름과 이유는 link-hub.ts, linked.ts 맨 위 설명.

import { authStore, bearerToken, cookieHeader, identify, loginRedirectUrl, originHeader, readCookie, userFromCookie } from "./auth";
import type { AuthEnv, PublicUser } from "./auth";
import { cleanServerName, serverIdLabel } from "./link-hub";
import { LINK_LOGIN_COOKIE, LINK_SESSION_COOKIE, LinkClient, LinkClientFailure, LinkedCore, isLinked, isOwner, linkErrorText, linkOrigin, startRemoteLogin } from "./linked";
import type { LinkedEnv, LinkedStorage } from "./linked";
import { escapeHtml, page } from "./pages";
import { rankingStoreOf } from "./ranking/store";

type LinkEnv = Env & AuthEnv & LinkedEnv & { SERVER_NAME?: string };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...headers } });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json().catch(() => null)) as unknown;
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

// ---- 공식 서버 ----

/** 서버 등록 도배 막기: 한 IP 에서 한 시간에 10개까지 (워커 하나 안에서) */
const registerLog = new Map<string, number[]>();
const REGISTER_PER_HOUR = 10;

export function allowRegister(ip: string, now = Date.now()): boolean {
  const recent = (registerLog.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= REGISTER_PER_HOUR) {
    registerLog.set(ip, recent);
    return false;
  }
  recent.push(now);
  if (registerLog.size > 5000) registerLog.clear();
  registerLog.set(ip, recent);
  return true;
}

function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function handleLinkHub(request: Request, env: LinkEnv, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith("/api/link/") && path !== "/link" && path !== "/link/approve") return null;
  // GL 계정을 확인할 수 있는 서버(공식·개발)에서만
  if (!env.GL_ACCOUNT_KEY || isLinked(env)) return json({ error: "link_unavailable" }, 404);
  const origin = url.origin;
  const hub = authStore(env);

  if (request.method === "POST" && path === "/api/link/register") {
    if (!allowRegister(clientIp(request))) return json({ error: "rate_limited" }, 429);
    const body = await readJson(request);
    return json(await hub.linkRegister(body.name), 201);
  }
  if (request.method === "POST" && path === "/api/link/start") {
    const body = await readJson(request);
    const result = await hub.linkStart({ serverId: body.serverId, secret: body.secret, name: body.name, returnTo: body.returnTo });
    if (!result.ok) return json({ error: result.code }, result.code === "bad_request" ? 400 : 403);
    return json({ linkId: result.linkId, pollSecret: result.pollSecret, linkUrl: `${origin}/link?id=${result.linkId}`, expiresInSeconds: 600 });
  }
  if (request.method === "POST" && path === "/api/link/poll") {
    const body = await readJson(request);
    const result = await hub.linkPoll(body.id, body.secret);
    if (result.status === "unknown") return json({ error: "link_expired" }, 410);
    if (result.status === "pending") return json({ status: "pending" }, 202);
    return json({ status: "approved", user: result.user });
  }

  // 승인 페이지: GL 계정으로 로그인한 브라우저에서 "이 서버에 들어갈까요?"
  if (request.method === "GET" && path === "/link") {
    const id = url.searchParams.get("id") ?? "";
    const info = await hub.linkInfo(id);
    if (!info) return linkFailedPage();
    const user = await userFromCookie(env, request);
    const server = `<b>${escapeHtml(info.serverName)}</b><br><span class="sub">서버 id <code>${escapeHtml(serverIdLabel(info.serverId))}</code></span>`;
    if (!user) {
      const login = loginRedirectUrl(`${origin}/link?id=${encodeURIComponent(id)}`);
      return page("GL 연결 서버 로그인", `<h1>GL 계정으로 로그인</h1><p>${server}</p><p>이 서버에 GL 계정으로 들어가려면 먼저 로그인해 주세요.</p><a class="btn" href="${escapeHtml(login)}">GL 계정으로 로그인</a>`);
    }
    return page(
      "GL 연결 서버 로그인",
      `<h1>이 서버에 들어갈까요?</h1><p>${server}</p>
<p><b>${escapeHtml(user.nickname)}</b>(${escapeHtml(user.username)}) 님의 GL 아이디와 닉네임을 이 서버에 알려 주고 로그인해요. 이메일과 비밀번호는 알려 주지 않아요.</p>
<p class="warn">이 서버는 공식 서버가 아니에요. 서버를 연 사람을 알고, 지금 직접 로그인을 눌렀을 때만 승인하세요. 전적은 그 서버에만 남아요.</p>
<form method="post" action="/link/approve"><input type="hidden" name="id" value="${escapeHtml(id)}"><button type="submit">승인하고 들어가기</button></form>`,
    );
  }
  if (request.method === "POST" && path === "/link/approve") {
    if (originHeader(request) !== origin) return linkFailedPage();
    const form = await request.formData().catch(() => null);
    const id = form?.get("id");
    const user = await userFromCookie(env, request);
    if (!user || typeof id !== "string") return linkFailedPage();
    const info = await hub.linkApprove(id, user);
    if (!info) return linkFailedPage();
    if (info.returnTo) {
      // form-action 'self' 때문에 다른 주소로 바로 보내지 않고, 페이지에서 넘긴다
      const back = escapeHtml(info.returnTo);
      return page("승인했어요", `<h1>승인했어요</h1><p>${escapeHtml(info.serverName)} 서버로 돌아가요.</p><a class="btn" href="${back}">서버로 돌아가기</a>`, `<meta http-equiv="refresh" content="0;url=${back}">`);
    }
    return page("승인했어요", `<h1>승인했어요</h1><p><b>${escapeHtml(info.serverName)}</b> 서버로 돌아가세요. 이 창은 닫아도 돼요.</p>`);
  }
  return json({ error: "not_found" }, 404);
}

function linkFailedPage(): Response {
  return page("실패", "<h1>로그인 요청이 없어요</h1><p>요청이 만료되었거나 잘못되었어요. 서버에서 로그인을 다시 시작해 주세요.</p>");
}

// ---- 개인 서버 (AUTH_MODE=linked) ----

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

/** /auth/login?return= 의 돌아갈 곳: 이 서버 안의 경로만 */
function safeReturnPath(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") && raw.length < 200 ? raw : "/";
}

function linkedCore(env: LinkEnv) {
  // AuthStore 의 메서드를 LinkedCore 모양으로 (이 서버의 저장소에서 처리한다)
  return authStore(env);
}

export async function handleLinkedServer(request: Request, env: LinkEnv, url: URL, fetcher?: typeof fetch): Promise<Response | null> {
  if (!isLinked(env)) return null;
  const path = url.pathname;
  const origin = url.origin;
  const store = linkedCore(env);
  const client = new LinkClient(linkOrigin(env), fetcher ?? ((input, init) => fetch(input, init)));
  const serverName = cleanServerName(env.SERVER_NAME ?? "COMMANDER");
  // startRemoteLogin 은 LinkedCore 를 받는다: AuthStore 를 통해 같은 일을 하는 얇은 껍데기
  const core = {
    credentials: () => store.linkCredentials(),
    setCredentials: (c: Parameters<LinkedCore["setCredentials"]>[0]) => store.setLinkCredentials(c),
  } as unknown as LinkedCore;

  const begin = async (returnTo: string | null) => {
    const remote = await startRemoteLogin(core, client, serverName, returnTo);
    const loginId = await store.start();
    await store.saveRemote(loginId, { linkId: remote.linkId, pollSecret: remote.pollSecret });
    return { loginId, linkUrl: remote.linkUrl };
  };

  /** 공식 서버에 결과를 묻고, 승인되었으면 이 서버의 세션을 만든다 */
  const finish = async (loginId: string): Promise<{ status: "pending" | "unknown" | "banned" } | { status: "approved"; token: string; user: PublicUser }> => {
    const remote = await store.remote(loginId);
    if (!remote) return { status: "unknown" };
    const result = await client.poll(remote.linkId, remote.pollSecret);
    if (result.status === "pending") return { status: "pending" };
    await store.dropRemote(loginId);
    if (result.status === "unknown") return { status: "unknown" };
    await store.rememberUser(result.user);
    if (await store.isBanned(result.user.id)) return { status: "banned" };
    if (!(await store.approve(loginId, result.user))) return { status: "unknown" };
    const claimed = await store.claim(loginId);
    return claimed.status === "approved" ? claimed : { status: "unknown" };
  };

  try {
    // 앱: 기기 로그인
    if (request.method === "POST" && path === "/api/auth/start") {
      const { loginId, linkUrl } = await begin(null);
      return json({ loginId, loginUrl: linkUrl, expiresInSeconds: 600 });
    }
    if (request.method === "GET" && path === "/api/auth/poll") {
      const result = await finish(url.searchParams.get("id") ?? "");
      if (result.status !== "approved") {
        if (result.status === "pending") return json({ status: "pending" }, 202);
        if (result.status === "banned") return json({ error: "banned", message: linkErrorText("banned") }, 403);
        return json({ error: "login_expired" }, 404);
      }
      return json({ status: "approved", token: result.token, user: result.user });
    }

    // 웹: 쿠키
    if (request.method === "GET" && path === "/auth/login") {
      const { loginId, linkUrl } = await begin(`${origin}/auth/done`);
      const back = safeReturnPath(url.searchParams.get("return"));
      const headers = new Headers({ location: linkUrl, "cache-control": "no-store" });
      headers.append("set-cookie", cookie(LINK_LOGIN_COOKIE, `${loginId}|${back}`, 600));
      return new Response(null, { status: 302, headers });
    }
    if (request.method === "GET" && path === "/auth/done") {
      const raw = readCookie(cookieHeader(request), LINK_LOGIN_COOKIE) ?? "";
      const [loginId = "", back = "/"] = raw.split("|");
      const result = await finish(loginId);
      if (result.status === "pending") {
        return page("로그인", `<h1>아직 승인하지 않았어요</h1><p>공식 페이지에서 승인한 뒤 다시 와 주세요.</p><a class="btn" href="/auth/login">다시 로그인</a>`);
      }
      if (result.status !== "approved") {
        const text = result.status === "banned" ? linkErrorText("banned") : "로그인 요청이 만료되었어요. 다시 해 주세요.";
        return page("로그인", `<h1>로그인하지 못했어요</h1><p>${escapeHtml(text)}</p><a class="btn" href="/">처음으로</a>`);
      }
      const headers = new Headers({ location: safeReturnPath(back), "cache-control": "no-store" });
      // 쿠키는 응답마다 하나만 (안드로이드 서버의 NanoHTTPD 는 같은 이름의 헤더를 하나만 남긴다). cmd_login 은 10분 뒤 저절로 없어진다.
      headers.append("set-cookie", cookie(LINK_SESSION_COOKIE, result.token, 7 * 24 * 3600));
      return new Response(null, { status: 302, headers });
    }
    if (request.method === "POST" && path === "/auth/approve") return json({ error: "not_found" }, 404);
    if (request.method === "POST" && path === "/api/auth/logout") {
      const token = bearerToken(request) ?? readCookie(cookieHeader(request), LINK_SESSION_COOKIE);
      if (token) await store.logout(token);
      return json({ ok: true }, 200, { "set-cookie": cookie(LINK_SESSION_COOKIE, "", 0) });
    }
  } catch (error) {
    if (error instanceof LinkClientFailure) {
      const status = error.code === "blocked" ? 403 : 503;
      if (path.startsWith("/auth/")) return page("로그인", `<h1>로그인하지 못했어요</h1><p>${escapeHtml(linkErrorText(error.code))}</p><a class="btn" href="/">처음으로</a>`);
      return json({ error: `link_${error.code}`, message: linkErrorText(error.code) }, status);
    }
    throw error;
  }

  // 주인 관리
  if (path.startsWith("/api/admin/")) return handleOwnerAdmin(request, env, url);
  return null;
}

async function handleOwnerAdmin(request: Request, env: LinkEnv, url: URL): Promise<Response> {
  const me = await identify(env, request);
  if (!me) return json({ error: "unauthorized" }, 401);
  if (!isOwner(env, me)) return json({ error: "forbidden", message: "이 서버의 주인 계정만 쓸 수 있어요." }, 403);
  // 쿠키로 들어온 POST 는 같은 주소에서 보낸 것만 (다른 사이트가 몰래 보내지 못하게)
  if (request.method === "POST" && !bearerToken(request) && originHeader(request) !== url.origin) return json({ error: "forbidden" }, 403);
  const store = authStore(env);
  const ranking = rankingStoreOf(env);

  if (request.method === "GET" && url.pathname === "/api/admin/players") {
    const users = await store.knownUsers();
    const stats = await Promise.all(users.map((u) => ranking.getPlayerStats(u.id).catch(() => null)));
    return json({
      me: me.username,
      players: users.map((u, i) => ({ ...u, rating: stats[i]?.rating ?? null, games: stats[i]?.games ?? 0 })),
    });
  }
  if (request.method === "POST" && url.pathname === "/api/admin/ban") {
    const body = await readJson(request);
    const id = typeof body.id === "string" ? body.id : "";
    if (id === me.id) return json({ error: "self", message: "자기 자신은 막을 수 없어요." }, 400);
    if (!(await store.setBanned(id, body.banned !== false))) return json({ error: "not_found" }, 404);
    return json({ ok: true });
  }
  if (request.method === "POST" && url.pathname === "/api/admin/reset-ranking") {
    if (!ranking.resetRanking) return json({ error: "unsupported" }, 501);
    const backup = await ranking.resetRanking();
    return json({ ok: true, backup });
  }
  return json({ error: "not_found" }, 404);
}

export type { LinkedStorage };
