// 테스트용 D1 흉내. 진짜 SQLite(node:sqlite)에 마이그레이션 SQL을 그대로 적용해서 쿼리를 검증한다.
import { readFileSync, readdirSync } from "node:fs";
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
  // migrations/ 의 SQL을 번호 순서대로 모두 적용한다.
  const dir = decodeURIComponent(new URL("../../migrations/", import.meta.url).pathname);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(dir + file, "utf8"));
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
