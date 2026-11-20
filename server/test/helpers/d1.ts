// 테스트용 D1 흉내. 진짜 SQLite(node:sqlite)에 마이그레이션 SQL을 그대로 적용해서 쿼리를 검증한다.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}
  bind(...params: unknown[]): Statement {
    return new Statement(this.db, this.sql, params);
  }
  async first<T = unknown>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...(this.params as never[])) as T | undefined) ?? null;
  }
  async all<T = unknown>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...(this.params as never[])) as T[] };
  }
  async run(): Promise<unknown> {
    return this.db.prepare(this.sql).run(...(this.params as never[]));
  }
}

export function createTestD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  const path = decodeURIComponent(new URL("../../migrations/0001_init.sql", import.meta.url).pathname);
  db.exec(readFileSync(path, "utf8"));
  return {
    prepare: (sql: string) => new Statement(db, sql),
    batch: async (statements: Statement[]) => {
      db.exec("BEGIN");
      try {
        for (const s of statements) await s.run();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return [];
    },
  } as unknown as D1Database;
}
