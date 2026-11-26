import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "../src/auth";
import { authMode, identify } from "../src/auth";
import { LINK_PENDING_MS, LinkHubCore, cleanReturnTo, cleanServerName, serverIdLabel } from "../src/link-hub";
import type { LinkStorage } from "../src/link-hub";
import { allowRegister, handleLinkHub, handleLinkedServer } from "../src/link-routes";
import { LinkedCore } from "../src/linked";
import { serverInfo } from "../src/server-info";
import { MemoryRankingStore } from "../src/ranking/memory-store";

function memoryStorage(): LinkStorage {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return structuredClone(map.get(key)) as T | undefined;
    },
    async put(key, value) {
      map.set(key, structuredClone(value));
    },
    async delete(key) {
      return map.delete(key);
    },
    async list<T>({ prefix }: { prefix: string }) {
      return new Map([...map].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v) as T]));
    },
  };
}

/** AuthStore(Durable Object)와 같은 메서드를 가진 시험용 저장소 */
function fakeAuthStore() {
  const storage = memoryStorage();
  const hub = new LinkHubCore(storage);
  const linked = new LinkedCore(storage);
  const logins = new Map<string, PublicUser | null>();
  const sessions = new Map<string, PublicUser>();
  let n = 0;
  const hex = () => (++n).toString(16).padStart(48, "0");
  return {
    async start() {
      const id = hex();
      logins.set(id, null);
      return id;
    },
    async approve(id: string, user: PublicUser) {
      if (!logins.has(id)) return false;
      logins.set(id, user);
      return true;
    },
    async claim(id: string) {
      if (!logins.has(id)) return { status: "unknown" as const };
      const user = logins.get(id);
      if (!user) return { status: "pending" as const };
      logins.delete(id);
      const token = hex();
      sessions.set(token, user);
      return { status: "approved" as const, token, user };
    },
    async session(token: string) {
      const user = sessions.get(token);
      if (!user || (await linked.isBanned(user.id))) return null;
      return user;
    },
    async logout(token: string) {
      sessions.delete(token);
    },
    linkRegister: (name: unknown) => hub.register(name),
    linkStart: (input: Parameters<LinkHubCore["start"]>[0]) => hub.start(input),
    linkInfo: (id: unknown) => hub.info(id),
    linkApprove: (id: unknown, user: PublicUser) => hub.approve(id, user),
    linkPoll: (id: unknown, secret: unknown) => hub.poll(id, secret),
    linkCredentials: () => linked.credentials(),
    setLinkCredentials: (c: Parameters<LinkedCore["setCredentials"]>[0]) => linked.setCredentials(c),
    saveRemote: (id: string, r: { linkId: string; pollSecret: string }) => linked.saveRemote(id, r),
    remote: (id: string) => linked.remote(id),
    dropRemote: (id: string) => linked.dropRemote(id),
    rememberUser: (u: PublicUser) => linked.rememberUser(u),
    isBanned: (id: string) => linked.isBanned(id),
    setBanned: (id: string, b: boolean) => linked.setBanned(id, b),
    knownUsers: () => linked.users(),
    hub,
  };
}

function envWith(store: ReturnType<typeof fakeAuthStore>, extra: Record<string, unknown>) {
  return { AUTH: { idFromName: () => "global", get: () => store }, ...extra } as never;
}

const ed: PublicUser = { id: "gl-ed", username: "ed", nickname: "에드", emailVerified: true };
const mina: PublicUser = { id: "gl-mina", username: "mina", nickname: "미나", emailVerified: true };

afterEach(() => vi.unstubAllGlobals());

describe("공식 쪽 로그인 요청 (LinkHubCore)", () => {
  it("등록 → 요청 → 승인 → 한 번만 결과", async () => {
    const hub = new LinkHubCore(memoryStorage());
    const { serverId, secret } = await hub.register("우리 반 서버");
    expect(serverId).toMatch(/^[0-9a-f]{12}$/);
    expect(await hub.start({ serverId, secret: "0".repeat(64), name: "x" })).toEqual({ ok: false, code: "unknown_server" });
    expect(await hub.start({ serverId: "../x", secret, name: "x" })).toEqual({ ok: false, code: "bad_request" });
    const started = await hub.start({ serverId, secret, name: "우리 반 서버", returnTo: "http://192.168.0.5:8787/auth/done?x=1" });
    if (!started.ok) throw new Error("start");
    expect(await hub.info(started.linkId)).toEqual({ serverId, serverName: "우리 반 서버", returnTo: "http://192.168.0.5:8787/auth/done" });
    expect(await hub.poll(started.linkId, started.pollSecret)).toEqual({ status: "pending" });
    expect(await hub.poll(started.linkId, "f".repeat(48))).toEqual({ status: "unknown" });
    expect(await hub.approve(started.linkId, ed)).not.toBeNull();
    expect(await hub.approve(started.linkId, mina)).toBeNull(); // 두 번 승인 안 됨
    expect(await hub.poll(started.linkId, started.pollSecret)).toEqual({ status: "approved", user: ed });
    expect(await hub.poll(started.linkId, started.pollSecret)).toEqual({ status: "unknown" });
  });

  it("10분이 지나면 만료, 막힌 서버는 요청을 못 만든다", async () => {
    const hub = new LinkHubCore(memoryStorage());
    const { serverId, secret } = await hub.register("a", 0);
    const started = await hub.start({ serverId, secret, name: "a" }, 0);
    if (!started.ok) throw new Error("start");
    expect(await hub.info(started.linkId, LINK_PENDING_MS + 1)).toBeNull();
    await hub.setBlocked(serverId, true);
    expect(await hub.start({ serverId, secret, name: "a" })).toEqual({ ok: false, code: "blocked" });
  });

  it("이름·돌아갈 주소 정리", () => {
    expect(cleanServerName("  a\nb  ")).toBe("a b");
    expect(cleanServerName("")).toBe("이름 없는 서버");
    expect([...cleanServerName("가".repeat(60))].length).toBe(40);
    expect(cleanReturnTo("javascript:alert(1)")).toBeNull();
    expect(cleanReturnTo("https://evil.example/steal")).toBeNull();
    expect(cleanReturnTo("http://u:p@10.0.0.2/auth/done")).toBeNull();
    expect(cleanReturnTo("http://10.0.0.2:8787/auth/done")).toBe("http://10.0.0.2:8787/auth/done");
    expect(serverIdLabel("abcdef012345")).toBe("abcd-ef01-2345");
  });

  it("등록은 한 IP 에서 한 시간에 10번까지", () => {
    for (let i = 0; i < 10; i++) expect(allowRegister("1.2.3.4", 1000)).toBe(true);
    expect(allowRegister("1.2.3.4", 1000)).toBe(false);
    expect(allowRegister("1.2.3.4", 1000 + 3_600_001)).toBe(true);
  });
});

/** 공식 서버와 개인 서버를 같이 띄운다. 개인 서버의 fetch 는 공식 서버의 handleLinkHub 로 간다. */
function twoServers(personalExtra: Record<string, unknown> = {}) {
  const official = fakeAuthStore();
  const officialEnv = envWith(official, { GL_ACCOUNT_KEY: "k", AUTH_MODE: "gl" });
  const toOfficial = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await handleLinkHub(new Request(String(input), init), officialEnv, new URL(String(input)));
    return res ?? new Response("", { status: 404 });
  });
  const personal = fakeAuthStore();
  const ranking = new MemoryRankingStore();
  const personalEnv = envWith(personal, {
    AUTH_MODE: "linked",
    LINK_ORIGIN: "https://edgame-api.officialgl.com",
    LINK_OWNER: "Ed",
    SERVER_NAME: "에드네 서버",
    STORE: ranking,
    ...personalExtra,
  });
  const call = (path: string, init: RequestInit = {}) => {
    const url = new URL(path, "http://192.168.0.5:8787");
    return handleLinkedServer(new Request(url, init), personalEnv, url, toOfficial as never);
  };
  /** 사용자가 공식 페이지에서 승인한 것처럼 (GL 쿠키 확인은 따로 시험) */
  const approveLatest = async (user: PublicUser) => {
    const links = await (official.hub as unknown as { storage: LinkStorage }).storage.list<{ user: unknown }>({ prefix: "link:" });
    const [key] = [...links].find(([, v]) => !v.user)!;
    await official.linkApprove(key.slice("link:".length), user);
  };
  return { official, officialEnv, personal, personalEnv, call, approveLatest, toOfficial, ranking };
}

describe("개인 서버 (AUTH_MODE=linked)", () => {
  it("앱: start → 공식 승인 → poll 로 이 서버의 토큰", async () => {
    const s = twoServers();
    const started = (await (await s.call("/api/auth/start", { method: "POST" }))!.json()) as { loginId: string; loginUrl: string };
    expect(started.loginUrl).toMatch(/^https:\/\/edgame-api\.officialgl\.com\/link\?id=[0-9a-f]{32}$/);
    // 처음이라 서버 등록을 했다
    expect((await s.personal.linkCredentials())?.serverId).toMatch(/^[0-9a-f]{12}$/);
    const pending = await s.call(`/api/auth/poll?id=${started.loginId}`);
    expect(pending!.status).toBe(202);
    await s.approveLatest(ed);
    const done = (await (await s.call(`/api/auth/poll?id=${started.loginId}`))!.json()) as { token: string; user: PublicUser };
    expect(done.user).toEqual(ed);
    // 이 서버의 세션으로 확인된다 (공식 토큰이 아니다)
    expect(await identify(s.personalEnv, new Request("http://x/", { headers: { authorization: `Bearer ${done.token}` } }))).toEqual(ed);
    expect((await s.call(`/api/auth/poll?id=${started.loginId}`))!.status).toBe(404);
    // 두 번째 로그인은 같은 서버 id 로
    const cred = await s.personal.linkCredentials();
    await s.call("/api/auth/start", { method: "POST" });
    expect(await s.personal.linkCredentials()).toEqual(cred);
  });

  it("웹: /auth/login → 공식 승인 → /auth/done 에서 세션 쿠키", async () => {
    const s = twoServers();
    const login = (await s.call("/auth/login?return=/server-admin.html"))!;
    expect(login.status).toBe(302);
    expect(login.headers.get("location")).toMatch(/\/link\?id=/);
    const loginCookie = login.headers.get("set-cookie")!.split(";")[0]!;
    expect(loginCookie).toMatch(/^cmd_login=/);
    await s.approveLatest(ed);
    const done = (await s.call("/auth/done", { headers: { cookie: loginCookie } }))!;
    expect(done.status).toBe(302);
    expect(done.headers.get("location")).toBe("/server-admin.html");
    const session = done.headers.get("set-cookie")!.match(/cmd_session=([0-9a-f]+)/)![1];
    expect(await identify(s.personalEnv, new Request("http://x/", { headers: { cookie: `cmd_session=${session}` } }))).toEqual(ed);
    // 밖으로 보내는 return 은 무시
    const evil = (await s.call("/auth/login?return=//evil.example"))!;
    expect(decodeURIComponent(evil.headers.get("set-cookie")!)).toMatch(/\|\/;/);
  });

  it("공식 서버에 연결할 수 없으면 알려 준다", async () => {
    const s = twoServers();
    const url = new URL("http://192.168.0.5:8787/api/auth/start");
    const res = await handleLinkedServer(new Request(url, { method: "POST" }), s.personalEnv, url, (async () => {
      throw new Error("offline");
    }) as never);
    expect(res!.status).toBe(503);
    expect(((await res!.json()) as { error: string }).error).toBe("link_unreachable");
  });

  it("주인: 사람 목록, 막기(막힌 사람은 세션도 끊김), 랭킹 처음부터", async () => {
    const s = twoServers();
    const loginAs = async (user: PublicUser) => {
      const { loginId } = (await (await s.call("/api/auth/start", { method: "POST" }))!.json()) as { loginId: string };
      await s.approveLatest(user);
      return ((await (await s.call(`/api/auth/poll?id=${loginId}`))!.json()) as { token: string }).token;
    };
    const owner = await loginAs(ed);
    const other = await loginAs(mina);
    const auth = (t: string) => ({ authorization: `Bearer ${t}` });
    expect((await s.call("/api/admin/players", { headers: auth(other) }))!.status).toBe(403);
    const list = (await (await s.call("/api/admin/players", { headers: auth(owner) }))!.json()) as { players: Array<{ id: string }> };
    expect(list.players.map((p) => p.id).sort()).toEqual(["gl-ed", "gl-mina"]);
    expect((await s.call("/api/admin/ban", { method: "POST", headers: auth(owner), body: JSON.stringify({ id: "gl-ed" }) }))!.status).toBe(400);
    expect((await s.call("/api/admin/ban", { method: "POST", headers: auth(owner), body: JSON.stringify({ id: "gl-mina" }) }))!.status).toBe(200);
    expect(await identify(s.personalEnv, new Request("http://x/", { headers: auth(other) }))).toBeNull();
    // 막힌 사람은 다시 로그인해도 안 된다
    const { loginId } = (await (await s.call("/api/auth/start", { method: "POST" }))!.json()) as { loginId: string };
    await s.approveLatest(mina);
    expect((await s.call(`/api/auth/poll?id=${loginId}`))!.status).toBe(403);
    // 쿠키로 다른 사이트에서 보낸 POST 는 거절
    const done = await (async () => {
      const l = (await s.call("/auth/login"))!;
      await s.approveLatest(ed);
      return (await s.call("/auth/done", { headers: { cookie: l.headers.get("set-cookie")!.split(";")[0]! } }))!;
    })();
    const cookie = done.headers.get("set-cookie")!.split(";")[0]!;
    expect((await s.call("/api/admin/reset-ranking", { method: "POST", headers: { cookie, origin: "https://evil.example" } }))!.status).toBe(403);
    expect((await s.call("/api/admin/reset-ranking", { method: "POST", headers: { cookie, origin: "http://192.168.0.5:8787" } }))!.status).toBe(200);
  });

  it("게스트 설정과 /api/server", () => {
    expect(authMode({ AUTH_MODE: "linked" })).toBe("gl");
    expect(authMode({ AUTH_MODE: "linked", LINK_GUESTS: "true" })).toBe("hybrid");
    const info = serverInfo({ AUTH_MODE: "linked", LINK_OWNER: " ed ", SERVER_ENV: "local" });
    expect(info.authMode).toBe("gl");
    expect(info.linked).toEqual({ owner: "ed" });
    expect(info.ranking).toBe(true);
    expect(serverInfo({ AUTH_MODE: "open" }).linked).toBeUndefined();
  });
});

describe("공식 승인 페이지", () => {
  it("GL 로그인이 안 되어 있으면 로그인 단추, 되어 있으면 서버 이름과 승인 단추", async () => {
    const s = twoServers();
    await s.call("/api/auth/start", { method: "POST" });
    const links = await (s.official.hub as unknown as { storage: LinkStorage }).storage.list({ prefix: "link:" });
    const id = [...links.keys()][0]!.slice(5);
    const pageFor = (cookie?: string) => {
      const url = new URL(`https://edgame-api.officialgl.com/link?id=${id}`);
      return handleLinkHub(new Request(url, { headers: cookie ? { cookie } : {} }), s.officialEnv, url);
    };
    const anon = await (await pageFor())!.text();
    expect(anon).toContain("에드네 서버");
    expect(anon).toContain("account.officialgl.com");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ user: { ...ed, email: "e@x" } }), { status: 200 })));
    const html = await (await pageFor("gl_session=tok-link"))!.text();
    expect(html).toContain("승인하고 들어가기");
    expect(html).not.toContain("e@x");
    // 다른 사이트에서 보낸 승인은 거절
    const url = new URL("https://edgame-api.officialgl.com/link/approve");
    const body = new URLSearchParams({ id });
    const cross = await handleLinkHub(new Request(url, { method: "POST", body, headers: { cookie: "gl_session=tok-link", origin: "https://evil.example" } }), s.officialEnv, url);
    expect(await cross!.text()).toContain("만료");
    const ok = await handleLinkHub(new Request(url, { method: "POST", body, headers: { cookie: "gl_session=tok-link", origin: "https://edgame-api.officialgl.com" } }), s.officialEnv, url);
    expect(await ok!.text()).toContain("승인했어요");
  });

  it("GL 키가 없는 서버(로컬·연결 서버)에는 공식 주소가 없다", async () => {
    const url = new URL("http://x/api/link/register");
    const res = await handleLinkHub(new Request(url, { method: "POST", body: "{}" }), envWith(fakeAuthStore(), { AUTH_MODE: "linked" }), url);
    expect(res!.status).toBe(404);
  });
});
