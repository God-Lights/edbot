import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonRankingStore, rebuildPlayers } from "./json-store";
import { acquireLock } from "./lock";
import type { MatchInput } from "../../../server/src/ranking/store";

let root: string;
const data = () => join(root, "data");
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "commander-store-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const match = (over: Partial<MatchInput> = {}): MatchInput => ({
  roomCode: "ABCD", startedAt: 1_000, endedAt: 241_000,
  users: [{ userId: "name:에드", nickname: "에드" }, { userId: "name:민수", nickname: "민수" }],
  winnerSeat: 0, reason: "hp", score: [17, 3], kills: [4, 2], picks: [["dwargon"], ["ankio"]], ...over,
});

describe("JSON 파일 저장소", () => {
  test("저장하고, 서버를 다시 켜도(새 객체) 같은 전적·순위·최근 판·다시 보기가 나온다", async () => {
    const a = new JsonRankingStore(data());
    await a.recordMatch(match());
    await a.recordMatch(match({ startedAt: 2_000, endedAt: 300_000, winnerSeat: 1 }));
    await a.saveReplay("ABCD:1000", '{"version":1}', 7);
    const b = new JsonRankingStore(data());
    expect(await b.getLeaderboard(10, null)).toEqual(await a.getLeaderboard(10, null));
    expect(await b.getPlayerStats("name:에드")).toEqual(await a.getPlayerStats("name:에드"));
    expect(await b.getRecentMatches("name:민수", 10)).toEqual(await a.getRecentMatches("name:민수", 10));
    expect(await b.getReplay("ABCD:1000")).toBe('{"version":1}');
    expect(await b.recordMatch(match())).toBeNull(); // 다시 켠 뒤에도 같은 판은 두 번 저장하지 않는다
  });

  test("파일 모양: players.json, matches.jsonl(한 판에 한 줄), replays/ (윈도우에 못 쓰는 ':' 없이)", async () => {
    const s = new JsonRankingStore(data());
    await s.recordMatch(match());
    await s.recordMatch(match({ startedAt: 2_000 }));
    await s.saveReplay("ABCD:1000", "{}");
    expect(JSON.parse(readFileSync(join(data(), "players.json"), "utf8")).schemaVersion).toBe(1);
    expect(readFileSync(join(data(), "matches.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
    const files = readdirSync(join(data(), "replays"));
    expect(files).toEqual(["ABCD%3A1000.json"]);
    expect(files.some((f) => f.includes(":"))).toBe(false);
    expect(existsSync(join(data(), "players.json.tmp"))).toBe(false); // 임시 파일이 남지 않는다
  });

  test("players.json이 깨졌으면 옮겨 두고 matches.jsonl 로 다시 만든다 (레이팅·닉네임 그대로)", async () => {
    const a = new JsonRankingStore(data());
    await a.recordMatch(match());
    await a.recordMatch(match({ startedAt: 2_000, endedAt: 300_000, winnerSeat: null }));
    writeFileSync(join(data(), "players.json"), "{ 깨진 파일");
    const b = new JsonRankingStore(data());
    expect(await b.getLeaderboard(10, null)).toEqual(await a.getLeaderboard(10, null));
    expect(b.notes.join(" ")).toContain("깨져");
    expect(readdirSync(data()).some((f) => f.startsWith("players.json.broken-"))).toBe(true);
  });

  test("players.json이 없어도 다시 만든다", async () => {
    const a = new JsonRankingStore(data());
    await a.recordMatch(match());
    rmSync(join(data(), "players.json"));
    expect(await new JsonRankingStore(data()).getLeaderboard(10, null)).toEqual(await a.getLeaderboard(10, null));
  });

  test("꺼지다 만 마지막 줄은 건너뛰고 나머지는 읽는다", async () => {
    const a = new JsonRankingStore(data());
    await a.recordMatch(match());
    appendFileSync(join(data(), "matches.jsonl"), '{"id":"ABCD:9999","room_code":"AB');
    const b = new JsonRankingStore(data());
    expect((await b.getRecentMatches("name:에드", 10)).length).toBe(1);
    expect(b.notes.join(" ")).toContain("1개");
  });

  test("rebuildPlayers: 기록만으로 처음과 같은 선수 표를 만든다", async () => {
    const a = new JsonRankingStore(data());
    await a.recordMatch(match());
    await a.recordMatch(match({ startedAt: 2_000, endedAt: 300_000, winnerSeat: 1 }));
    const rebuilt = rebuildPlayers(a.exportData().matches).sort((x, y) => x.user_id.localeCompare(y.user_id));
    const original = a.exportData().players.sort((x, y) => x.user_id.localeCompare(y.user_id));
    expect(rebuilt).toEqual(original);
  });

  test("내보내기 -> 다른 폴더에 불러오기, 이미 있는 것은 그대로", async () => {
    const a = new JsonRankingStore(join(root, "a", "data"), join(root, "a", "backups"));
    await a.recordMatch(match());
    await a.saveReplay("ABCD:1000", "{}", 3);
    const exported = JSON.parse(JSON.stringify(a.exportData()));
    expect(exported.replays).toHaveLength(1);
    const b = new JsonRankingStore(join(root, "b", "data"), join(root, "b", "backups"));
    expect(b.isEmpty()).toBe(true);
    expect(b.mergeData(exported)).toEqual({ players: 2, matches: 1, replays: 1 });
    expect(b.isEmpty()).toBe(false);
    expect(await b.getReplay("ABCD:1000")).toBe("{}");
    expect(b.mergeData(exported)).toEqual({ players: 0, matches: 0, replays: 0 });
    // 불러온 내용도 파일에 저장되어서, 다시 켜도 남아 있다
    const c = new JsonRankingStore(join(root, "b", "data"), join(root, "b", "backups"));
    expect(await c.getLeaderboard(10, null)).toEqual(await a.getLeaderboard(10, null));
  });

  test("백업: 날짜 폴더에 복사하고 14일치만 남긴다", async () => {
    const s = new JsonRankingStore(data(), join(root, "backups"));
    await s.recordMatch(match());
    for (let d = 1; d <= 20; d++) s.backup(new Date(2026, 0, d));
    const days = readdirSync(join(root, "backups")).sort();
    expect(days).toHaveLength(14);
    expect(days[0]).toBe("20260107");
    expect(existsSync(join(root, "backups", "20260120", "players.json"))).toBe(true);
    expect(existsSync(join(root, "backups", "20260120", "matches.jsonl"))).toBe(true);
  });

  test("순위·승률 계산은 D1 저장소와 같다 (서버 시험과 같은 시나리오)", async () => {
    const s = new JsonRankingStore(data());
    await s.recordMatch(match({ startedAt: 1, endedAt: 10, users: [{ userId: "a", nickname: "A" }, { userId: "b", nickname: "B" }] }));
    await s.recordMatch(match({ startedAt: 2, endedAt: 20, users: [{ userId: "c", nickname: "C" }, { userId: "d", nickname: "D" }] }));
    expect((await s.getLeaderboard(10, "c")).map((e) => e.nickname)).toEqual(["A", "C", "B", "D"]);
  });
});

describe("데이터 폴더 잠금", () => {
  test("같은 폴더를 두 번째로 잡으려 하면 거절하고, 놓으면 다시 잡을 수 있다", () => {
    const first = acquireLock(root, process.pid);
    expect(first.ok).toBe(true);
    // 다른 프로세스 번호로 시도하면(살아 있는 첫 프로세스가 쥐고 있다) 거절
    const second = acquireLock(root, process.pid + 1);
    expect(second.ok).toBe(false);
    if (first.ok) first.release();
    expect(acquireLock(root, process.pid + 1).ok).toBe(true);
  });

  test("죽은 프로세스의 낡은 잠금은 덮어쓴다", () => {
    writeFileSync(join(root, "commander.lock"), "2147480000"); // 없는 프로세스 번호
    expect(acquireLock(root).ok).toBe(true);
  });
});
