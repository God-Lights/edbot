// `bun --preload`로 불러서 `cloudflare:workers`를 우리 대체 모듈로 바꾼다. (개발 실행용. 빌드는 build.ts가 같은 일을 한다.)
import { plugin } from "bun";
import * as shim from "./workers-shim";

plugin({
  name: "cloudflare-workers-shim",
  setup(build) {
    build.module("cloudflare:workers", () => ({ exports: { ...shim }, loader: "object" }));
  },
});
