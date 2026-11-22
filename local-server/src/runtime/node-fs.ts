import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { Fs } from "./fs";

/** 진짜 파일을 쓰는 Fs (데스크톱 로컬 서버) */
export const nodeFs: Fs = {
  exists: (p) => existsSync(p),
  mkdir: (p) => void mkdirSync(p, { recursive: true }),
  read: (p) => readFileSync(p, "utf8"),
  write: (p, t) => writeFileSync(p, t),
  append: (p, t) => appendFileSync(p, t),
  rename: (a, b) => renameSync(a, b),
  rm: (p) => rmSync(p, { recursive: true, force: true }),
  readdir: (p) => (existsSync(p) ? readdirSync(p) : []),
  copy: (a, b) => copyFileSync(a, b),
};
