// 로컬 서버(엑스퍼트)의 팩 파일: plugins/ 의 .zip 을 풀어 두고, 팩의 그림·소리를 /packs/<팩id>/<경로> 로 내준다.
// 바닐라 실행파일에는 들어가지 않는다. (main.ts 의 엑스퍼트 분기에서만 불러온다)
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { packRoot, readZip } from "./zip";

const MARK = ".from-zip";

/**
 * plugins/이름.zip 을 plugins/이름/ 으로 푼다 (zip 이 바뀌었을 때만). 같은 이름의 손으로 만든 폴더가 있으면 이름-zip/ 으로.
 * 돌려주는 것: 안내 글 (못 푼 zip 등)
 */
export function extractZipPacks(pluginsDir: string): string[] {
  const notes: string[] = [];
  if (!existsSync(pluginsDir)) return notes;
  for (const name of readdirSync(pluginsDir).sort()) {
    if (!name.toLowerCase().endsWith(".zip")) continue;
    const zipPath = join(pluginsDir, name);
    const stem = name.slice(0, -4);
    const stat = statSync(zipPath);
    const stamp = `${stat.size}:${Math.round(stat.mtimeMs)}`;
    let target = join(pluginsDir, stem);
    if (existsSync(target) && !existsSync(join(target, MARK))) target = join(pluginsDir, `${stem}-zip`);
    if (existsSync(join(target, MARK)) && readFileSync(join(target, MARK), "utf8") === stamp) continue; // 이미 풀었다
    try {
      const files = packRoot(readZip(new Uint8Array(readFileSync(zipPath))));
      if (!files) { notes.push(`${name}: 안에 pack.json 이 없다`); continue; }
      rmSync(target, { recursive: true, force: true });
      for (const [path, body] of files) {
        const out = join(target, ...path.split("/"));
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, body);
      }
      writeFileSync(join(target, MARK), stamp);
    } catch (error) {
      notes.push(`${name}: zip 을 풀지 못했다 (${error instanceof Error ? error.message : error})`);
    }
  }
  return notes;
}

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/mp4", wav: "audio/wav",
};

/**
 * /packs/<팩id>/<경로> 요청이면 그 팩 폴더의 파일을 돌려준다. 다른 경로면 null.
 * dirs: 팩 id -> 폴더(절대 경로). 그림·소리 파일만 내준다(문서·스크립트는 내주지 않는다).
 */
export function packAsset(pathname: string, dirs: ReadonlyMap<string, string>): Response | null {
  if (!pathname.startsWith("/packs/")) return null;
  const rest = decodeURIComponent(pathname.slice("/packs/".length));
  const slash = rest.indexOf("/");
  const notFound = () => new Response("없다", { status: 404 });
  if (slash < 0) return notFound();
  const dir = dirs.get(rest.slice(0, slash));
  const sub = rest.slice(slash + 1);
  const mime = MIME[sub.split(".").pop()?.toLowerCase() ?? ""];
  if (!dir || !mime || sub.includes("..")) return notFound();
  const file = normalize(join(dir, ...sub.split("/")));
  if (!file.startsWith(normalize(dir) + sep) || !existsSync(file) || !statSync(file).isFile()) return notFound();
  return new Response(Bun.file(file), { headers: { "content-type": mime, "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } });
}
