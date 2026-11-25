// 문의(채팅): 사용자가 남기고, 관리자가 답하고, 사용자가 답을 본다.
import { describe, expect, it } from "vitest";
import { SUPPORT_LIMITS, SupportDeskCore, cleanText, isThreadId } from "../src/support-core";
import type { SupportStorage } from "../src/support-core";
import { handleSupport } from "../src/support";

function memoryStorage(): SupportStorage & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    async get<T>(key: string) { return structuredClone(map.get(key)) as T | undefined; },
    async put(key: string, value: unknown) { map.set(key, structuredClone(value)); },
    async list<T>({ prefix }: { prefix: string }) {
      return new Map([...map].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v) as T]));
    },
  };
}

describe("문의 데스크", () => {
  it("새 문의를 열고, 관리자가 답하고, 사용자가 답을 본다 (읽음 표시)", async () => {
    const desk = new SupportDeskCore(memoryStorage());
    const first = await desk.post({ name: "  철수 ", text: "  설치가 안 돼요\r\n도와주세요  ", client: "1.1.1.1" }, 1000);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const id = first.value.id;
    expect(isThreadId(id)).toBe(true);
    expect(first.value.name).toBe("철수");
    expect(first.value.messages).toEqual([{ from: "user", text: "설치가 안 돼요\n도와주세요", at: 1000 }]);

    const list = await desk.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.staffUnread).toBe(1);

    const replied = await desk.reply(id, "SideStore 를 먼저 설치해 주세요", 2000);
    expect(replied.ok && replied.value.userUnread).toBe(1);
    expect((await desk.list())[0]!.staffUnread).toBe(0);

    const seen = await desk.view(id);
    expect(seen.ok && seen.value.messages.map((m) => m.from)).toEqual(["user", "staff"]);
    // 사용자 화면에는 관리용 수치가 없다
    expect(seen.ok && "staffUnread" in seen.value).toBe(false);

    const again = await desk.post({ thread: id, text: "됐어요 감사합니다", client: "1.1.1.1" }, 3000);
    expect(again.ok && again.value.messages).toHaveLength(3);
  });

  it("빈 글, 너무 긴 글, 없는 대화, 닫힌 대화는 거절한다", async () => {
    const desk = new SupportDeskCore(memoryStorage());
    expect(await desk.post({ text: "   ", client: "a" })).toEqual({ ok: false, code: "empty_text" });
    expect(await desk.post({ text: 3, client: "a" })).toEqual({ ok: false, code: "empty_text" });
    expect(await desk.post({ text: "가".repeat(SUPPORT_LIMITS.text + 1), client: "a" })).toEqual({ ok: false, code: "too_long" });
    expect(await desk.post({ thread: "nope", text: "hi", client: "a" })).toEqual({ ok: false, code: "not_found" });
    const t = await desk.post({ text: "hi", client: "a" });
    if (!t.ok) throw new Error("post");
    await desk.setClosed(t.value.id, true);
    expect(await desk.post({ thread: t.value.id, text: "또", client: "a" })).toEqual({ ok: false, code: "closed" });
  });

  it("새 대화는 한 사람(IP)이 한 시간에 5개까지, 한 대화에서는 1분에 6개까지", async () => {
    const desk = new SupportDeskCore(memoryStorage());
    for (let i = 0; i < SUPPORT_LIMITS.threadsPerHour; i++) expect((await desk.post({ text: `q${i}`, client: "ip" }, 0)).ok).toBe(true);
    expect(await desk.post({ text: "more", client: "ip" }, 1000)).toEqual({ ok: false, code: "rate_limited" });
    expect((await desk.post({ text: "other", client: "ip2" }, 1000)).ok).toBe(true);
    expect((await desk.post({ text: "later", client: "ip" }, 60 * 60_000 + 1)).ok).toBe(true);

    const t = await desk.post({ text: "1", client: "x" }, 0);
    if (!t.ok) throw new Error("post");
    for (let i = 2; i <= SUPPORT_LIMITS.messagesPerMinute; i++) expect((await desk.post({ thread: t.value.id, text: String(i), client: "x" }, i)).ok).toBe(true);
    expect(await desk.post({ thread: t.value.id, text: "spam", client: "x" }, 100)).toEqual({ ok: false, code: "rate_limited" });
    expect((await desk.post({ thread: t.value.id, text: "ok", client: "x" }, 70_000)).ok).toBe(true);
  });

  it("제어 문자는 지우고 줄바꿈은 남긴다", () => {
    expect(cleanText("a\u0000b\u0007c\nd\te", 100)).toBe("abc\nde");
    expect(cleanText(null, 10)).toBeNull();
  });
});

describe("문의 HTTP", () => {
  // Durable Object 대신 같은 모양의 객체를 꽂는다
  function env(key = "secret-key") {
    const core = new SupportDeskCore(memoryStorage());
    const stub = {
      post: (i: Parameters<SupportDeskCore["post"]>[0]) => core.post(i),
      view: (id: string) => core.view(id),
      list: () => core.list(),
      adminView: (id: string) => core.adminView(id),
      reply: (id: string, text: unknown) => core.reply(id, text),
      setClosed: (id: string, closed: boolean) => core.setClosed(id, closed),
    };
    return { SUPPORT: { idFromName: () => "global", get: () => stub } as never, SUPPORT_ADMIN_KEY: key };
  }
  const call = (e: ReturnType<typeof env>, path: string, init?: RequestInit) => {
    const req = new Request(`http://s.test${path}`, init);
    return handleSupport(req, e, new URL(req.url)) as Promise<Response>;
  };
  const post = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

  it("사용자는 남기고 보기만, 관리자는 키가 있어야 목록·답하기", async () => {
    const e = env();
    const created = await (await call(e, "/api/support/messages", post({ name: "영희", text: "안녕하세요" }))).json() as { id: string };
    expect(isThreadId(created.id)).toBe(true);

    expect((await call(e, "/api/support/admin/threads")).status).toBe(401);
    expect((await call(e, "/api/support/admin/threads", { headers: { authorization: "Bearer wrong-key!" } })).status).toBe(401);
    const auth = { authorization: "Bearer secret-key" };
    const list = await (await call(e, "/api/support/admin/threads", { headers: auth })).json() as { threads: Array<{ id: string }> };
    expect(list.threads.map((t) => t.id)).toEqual([created.id]);
    expect((await call(e, "/api/support/admin/reply", post({ id: created.id, text: "네, 무엇을 도와드릴까요?" }, auth))).status).toBe(200);

    const mine = await (await call(e, `/api/support/thread?id=${created.id}`)).json() as { messages: Array<{ from: string }> };
    expect(mine.messages.map((m) => m.from)).toEqual(["user", "staff"]);
    const missing = await call(e, "/api/support/thread?id=abc");
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { message: string }).message).toContain("새로 문의");
  });

  it("관리자 키가 없는 서버는 답하기만 꺼진다, 다른 경로는 null", async () => {
    const e = env("");
    expect((await call(e, "/api/support/messages", post({ text: "hi" }))).status).toBe(200);
    expect((await call(e, "/api/support/admin/threads", { headers: { authorization: "Bearer " } })).status).toBe(403);
    const other = new Request("http://s.test/api/chess");
    expect(await handleSupport(other, e, new URL(other.url))).toBeNull();
  });
});
