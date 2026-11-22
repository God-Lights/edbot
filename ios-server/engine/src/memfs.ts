// 메모리에 두는 Fs. 바뀐 내용은 `onOps`로 앱(Swift)에 넘겨 진짜 파일에 쓰게 한다.
// 엔진은 동기 파일 접근을 가정하므로 시작할 때 파일들을 통째로 받아 메모리에 올린다.

import { joinPath } from "../../../local-server/src/runtime/fs";
import type { Fs } from "../../../local-server/src/runtime/fs";

export type FsOp =
  | { op: "write"; path: string; text: string }
  | { op: "append"; path: string; text: string }
  | { op: "rename"; from: string; to: string }
  | { op: "rm"; path: string }
  | { op: "mkdir"; path: string };

export class MemFs implements Fs {
  private files = new Map<string, string>();
  private dirs = new Set<string>();
  private queue: FsOp[] = [];
  private scheduled = false;

  /** @param onOps 바뀐 것을 순서대로 받는다(여러 개를 모아서). 비어 있으면 저장하지 않는다. */
  constructor(initial: Record<string, string>, private readonly onOps: (ops: FsOp[]) => void = () => {}) {
    for (const [path, text] of Object.entries(initial)) {
      const clean = joinPath(path);
      this.files.set(clean, text);
      this.addParents(clean);
    }
  }

  private addParents(path: string): void {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) this.dirs.add(parts.slice(0, i).join("/"));
  }

  private record(op: FsOp): void {
    this.queue.push(op);
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => this.flush());
  }

  /** 모아 둔 변경을 지금 넘긴다. */
  flush(): void {
    this.scheduled = false;
    if (this.queue.length === 0) return;
    const ops = this.queue;
    this.queue = [];
    this.onOps(ops);
  }

  exists(path: string): boolean {
    const p = joinPath(path);
    return this.files.has(p) || this.dirs.has(p);
  }

  mkdir(path: string): void {
    const p = joinPath(path);
    if (this.dirs.has(p)) return;
    this.dirs.add(p);
    this.addParents(p);
    this.record({ op: "mkdir", path: p });
  }

  read(path: string): string {
    const text = this.files.get(joinPath(path));
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    return text;
  }

  write(path: string, text: string): void {
    const p = joinPath(path);
    this.files.set(p, text);
    this.addParents(p);
    this.record({ op: "write", path: p, text });
  }

  append(path: string, text: string): void {
    const p = joinPath(path);
    this.files.set(p, (this.files.get(p) ?? "") + text);
    this.addParents(p);
    this.record({ op: "append", path: p, text });
  }

  rename(from: string, to: string): void {
    const a = joinPath(from);
    const b = joinPath(to);
    const text = this.files.get(a);
    if (text === undefined) throw new Error(`ENOENT: ${from}`);
    this.files.delete(a);
    this.files.set(b, text);
    this.addParents(b);
    this.record({ op: "rename", from: a, to: b });
  }

  rm(path: string): void {
    const p = joinPath(path);
    const prefix = `${p}/`;
    let found = this.files.delete(p) || this.dirs.delete(p);
    for (const key of [...this.files.keys()]) if (key.startsWith(prefix)) { this.files.delete(key); found = true; }
    for (const key of [...this.dirs]) if (key.startsWith(prefix)) { this.dirs.delete(key); found = true; }
    if (found) this.record({ op: "rm", path: p });
  }

  readdir(path: string): string[] {
    const prefix = `${joinPath(path)}/`;
    const names = new Set<string>();
    for (const key of this.files.keys()) if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0]!);
    for (const key of this.dirs) if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0]!);
    return [...names];
  }

  copy(from: string, to: string): void {
    this.write(to, this.read(from));
  }

  /** 시험용: 지금 파일 전체 */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files);
  }
}
