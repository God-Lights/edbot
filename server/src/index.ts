import { CHARACTERS } from "./characters";
import { AuthStore } from "./auth-store";
import { USER_HEADER, authRequired, authStore, bearerToken, identify, loginRedirectUrl } from "./auth";
import type { AuthEnv } from "./auth";
import { loadSourceJson } from "./sidestore";
import { WEAPONS } from "./forge/weapons";
import { getLeaderboard, getPlayerStats, getRecentMatches } from "./ranking/store";
import { approvedPage, donePage, failedPage, homePage } from "./pages";
import { Room } from "./room";

export { AuthStore, Room };



// 헷갈리는 글자(0/O, 1/I/L)를 뺀 알파벳. 4자리면 약 80만 가지.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const MAX_CREATE_ATTEMPTS = 8;

/** 테스트 대전 방의 코드. 들어가면 사람마다 따로 만들어진 방에서 봇과 한 판을 할 수 있다. */
const TEST_ROOM_CODE = "ADMN";

function generateRoomCode(): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    if (code !== TEST_ROOM_CODE) return code; // 일반 방이 테스트 코드와 겹치지 않게
  }
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

const SOURCE_CACHE_SECONDS = 300;

/** SideStore 소스. 릴리스 때 워크플로가 만든 파일을 가져와서 5분 동안 캐시한다. */
async function sideStoreSource(origin: string): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(`${origin}/sidestore.json`);
  const hit = await cache.match(key);
  if (hit) return hit;

  const result = await loadSourceJson(`${origin}/sidestore.json`);
  if (!result.ok) return json({ error: "releases_unavailable" }, 503);
  const response = new Response(result.body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${SOURCE_CACHE_SECONDS}`,
      ...CORS_HEADERS,
    },
  });
  await cache.put(key, response.clone());
  return response;
}

/** ADMN은 접속한 사람마다 자기만의 방(Durable Object)을 쓴다. 다른 사람과 섞이지 않는다. */
function testRoomStub(env: Env, owner: string) {
  return env.ROOM.get(env.ROOM.idFromName(`test:${owner}`));
}

function testOwner(user: { id: string } | null, request: Request): string {
  if (user) return user.id;
  // 로그인 검사를 끈 개발 서버: 이름으로 구분한다.
  const name = new URL(request.url).searchParams.get("name") ?? "anonymous";
  return `anon:${name.slice(0, 16)}`;
}

function roomStub(env: Env, code: string) {
  return env.ROOM.get(env.ROOM.idFromName(code));
}

export default {
  async fetch(request: Request, rawEnv: Env): Promise<Response> {
    const env = rawEnv as Env & AuthEnv;
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const origin = url.origin;
    const enabled = authRequired(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ---- GL Account 로그인 ----

    // GET / -> 현재 로그인 상태. 자동으로 로그인 화면으로 보내지 않고, 버튼을 눌러야 간다.
    if (request.method === "GET" && url.pathname === "/") {
      return homePage(await identify(env, request), enabled, origin);
    }
    // GET /auth/login[?login=id] -> (버튼을 눌렀을 때) GL Account 로그인 화면으로.
    if (request.method === "GET" && url.pathname === "/auth/login") {
      const loginId = url.searchParams.get("login");
      const back = new URL("/auth/done", origin);
      if (loginId) back.searchParams.set("login", loginId);
      return Response.redirect(loginRedirectUrl(back.toString()), 302);
    }
    // GET /auth/done -> 로그인하고 돌아오는 곳.
    if (request.method === "GET" && url.pathname === "/auth/done") {
      return donePage(await identify(env, request), url.searchParams.get("login"));
    }
    // POST /auth/approve -> 게임 클라이언트의 로그인 요청을 승인한다.
    if (request.method === "POST" && url.pathname === "/auth/approve") {
      if (request.headers.get("origin") !== origin) return failedPage();
      const form = await request.formData().catch(() => null);
      const loginId = form?.get("login");
      const user = await identify(env, request);
      if (!user || typeof loginId !== "string" || !(await authStore(env).approve(loginId, user))) {
        return failedPage();
      }
      return approvedPage();
    }
    // POST /api/auth/start -> 게임 클라이언트가 로그인을 시작한다. 브라우저로 loginUrl을 열게 하고 poll로 기다린다.
    if (request.method === "POST" && url.pathname === "/api/auth/start") {
      const loginId = await authStore(env).start();
      return json({ loginId, loginUrl: `${origin}/auth/login?login=${loginId}`, expiresInSeconds: 600 });
    }
    // GET /api/auth/poll?id= -> 승인되면 게임 세션 토큰을 한 번만 돌려준다.
    if (request.method === "GET" && url.pathname === "/api/auth/poll") {
      const result = await authStore(env).claim(url.searchParams.get("id") ?? "");
      if (result.status === "unknown") return json({ error: "login_expired" }, 404);
      if (result.status === "pending") return json({ status: "pending" }, 202);
      return json({ status: "approved", token: result.token, user: result.user });
    }
    // GET /api/auth/me -> 지금 로그인한 사용자.
    if (request.method === "GET" && url.pathname === "/api/auth/me") {
      const user = await identify(env, request);
      return user ? json({ user }) : json({ error: "unauthorized" }, 401);
    }
    // POST /api/auth/logout -> 게임 세션을 끊는다. (GL 계정 로그아웃은 account.officialgl.com 에서)
    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      const token = bearerToken(request);
      if (token) await authStore(env).logout(token);
      return json({ ok: true });
    }

    // 방을 만들거나 들어가려면 로그인이 필요하다. (개발할 때는 REQUIRE_AUTH=false)
    const needsLogin =
      enabled &&
      ((request.method === "POST" && url.pathname === "/api/rooms") ||
        (parts.length === 2 && parts[0] === "ws"));
    const user = needsLogin ? await identify(env, request) : null;
    if (needsLogin && !user) {
      return json({ error: "unauthorized", loginUrl: `${origin}/auth/login` }, 401);
    }

    // POST /api/rooms -> 새 방을 만들고 4자리 코드를 돌려준다.
    if (request.method === "POST" && parts.length === 2 && parts[0] === "api" && parts[1] === "rooms") {
      for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
        const code = generateRoomCode();
        if (await roomStub(env, code).init(code)) {
          return json({ code }, 201);
        }
      }
      return json({ error: "could_not_create_room" }, 503);
    }

    // GET /api/characters -> 캐릭터 12명의 데이터 (이름, 기물, 능력치).
    if (request.method === "GET" && parts.length === 2 && parts[0] === "api" && parts[1] === "characters") {
      return json({ characters: CHARACTERS });
    }

    // GET /api/leaderboard?limit=20 -> 레이팅 순위. 로그인했다면 내 줄에 isMe가 붙는다.
    if (request.method === "GET" && url.pathname === "/api/leaderboard") {
      const me = await identify(env, request);
      const limit = Number(url.searchParams.get("limit") ?? 20);
      try {
        const entries = await getLeaderboard(env.DB, Number.isFinite(limit) ? limit : 20, me?.id ?? null);
        return json({ entries });
      } catch {
        return json({ error: "ranking_unavailable" }, 503);
      }
    }
    // GET /api/me/stats, /api/me/matches -> 내 전적 (로그인 필요)
    if (request.method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "me") {
      const me = await identify(env, request);
      if (!me) return json({ error: "unauthorized", loginUrl: `${origin}/auth/login` }, 401);
      try {
        if (parts[2] === "stats") return json({ stats: await getPlayerStats(env.DB, me.id) });
        if (parts[2] === "matches") {
          const limit = Number(url.searchParams.get("limit") ?? 10);
          return json({ matches: await getRecentMatches(env.DB, me.id, Number.isFinite(limit) ? limit : 10) });
        }
      } catch {
        return json({ error: "ranking_unavailable" }, 503);
      }
    }

    // GET /sidestore.json -> SideStore(AltStore 호환) 소스. SideStore에서 "소스 추가"에 이 주소를 넣는다.
    if (request.method === "GET" && url.pathname === "/sidestore.json") {
      return sideStoreSource(origin);
    }

    // GET /api/weapons -> 무기 목록과 레시피.
    if (request.method === "GET" && parts.length === 2 && parts[0] === "api" && parts[1] === "weapons") {
      return json({ weapons: WEAPONS });
    }

    // GET /api/rooms/:code -> 방이 있는지, 들어갈 수 있는지.
    if (request.method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "rooms") {
      const code = (parts[2] ?? "").toUpperCase();
      if (!CODE_PATTERN.test(code)) return json({ error: "room_not_found" }, 404);
      if (code === TEST_ROOM_CODE) {
        // 아직 만들어지지 않았어도 들어갈 수 있다. (들어가는 순간 만들어진다)
        const me = await identify(env, request);
        const info = me || !enabled ? await testRoomStub(env, testOwner(me, request)).info() : null;
        return json(info ?? { code: TEST_ROOM_CODE, phase: "lobby", players: 0, joinable: true });
      }
      const info = await roomStub(env, code).info();
      return info ? json(info) : json({ error: "room_not_found" }, 404);
    }

    // GET /ws/:code?name=...&token=... -> WebSocket으로 방에 들어간다.
    if (parts.length === 2 && parts[0] === "ws") {
      const code = (parts[1] ?? "").toUpperCase();
      if (!CODE_PATTERN.test(code)) return json({ error: "room_not_found" }, 404);
      const forwarded = new Request(request);
      forwarded.headers.delete(USER_HEADER);
      if (user) forwarded.headers.set(USER_HEADER, JSON.stringify({ id: user.id, nickname: user.nickname }));
      if (code === TEST_ROOM_CODE) {
        const stub = testRoomStub(env, testOwner(user, request));
        await stub.init(TEST_ROOM_CODE, true); // 이미 있으면 false를 돌려줄 뿐이다
        return stub.fetch(forwarded);
      }
      return roomStub(env, code).fetch(forwarded);
    }

    if (url.pathname === "/health") {
      return json({ ok: true, service: "edbot-server" });
    }
    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;
