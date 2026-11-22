// Worker(운영·개발 서버)가 콘텐츠 팩을 적용하는 곳. EDITION 이 "expert" 일 때만 배포에 담긴 팩(packs/)을 읽는다.
// 바닐라(운영)는 팩을 전혀 읽지 않아서 공식 규칙 그대로다.
// 로컬 서버는 자기가 plugins/ 폴더에서 읽어 적용하므로 useExternalContent() 로 이 로딩을 끈다.

import { setActiveContent } from "./chess/content";
import { buildContent } from "./chess/content-build";
import { BUNDLED_PACKS } from "../packs";

let done = false;
let external = false;

/** 서버 밖(로컬 서버의 plugins/)에서 팩을 적용하는 경우: 배포에 담긴 팩을 읽지 않는다. */
export function useExternalContent(): void {
  external = true;
}

/** 서버 환경에 맞게 팩을 한 번만 적용한다. (isolate마다 한 번. 요청과 방 객체가 시작할 때 부른다) */
export function ensureContent(env: { EDITION?: string }): void {
  if (done || external) return;
  done = true;
  if (env.EDITION !== "expert") return;
  const result = buildContent(BUNDLED_PACKS);
  for (const r of result.rejected) console.error("콘텐츠 팩을 쓰지 않는다:", r.errors.join(" / "));
  setActiveContent(result.content);
}
