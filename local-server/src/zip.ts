// 작은 zip 읽기 (팩 .zip 용): 저장(0)·deflate(8)만, zip64 없음. 로컬 서버(Bun)에서만 쓴다.
import { inflateRawSync } from "node:zlib";

export const MAX_ZIP_ENTRIES = 600;
export const MAX_ZIP_BYTES = 40 * 1024 * 1024;

/** zip 안의 파일들 {경로: 내용}. 폴더 항목은 뺀다. 틀린 zip·위험한 경로·너무 큰 것은 오류. */
export function readZip(data: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // 끝에서 중앙 디렉터리 끝(EOCD) 표지를 찾는다 (뒤에 주석이 있을 수 있다)
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip 파일이 아니다");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (count > MAX_ZIP_ENTRIES) throw new Error(`파일이 너무 많다 (${MAX_ZIP_ENTRIES}개까지)`);
  const files = new Map<string, Uint8Array>();
  let total = 0;
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("zip 목록이 깨졌다");
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(data.subarray(offset + 46, offset + 46 + nameLen)).replace(/\\/g, "/");
    offset += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (name.startsWith("/") || name.split("/").some((p) => p === ".." || p === "")) throw new Error(`위험한 경로: ${name}`);
    if (name.startsWith("__MACOSX/") || name.split("/").pop()!.startsWith(".")) continue; // 맥이 넣는 숨김 파일
    total += size;
    if (total > MAX_ZIP_BYTES) throw new Error(`풀면 너무 크다 (${MAX_ZIP_BYTES / 1024 / 1024}MB 까지)`);
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error("zip 파일 머리가 깨졌다");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = data.subarray(start, start + compressed);
    let body: Uint8Array;
    if (method === 0) body = raw.slice();
    else if (method === 8) body = new Uint8Array(inflateRawSync(raw));
    else throw new Error(`지원하지 않는 압축 방식(${method}): ${name}`);
    if (body.length !== size) throw new Error(`크기가 맞지 않다: ${name}`);
    files.set(name, body);
  }
  return files;
}

/**
 * zip 안의 pack.json 위치를 찾아 그 폴더 기준으로 경로를 다시 붙인다.
 * (zip 을 만들 때 폴더째 넣어 "my-pack/pack.json" 이 되는 경우가 많다)
 */
export function packRoot(files: Map<string, Uint8Array>): Map<string, Uint8Array> | null {
  const manifest = [...files.keys()].filter((k) => k.endsWith("pack.json") && (k === "pack.json" || k.endsWith("/pack.json"))).sort((a, b) => a.length - b.length)[0];
  if (!manifest) return null;
  const prefix = manifest.slice(0, -"pack.json".length);
  const out = new Map<string, Uint8Array>();
  for (const [k, v] of files) if (k.startsWith(prefix)) out.set(k.slice(prefix.length), v);
  return out;
}
