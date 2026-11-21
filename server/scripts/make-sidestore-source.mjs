// GitHub 릴리스 목록(JSON)에서 SideStore 소스 파일을 만든다. 서버가 쓰는 코드(src/sidestore.ts)를 그대로 불러 쓴다.
//
//   node --experimental-strip-types scripts/make-sidestore-source.mjs releases.json <소스 주소> > sidestore.json
//
// 릴리스 워크플로(.github/workflows/ios.yml)가 새 릴리스를 올린 뒤 실행해서, 고정 릴리스 sidestore-source 에 올린다.
import { readFileSync } from "node:fs";
import { buildSource } from "../src/sidestore.ts";

const [, , releasesPath, sourceURL] = process.argv;
if (!releasesPath || !sourceURL) {
  console.error("사용법: make-sidestore-source.mjs <releases.json> <소스 주소>");
  process.exit(2);
}
const releases = JSON.parse(readFileSync(releasesPath, "utf8"));
process.stdout.write(JSON.stringify(buildSource(Array.isArray(releases) ? releases : [], sourceURL), null, 2) + "\n");
