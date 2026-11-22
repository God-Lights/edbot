// 로컬 서버의 전적·랭킹 저장소: JSON 파일.
//
//   data/players.json      선수 표 (읽기 쉽게 들여쓴 JSON)
//   data/matches.jsonl     한 판에 한 줄. 끝에 이어 붙인다. (이 파일만 있어도 선수 표를 다시 만들 수 있다)
//   data/replays/<id>.json 다시 보기, 판마다 파일 하나 (id의 ':'는 윈도우 파일 이름에 못 써서 %3A로)
//   backups/<날짜>/        시작할 때와 하루마다 players.json·matches.jsonl 복사본(최근 14일)
//
// 파일은 임시 파일에 쓰고 이름을 바꿔서, 중간에 꺼져도 반쯤 쓰인 파일이 남지 않는다.

import {
  appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { MemoryRankingStore } from "../../../server/src/ranking/memory-store";
import type { RankingData, StoredMatch, StoredReplay } from "../../../server/src/ranking/memory-store";
import type { PlayerRow } from "../../../server/src/ranking/store";

const KEEP_BACKUPS = 14;

function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** matches.jsonl 만으로 선수 표를 다시 만든다. (players.json이 없거나 깨졌을 때) */
export function rebuildPlayers(matches: StoredMatch[]): PlayerRow[] {
  const players = new Map<string, PlayerRow>();
  for (const m of matches) {
    for (const seat of [0, 1] as const) {
      const id = seat === 0 ? m.user0 : m.user1;
      const score = m.winner_seat === null ? 0.5 : m.winner_seat === seat ? 1 : 0;
      const old = players.get(id);
      players.set(id, {
        user_id: id,
        nickname: (seat === 0 ? m.nickname0 : m.nickname1) ?? old?.nickname ?? id.replace(/^name:/, ""),
        rating: seat === 0 ? m.rating0_after : m.rating1_after,
        games: (old?.games ?? 0) + 1,
        wins: (old?.wins ?? 0) + (score === 1 ? 1 : 0),
        losses: (old?.losses ?? 0) + (score === 0 ? 1 : 0),
        draws: (old?.draws ?? 0) + (score === 0.5 ? 1 : 0),
        updated_at: m.ended_at,
      });
    }
  }
  return [...players.values()];
}

export class JsonRankingStore extends MemoryRankingStore {
  private readonly playersFile: string;
  private readonly matchesFile: string;
  private readonly replayDir: string;
  /** 읽는 동안 있었던 일(시작할 때 안내문에 보여 준다) */
  readonly notes: string[] = [];

  constructor(
    private readonly dir: string,
    private readonly backupRoot: string = join(dir, "..", "backups"),
  ) {
    super();
    mkdirSync(dir, { recursive: true });
    this.playersFile = join(dir, "players.json");
    this.matchesFile = join(dir, "matches.jsonl");
    this.replayDir = join(dir, "replays");
    mkdirSync(this.replayDir, { recursive: true });
    this.load();
  }

  // ---- 읽기 ----

  private load(): void {
    // 1) 판 기록. 마지막 줄이 꺼지다 만 것이면 건너뛴다.
    if (existsSync(this.matchesFile)) {
      let bad = 0;
      for (const line of readFileSync(this.matchesFile, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line) as StoredMatch;
          if (typeof m.id !== "string" || this.matchIds.has(m.id)) continue;
          this.matches.push(m);
          this.matchIds.add(m.id);
        } catch {
          bad += 1;
        }
      }
      if (bad > 0) this.notes.push(`matches.jsonl에서 읽지 못한 줄 ${bad}개를 건너뛰었다.`);
    }
    // 2) 선수 표. 없거나 깨졌으면 판 기록으로 다시 만든다.
    let loaded = false;
    if (existsSync(this.playersFile)) {
      try {
        const data = JSON.parse(readFileSync(this.playersFile, "utf8")) as { players?: PlayerRow[] };
        for (const p of data.players ?? []) this.players.set(p.user_id, p);
        loaded = true;
      } catch {
        const aside = `${this.playersFile}.broken-${Date.now()}`;
        renameSync(this.playersFile, aside);
        this.notes.push(`players.json이 깨져 있어서 ${aside} 로 옮기고, 판 기록으로 다시 만들었다.`);
      }
    }
    if (!loaded && this.matches.length > 0) {
      for (const p of rebuildPlayers(this.matches)) this.players.set(p.user_id, p);
      this.writePlayers();
    }
  }

  // ---- 쓰기 ----

  private writePlayers(): void {
    const data = { schemaVersion: 1, players: [...this.players.values()] };
    writeAtomic(this.playersFile, JSON.stringify(data, null, 1));
  }

  protected override onMatchRecorded(match: StoredMatch): void {
    // 선수 표를 먼저 쓰고 판 기록을 잇는다. 그 사이에 꺼지면 선수 표만 앞서가는데, 판 기록이 원본이라 다음에 맞춰진다.
    this.writePlayers();
    appendFileSync(this.matchesFile, `${JSON.stringify(match)}\n`);
  }

  private replayPath(id: string): string {
    return join(this.replayDir, `${encodeURIComponent(id)}.json`);
  }

  override async saveReplay(id: string, data: string, now = Date.now()): Promise<void> {
    const path = this.replayPath(id);
    if (existsSync(path)) return;
    writeAtomic(path, JSON.stringify({ id, created_at: now, data } satisfies StoredReplay));
  }

  override async getReplay(id: string): Promise<string | null> {
    const path = this.replayPath(id);
    if (!existsSync(path)) return null;
    try {
      return (JSON.parse(readFileSync(path, "utf8")) as StoredReplay).data;
    } catch {
      return null;
    }
  }

  // ---- 내보내기와 불러오기 ----

  private readReplays(): StoredReplay[] {
    const out: StoredReplay[] = [];
    for (const file of readdirSync(this.replayDir).filter((f) => f.endsWith(".json"))) {
      try {
        out.push(JSON.parse(readFileSync(join(this.replayDir, file), "utf8")) as StoredReplay);
      } catch {
        /* 깨진 파일은 건너뛴다 */
      }
    }
    return out;
  }

  override exportData(): RankingData {
    return { ...super.exportData(), replays: this.readReplays() };
  }

  /** 없는 것만 더하고 한꺼번에 저장한다. */
  override mergeData(data: Partial<RankingData>): { players: number; matches: number; replays: number } {
    const { replays, ...rest } = data;
    const before = this.matches.length;
    const added = super.mergeData(rest);
    if (added.players > 0 || added.matches > 0) {
      this.writePlayers();
      const fresh = this.matches.slice(before);
      if (fresh.length > 0) appendFileSync(this.matchesFile, fresh.map((m) => `${JSON.stringify(m)}\n`).join(""));
    }
    for (const r of replays ?? []) {
      const path = this.replayPath(r.id);
      if (existsSync(path)) continue;
      writeAtomic(path, JSON.stringify(r));
      added.replays += 1;
    }
    return added;
  }

  override isEmpty(): boolean {
    return super.isEmpty() && this.readReplays().length === 0;
  }

  // ---- 백업 ----

  /** 오늘 날짜 폴더에 players.json·matches.jsonl 을 복사하고, 오래된 것은 지운다. */
  backup(now = new Date()): string | null {
    if (!existsSync(this.playersFile) && !existsSync(this.matchesFile)) return null;
    const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const target = join(this.backupRoot, day);
    mkdirSync(target, { recursive: true });
    for (const file of [this.playersFile, this.matchesFile]) if (existsSync(file)) copyFileSync(file, join(target, file.split(/[\\/]/).pop()!));
    const days = readdirSync(this.backupRoot).filter((d) => /^\d{8}$/.test(d)).sort();
    for (const old of days.slice(0, Math.max(0, days.length - KEEP_BACKUPS))) rmSync(join(this.backupRoot, old), { recursive: true, force: true });
    return target;
  }
}

// ---- 한 폴더를 서버 하나만 쓰게 하는 잠금 ----

/** 같은 데이터 폴더를 두 서버가 동시에 쓰면 파일이 섞인다. 잠금 파일에 프로세스 번호를 적어 두고, 살아 있는 프로세스면 거절한다. */
export function acquireLock(dir: string, pid = process.pid): { ok: true; release: () => void } | { ok: false; heldBy: number } {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "commander.lock");
  if (existsSync(file)) {
    const other = Number(readFileSync(file, "utf8").trim());
    if (Number.isInteger(other) && other > 0 && other !== pid) {
      let alive = true;
      try {
        process.kill(other, 0);
      } catch (error) {
        alive = (error as NodeJS.ErrnoException).code === "EPERM"; // 권한이 없어도 살아 있는 프로세스다
      }
      if (alive) return { ok: false, heldBy: other };
    }
  }
  writeFileSync(file, String(pid));
  return { ok: true, release: () => rmSync(file, { force: true }) };
}
