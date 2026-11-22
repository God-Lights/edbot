import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
