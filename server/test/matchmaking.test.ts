import { describe, expect, it } from "vitest";
import { BASE_WINDOW, MATCHED_TTL_MS, MatchQueue, WAITING_TTL_MS, WINDOW_PER_SECOND, ratingWindow } from "../src/matchmaking";

let n = 0;
const id = () => `t${++n}`;
const code = (() => { let c = 0; return () => `C${++c}`; })();
const entry = (userId: string, rating = 1000) => ({ userId, name: userId, rating });

describe("빠른 대전 매칭", () => {
  it("비슷한 레이팅 둘이 줄을 서면 같은 방 코드로 짝지어진다", () => {
    const q = new MatchQueue();
    const a = q.join(entry("a", 1000), 0, id);
    const b = q.join(entry("b", 1050), 0, id);
    const pairs = q.tick(0, code);
    expect(pairs).toHaveLength(1);
    expect(a.code).toBeTruthy();
    expect(a.code).toBe(b.code);
    expect(q.waitingCount()).toBe(0);
  });

  it("레이팅 차이가 크면 처음에는 안 붙고, 기다릴수록 허용 범위가 넓어져 붙는다", () => {
    const q = new MatchQueue();
    const a = q.join(entry("a", 1000), 0, id);
    q.join(entry("b", 1300), 0, id);
    expect(q.tick(0, code)).toHaveLength(0);
    expect(ratingWindow(0)).toBe(BASE_WINDOW);
    // 300 차이를 허용하려면 (300-100)/40 = 5초
    q.poll(a.id, 4000); q.poll([...q.tickets.keys()][1]!, 4000);
    expect(q.tick(4000, code)).toHaveLength(0);
    q.poll(a.id, 5000); q.poll([...q.tickets.keys()][1]!, 5000);
    expect(q.tick(5000, code)).toHaveLength(1);
    expect(ratingWindow(5000)).toBe(BASE_WINDOW + 5 * WINDOW_PER_SECOND);
  });

  it("같은 사람은 자기 자신과 붙지 않고, 두 번 줄을 서도 표는 하나", () => {
    const q = new MatchQueue();
    const first = q.join(entry("a"), 0, id);
    const second = q.join(entry("a"), 1000, id);
    expect(second.id).toBe(first.id);
    expect(q.tick(1000, code)).toHaveLength(0);
    expect(q.waitingCount()).toBe(1);
  });

  it("셋이 있으면 레이팅이 가장 가까운 둘이 붙고 나머지는 계속 기다린다", () => {
    const q = new MatchQueue();
    q.join(entry("a", 1000), 0, id);
    const far = q.join(entry("far", 1090), 0, id);
    const near = q.join(entry("near", 1010), 0, id);
    const pairs = q.tick(0, code);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.a.userId).toBe("a");
    expect(pairs[0]!.b.userId).toBe("near");
    expect(far.code).toBeNull();
    expect(near.code).toBeTruthy();
  });

  it("넷이면 두 쌍이 각자 다른 방 코드를 받는다", () => {
    const q = new MatchQueue();
    for (const u of ["a", "b", "c", "d"]) q.join(entry(u), 0, id);
    const pairs = q.tick(0, code);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]!.code).not.toBe(pairs[1]!.code);
  });

  it("poll로 상태를 확인하고, 취소하면 줄에서 빠진다(이미 짝지어졌으면 못 뺀다)", () => {
    const q = new MatchQueue();
    const a = q.join(entry("a"), 0, id);
    expect(q.poll(a.id, 1000)?.code).toBeNull();
    expect(q.poll("없음", 1000)).toBeNull();
    expect(q.cancel(a.id)).toBe(true);
    expect(q.poll(a.id, 2000)).toBeNull();
    const b = q.join(entry("b"), 0, id);
    q.join(entry("c"), 0, id);
    q.tick(0, code);
    expect(q.cancel(b.id)).toBe(false);
  });

  it("poll하지 않고 떠난 사람은 치워지고, 짝지어진 표도 시간이 지나면 지워진다", () => {
    const q = new MatchQueue();
    const gone = q.join(entry("gone"), 0, id);
    const stay = q.join(entry("stay", 3000), 0, id);
    q.poll(stay.id, WAITING_TTL_MS);
    q.tick(WAITING_TTL_MS + 1, code);
    expect(q.tickets.has(gone.id)).toBe(false);
    // 짝이 지어진 표
    const q2 = new MatchQueue();
    const x = q2.join(entry("x"), 0, id);
    q2.join(entry("y"), 0, id);
    q2.tick(0, code);
    expect(q2.poll(x.id, 1000)?.code).toBeTruthy();
    q2.tick(MATCHED_TTL_MS + 1, code);
    expect(q2.tickets.size).toBe(0);
  });
});
