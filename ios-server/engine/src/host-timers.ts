// 앱이 타이머를 대신 돌린다 (안드로이드 서버 앱).
// 숨은 웹뷰는 화면에 안 보이면 setTimeout 을 늦추거나(1초·1분 단위) 멈출 수 있다. 게임 단계 시간이 틀어지지 않게
// 타이머를 앱(Kotlin)에 맡긴다: 앱이 ms 뒤에 globalThis.__hostTimer(id) 를 부른다.

export interface HostTimers {
  schedule(id: number, ms: number): void;
  cancel(id: number): void;
}

type Entry = { fn: unknown; args: unknown[]; every: number | null };

export function installHostTimers(host: HostTimers): void {
  const timers = new Map<number, Entry>();
  let next = 1;
  const g = globalThis as unknown as Record<string, unknown>;
  const delay = (ms: unknown): number => Math.max(0, Number(ms) || 0);

  const add = (fn: unknown, ms: unknown, args: unknown[], repeat: boolean): number => {
    const id = next++;
    const wait = delay(ms);
    timers.set(id, { fn, args, every: repeat ? Math.max(1, wait) : null });
    host.schedule(id, wait);
    return id;
  };
  const remove = (id: unknown): void => {
    const key = Number(id);
    if (timers.delete(key)) host.cancel(key);
  };

  g.setTimeout = (fn: unknown, ms?: unknown, ...args: unknown[]) => add(fn, ms, args, false);
  g.setInterval = (fn: unknown, ms?: unknown, ...args: unknown[]) => add(fn, ms, args, true);
  g.clearTimeout = remove;
  g.clearInterval = remove;
  g.__hostTimer = (id: number): void => {
    const entry = timers.get(id);
    if (!entry) return;
    if (entry.every === null) timers.delete(id);
    else host.schedule(id, entry.every);
    try {
      if (typeof entry.fn === "function") (entry.fn as (...a: unknown[]) => void)(...entry.args);
    } catch (error) {
      console.error("[타이머 오류]", error);
    }
  };
}
