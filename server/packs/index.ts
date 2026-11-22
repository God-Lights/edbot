// 개발 서버(AUTH_MODE=hybrid, EDITION=expert)가 배포할 때 같이 담는 콘텐츠 팩 목록.
// 팩을 더하려면 이 폴더에 JSON 을 넣고 아래 목록에 import 를 한 줄 추가한다. (운영(vanilla)은 이 목록을 읽지 않는다)
// 형식: docs/PLUGINS.md

import examplePack from "./example-pack.json";

export const BUNDLED_PACKS: readonly unknown[] = [examplePack];
