// 문의(채팅): 설치 안내 페이지의 "문의" 탭에서 사용자가 남기고, 관리자가 답한다.
// 저장은 키-값 저장소 하나(Durable Object storage 또는 시험용 Map)에 대화마다 한 키로 한다.
//
// - 대화 id 는 추측할 수 없는 긴 난수다. 사용자는 이 id 를 브라우저에 저장해 두고 자기 대화만 본다.
// - 관리자는 SUPPORT_ADMIN_KEY 로 모든 대화를 보고 답한다. (키 확인은 index.ts)

export interface SupportMessage {
  from: "user" | "staff";
  text: string;
  at: number;
}

export interface SupportThread {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  closed: boolean;
  /** 관리자가 아직 안 읽은 사용자 메시지 수 */
  staffUnread: number;
  /** 사용자가 아직 안 읽은 답 수 */
  userUnread: number;
  messages: SupportMessage[];
}

/** 사용자에게 보여 주는 대화 (관리용 수치는 뺀다) */
export interface PublicThread {
  id: string;
  name: string;
  closed: boolean;
  messages: SupportMessage[];
}

export interface ThreadSummary {
  id: string;
  name: string;
  updatedAt: number;
  closed: boolean;
  staffUnread: number;
  count: number;
  last: SupportMessage | null;
}

export const SUPPORT_LIMITS = {
  text: 1000,
  name: 20,
  /** 한 대화에 남길 수 있는 메시지 수 (넘으면 새 대화를 열어야 한다) */
  messagesPerThread: 200,
  /** 한 사용자(IP)가 한 시간에 열 수 있는 대화 수 */
  threadsPerHour: 5,
  /** 한 대화에서 1분에 보낼 수 있는 사용자 메시지 수 */
  messagesPerMinute: 6,
} as const;

/** Durable Object storage 와 같은 모양의 키-값 저장소 */
export interface SupportStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}

export type SupportFailure = "empty_text" | "too_long" | "not_found" | "closed" | "full" | "rate_limited";
export type SupportResult<T> = { ok: true; value: T } | { ok: false; code: SupportFailure };

const ok = <T>(value: T): SupportResult<T> => ({ ok: true, value });
const fail = <T>(code: SupportFailure): SupportResult<T> => ({ ok: false, code });

const THREAD = "thread:";
const RATE = "rate:";
const HOUR = 60 * 60_000;

function randomId(): string {
  const buf = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 대화 id 형식 (난수 36자리 16진수) */
export const isThreadId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{36}$/.test(id);

/** 줄 끝 공백과 제어 문자를 정리한다. 줄바꿈은 남긴다. */
export function cleanText(text: unknown, max: number): string | null {
  if (typeof text !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim();
  if (cleaned.length > max) return null;
  return cleaned;
}

export function toPublic(thread: SupportThread): PublicThread {
  return { id: thread.id, name: thread.name, closed: thread.closed, messages: thread.messages };
}

export function summarize(thread: SupportThread): ThreadSummary {
  return {
    id: thread.id,
    name: thread.name,
    updatedAt: thread.updatedAt,
    closed: thread.closed,
    staffUnread: thread.staffUnread,
    count: thread.messages.length,
    last: thread.messages[thread.messages.length - 1] ?? null,
  };
}

export class SupportDeskCore {
  constructor(private readonly storage: SupportStorage) {}

  private load(id: string): Promise<SupportThread | undefined> {
    return this.storage.get<SupportThread>(THREAD + id);
  }

  private save(thread: SupportThread): Promise<void> {
    return this.storage.put(THREAD + thread.id, thread);
  }

  /**
   * 사용자가 메시지를 남긴다. thread 가 없으면 새 대화를 연다. client 는 IP(새 대화 수 제한용).
   */
  async post(input: { thread?: string; name?: unknown; text: unknown; client: string }, now = Date.now()): Promise<SupportResult<PublicThread>> {
    const text = cleanText(input.text, SUPPORT_LIMITS.text);
    if (text === null) return fail(typeof input.text === "string" ? "too_long" : "empty_text");
    if (!text) return fail("empty_text");

    let thread: SupportThread | undefined;
    if (input.thread) {
      thread = isThreadId(input.thread) ? await this.load(input.thread) : undefined;
      if (!thread) return fail("not_found");
      if (thread.closed) return fail("closed");
      if (thread.messages.length >= SUPPORT_LIMITS.messagesPerThread) return fail("full");
      const recent = thread.messages.filter((m) => m.from === "user" && now - m.at < 60_000).length;
      if (recent >= SUPPORT_LIMITS.messagesPerMinute) return fail("rate_limited");
    } else {
      const rateKey = RATE + input.client;
      const rate = (await this.storage.get<{ since: number; count: number }>(rateKey)) ?? { since: now, count: 0 };
      if (now - rate.since >= HOUR) { rate.since = now; rate.count = 0; }
      if (rate.count >= SUPPORT_LIMITS.threadsPerHour) return fail("rate_limited");
      rate.count += 1;
      await this.storage.put(rateKey, rate);
      const name = cleanText(input.name, 100)?.slice(0, SUPPORT_LIMITS.name) || "이름 없음";
      thread = { id: randomId(), name, createdAt: now, updatedAt: now, closed: false, staffUnread: 0, userUnread: 0, messages: [] };
    }

    thread.messages.push({ from: "user", text, at: now });
    thread.updatedAt = now;
    thread.staffUnread += 1;
    await this.save(thread);
    return ok(toPublic(thread));
  }

  /** 사용자가 자기 대화를 본다 (읽음 처리) */
  async view(id: string): Promise<SupportResult<PublicThread>> {
    const thread = isThreadId(id) ? await this.load(id) : undefined;
    if (!thread) return fail("not_found");
    if (thread.userUnread) {
      thread.userUnread = 0;
      await this.save(thread);
    }
    return ok(toPublic(thread));
  }

  /** 관리자: 대화 목록 (최근 것부터) */
  async list(): Promise<ThreadSummary[]> {
    const all = await this.storage.list<SupportThread>({ prefix: THREAD });
    return [...all.values()].map(summarize).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 관리자: 대화 하나 (관리자 읽음 처리) */
  async adminView(id: string): Promise<SupportResult<SupportThread>> {
    const thread = isThreadId(id) ? await this.load(id) : undefined;
    if (!thread) return fail("not_found");
    if (thread.staffUnread) {
      thread.staffUnread = 0;
      await this.save(thread);
    }
    return ok(thread);
  }

  /** 관리자: 답하기 */
  async reply(id: string, textInput: unknown, now = Date.now()): Promise<SupportResult<SupportThread>> {
    const text = cleanText(textInput, SUPPORT_LIMITS.text * 2);
    if (text === null) return fail("too_long");
    if (!text) return fail("empty_text");
    const thread = isThreadId(id) ? await this.load(id) : undefined;
    if (!thread) return fail("not_found");
    thread.messages.push({ from: "staff", text, at: now });
    thread.updatedAt = now;
    thread.userUnread += 1;
    thread.staffUnread = 0;
    await this.save(thread);
    return ok(thread);
  }

  /** 관리자: 대화 닫기·다시 열기 */
  async setClosed(id: string, closed: boolean): Promise<SupportResult<SupportThread>> {
    const thread = isThreadId(id) ? await this.load(id) : undefined;
    if (!thread) return fail("not_found");
    thread.closed = closed;
    await this.save(thread);
    return ok(thread);
  }
}
