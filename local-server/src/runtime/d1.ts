// Cloudflare D1을 흉내 낸다. (시제품: bun:sqlite 파일. 다음 단계에서 JSON 저장소로 바꾼다.)
// 서버 코드가 쓰는 prepare().bind().first()/all()/run(), batch()만 구현한다.

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface Migration {
  name: string;
  sql: string;
}

function readMigrationDir(dir: string): Migration[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}

type Param = string | number | bigint | boolean | null | Uint8Array;

class Statement {
  constructor(
    private readonly db: Database,
    readonly sql: string,
    private readonly params: Param[] = [],
  ) {}

  bind(...params: Param[]): Statement {
    return new Statement(this.db, this.sql, params);
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.params as never[])) as Record<string, unknown> | null;
    if (!row) return null;
    return (column ? (row[column] as T) : (row as T)) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true }> {
    const results = this.db.prepare(this.sql).all(...(this.params as never[])) as T[];
    return { results, success: true };
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const result = this.db.prepare(this.sql).run(...(this.params as never[]));
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  runSync(): { changes: number } {
    const result = this.db.prepare(this.sql).run(...(this.params as never[]));
    return { changes: Number(result.changes) };
  }
}

export class LocalD1 {
  private readonly db: Database;

  /** migrations: 폴더 경로, 또는 실행파일 안에 넣어 둔 { name, sql } 목록 */
  constructor(file: string, migrations: string | Migration[]) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate(typeof migrations === "string" ? readMigrationDir(migrations) : migrations);
  }

  /** 이름순으로 한 번씩 적용한다. */
  private migrate(list: Migration[]): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
    const applied = new Set((this.db.prepare("SELECT name FROM _migrations").all() as Array<{ name: string }>).map((r) => r.name));
    for (const { name, sql } of [...list].sort((a, b) => a.name.localeCompare(b.name))) {
      if (applied.has(name)) continue;
      this.db.exec(sql);
      this.db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(name, Date.now());
      console.log(`[DB] 마이그레이션 적용: ${name}`);
    }
  }

  prepare(sql: string): Statement {
    return new Statement(this.db, sql);
  }

  async batch(statements: Statement[]): Promise<Array<{ success: true; meta: { changes: number } }>> {
    const results: Array<{ success: true; meta: { changes: number } }> = [];
    this.db.exec("BEGIN");
    try {
      for (const s of statements) results.push({ success: true, meta: { changes: s.runSync().changes } });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return results;
  }

  close(): void {
    this.db.close();
  }
}
