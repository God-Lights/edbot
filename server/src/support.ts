// 문의(채팅) HTTP 경로. 저장은 Durable Object SupportDesk(support-desk.ts), 로직은 support-core.ts.
import type { SupportDesk } from "./support-desk";
import type { SupportFailure } from "./support-core";

const MESSAGES: Record<SupportFailure, [number, string]> = {
  empty_text: [400, "내용을 적어 주세요."],
  too_long: [400, "너무 길어요. 1000자 안으로 적어 주세요."],
  not_found: [404, "대화를 찾을 수 없어요. 새로 문의해 주세요."],
  closed: [409, "끝난 문의예요. 새로 문의해 주세요."],
  full: [409, "이 대화는 가득 찼어요. 새로 문의해 주세요."],
  rate_limited: [429, "조금 뒤에 다시 보내 주세요."],
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/** 같은 길이로 끝까지 비교한다 (키를 한 글자씩 맞혀 보는 것을 어렵게) */
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface SupportEnv {
  SUPPORT?: DurableObjectNamespace<SupportDesk>;
  SUPPORT_ADMIN_KEY?: string;
}

/**
 * /api/support/* 를 처리한다. 다른 경로면 null.
 *   POST /api/support/messages        {thread?, name?, text}   사용자: 남기기 (thread 가 없으면 새 대화)
 *   GET  /api/support/thread?id=                               사용자: 내 대화
 *   GET  /api/support/admin/threads                            관리자: 목록
 *   GET  /api/support/admin/thread?id=                         관리자: 대화
 *   POST /api/support/admin/reply      {id, text}              관리자: 답하기
 *   POST /api/support/admin/close      {id, closed}            관리자: 닫기·다시 열기
 * 관리자는 Authorization: Bearer <SUPPORT_ADMIN_KEY>
 */
export async function handleSupport(request: Request, env: SupportEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/support/")) return null;
  if (!env.SUPPORT) return json({ error: "unavailable", message: "이 서버에서는 문의를 받지 않아요." }, 503);
  const desk = env.SUPPORT.get(env.SUPPORT.idFromName("global"));
  const result = <T>(r: { ok: true; value: T } | { ok: false; code: SupportFailure }): Response => {
    if (r.ok) return json(r.value);
    const [status, message] = MESSAGES[r.code];
    return json({ error: r.code, message }, status);
  };
  const body = async (): Promise<Record<string, unknown>> => {
    try {
      const data: unknown = await request.json();
      return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  if (url.pathname === "/api/support/messages" && request.method === "POST") {
    const b = await body();
    const client = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "local";
    return result(await desk.post({ thread: typeof b.thread === "string" ? b.thread : undefined, name: b.name, text: b.text, client }));
  }
  if (url.pathname === "/api/support/thread" && request.method === "GET") {
    return result(await desk.view(url.searchParams.get("id") ?? ""));
  }

  if (url.pathname.startsWith("/api/support/admin/")) {
    const key = env.SUPPORT_ADMIN_KEY ?? "";
    const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!key) return json({ error: "admin_disabled", message: "관리자 키(SUPPORT_ADMIN_KEY)가 설정되지 않았어요." }, 403);
    if (!sameKey(given, key)) return json({ error: "unauthorized", message: "관리자 키가 맞지 않아요." }, 401);
    if (url.pathname === "/api/support/admin/threads" && request.method === "GET") return json({ threads: await desk.list() });
    if (url.pathname === "/api/support/admin/thread" && request.method === "GET") return result(await desk.adminView(url.searchParams.get("id") ?? ""));
    if (url.pathname === "/api/support/admin/reply" && request.method === "POST") {
      const b = await body();
      return result(await desk.reply(String(b.id ?? ""), b.text));
    }
    if (url.pathname === "/api/support/admin/close" && request.method === "POST") {
      const b = await body();
      return result(await desk.setClosed(String(b.id ?? ""), b.closed !== false));
    }
  }
  return json({ error: "not_found" }, 404);
}
