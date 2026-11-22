// iOS 서버 앱의 엔진을 한 파일(웹뷰에서 실행)로 묶는다:  bun build.ts  ->  dist/engine.js
import { join } from "node:path";

const root = import.meta.dir;
const result = await Bun.build({
  entrypoints: [join(root, "src", "engine.ts")],
  target: "browser",
  format: "iife",
  minify: true,
  outdir: join(root, "dist"),
  naming: "engine.js",
  define: { "process.env.COMMANDER_EDITION": JSON.stringify("expert") },
  plugins: [
    {
      name: "cloudflare-workers-shim",
      setup(build) {
        build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: join(root, "..", "..", "local-server", "src", "runtime", "workers-shim.ts") }));
      },
    },
  ],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const out = result.outputs[0]!;
console.log(`만들었다: dist/engine.js (${Math.round(out.size / 1024)} KB)`);
