// 로컬 서버(엑스퍼트)의 플러그인 읽기: plugins/ 폴더의 콘텐츠 팩(JSON)을 읽어서 적용한다. 형식: docs/PLUGINS.md
// 바닐라 실행파일에는 이 파일이 들어가지 않는다. (build.ts, main.ts 의 에디션 분기)

import { joinPath as join } from "./runtime/fs";
import type { Fs } from "./runtime/fs";
import { nodeFs } from "./runtime/node-fs";
import { setActiveContent } from "../../server/src/chess/content";
import { buildContent } from "../../server/src/chess/content-build";
import { useExternalContent } from "../../server/src/content-load";
import samplePack from "../../server/packs/example-pack.json" with { type: "json" };

/** 바닐라 빌드에 이 코드가 들어갔는지 확인하려는 표시(CI가 실행파일에서 찾는다) */
export const PLUGIN_LOADER_MARKER = "__COMMANDER_PLUGIN_LOADER__";

const README = `COMMANDER 엑스퍼트 서버: 플러그인(콘텐츠 팩) 폴더
================================================

이 폴더의 *.json 파일, 폴더 안의 pack.json, *.zip(안에 pack.json) 을 서버를 켤 때 읽습니다.
팩 종류: 플러그인(캐릭터·재료·무기·규칙), 리소스(색·로고·배경·캐릭터 그림·효과음·음악), 종합(둘 다).
그림·소리가 있는 팩은 .zip 하나로 넣으면 됩니다. (코드는 못 넣습니다)

- 예시: example-pack.json.sample 을 example-pack.json 으로 이름을 바꾸고 서버를 다시 켜 보세요.
- 틀린 곳은 서버를 켤 때 화면에 어디가 왜 틀렸는지 나옵니다. 틀린 팩은 쓰지 않고 나머지는 적용합니다.
- 팩을 바꾼 뒤에는 서버를 껐다 켜야 하고, 진행 중이던 판은 이어 가지 않습니다. (리소스 팩만 바꿨으면 판은 이어 갑니다)
- 끄고 싶은 팩은 이름 끝에 .off 를 붙이세요 (예: my-pack.json.off, my-pack.off/).
- 형식 설명: docs/PLUGINS.md
`;

export interface LoadedPlugins {
  /** dir: 팩 폴더(데이터 폴더 기준). 그림·소리를 /packs/<id>/ 로 내줄 때 쓴다. 파일 하나짜리 팩은 없음 */
  accepted: Array<{ id: string; name: string; version: string; kind: string; dir?: string }>;
  rejected: Array<{ id: string; errors: string[] }>;
  /** 읽기 단계의 안내(JSON을 못 읽은 파일 등) */
  notes: string[];
  ruleset: string;
  /** 읽기 코드가 들어 있다는 표시 (바닐라 빌드에는 없다) */
  loader: string;
}

/** plugins/ 폴더를 만들고(처음이면 안내문과 예시를 넣고) 팩을 읽어 적용한다. */
export function loadPlugins(dataDir: string, fs: Fs = nodeFs): LoadedPlugins {
  useExternalContent(); // 배포에 담긴 팩(개발 서버용)은 읽지 않는다
  const dir = join(dataDir, "plugins");
  if (!fs.exists(dir)) {
    fs.mkdir(dir);
    fs.write(join(dir, "README.txt"), README);
    fs.write(join(dir, "example-pack.json.sample"), JSON.stringify(samplePack, null, 2));
  }
  const raws: unknown[] = [];
  const notes: string[] = [];
  const dirs = new Map<string, string>();
  for (const name of fs.readdir(dir).sort()) {
    // 숨김, 꺼 둔 것(.off), 예시(.sample), zip 자체(서버가 폴더로 풀어 둔다)는 건너뛴다
    if (name.startsWith(".") || name.endsWith(".off") || name.endsWith(".sample") || name.toLowerCase().endsWith(".zip")) continue;
    const path = join(dir, name);
    // 폴더 안의 pack.json, 또는 *.json 파일
    const isFile = name.endsWith(".json");
    const file = isFile ? path : fs.exists(join(path, "pack.json")) ? join(path, "pack.json") : null;
    if (!file || !fs.exists(file)) continue;
    try {
      const raw: unknown = JSON.parse(fs.read(file));
      raws.push(raw);
      const id = typeof raw === "object" && raw !== null && typeof (raw as { id?: unknown }).id === "string" ? (raw as { id: string }).id : "";
      if (!isFile && id && !dirs.has(id)) dirs.set(id, path);
    } catch (error) {
      notes.push(`${name}: JSON을 읽지 못했다 (${error instanceof Error ? error.message : error})`);
    }
  }
  const result = buildContent(raws);
  setActiveContent(result.content);
  const accepted = result.accepted.map(({ id, name, version, kind }) => ({ id, name, version, kind, ...(dirs.has(id) ? { dir: dirs.get(id)! } : {}) }));
  return { accepted, rejected: result.rejected, notes, ruleset: result.content?.ruleset ?? "official", loader: PLUGIN_LOADER_MARKER };
}
