// 단일 실행파일을 만든다. 웹 화면(../web)과 DB 마이그레이션을 실행파일 안에 넣는다.
//
//   bun build.ts                               (지금 컴퓨터용)
//   bun build.ts --target bun-windows-x64      (윈도우용 .exe. 다른 OS에서도 만들 수 있다)
//   bun build.ts --edition expert              (엑스퍼트 서버: 이름만 구분한다. 플러그인은 다음 단계)
//
// target: bun-windows-x64, bun-linux-x64, bun-darwin-arm64, bun-darwin-x64 ...

import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};

const target = arg("target", "");
const edition = arg("edition", "vanilla");
const root = import.meta.dir;
const webDir = join(root, "..", "web");
const migrationsDir = join(root, "..", "server", "migrations");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// 웹 파일과 마이그레이션을 실행파일에 담는 목록 파일을 만든다.
const generatedDir = join(root, "src", "generated");
mkdirSync(generatedDir, { recursive: true });
const webFiles = walk(webDir).filter((f) => !f.endsWith("README.md")).sort();
const sqlFiles = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
const rel = (from: string, to: string) => relative(from, to).split(sep).join("/");
let source = "// build.ts가 만든다. 직접 고치지 않는다.\n";
webFiles.forEach((file, i) => (source += `import w${i} from "${rel(generatedDir, file)}" with { type: "file" };\n`));
sqlFiles.forEach((file, i) => (source += `import m${i} from "${rel(generatedDir, join(migrationsDir, file))}" with { type: "text" };\n`));
source += "export const web: Record<string, string> = {\n";
webFiles.forEach((file, i) => (source += `  ${JSON.stringify("/" + rel(webDir, file))}: w${i},\n`));
source += "};\nexport const migrations = [\n";
sqlFiles.forEach((file, i) => (source += `  { name: ${JSON.stringify(file)}, sql: m${i} },\n`));
source += "];\n";
writeFileSync(join(generatedDir, "embedded.ts"), source);

const name = target.includes("windows") ? "commander-server.exe" : target ? `commander-server-${target.replace("bun-", "")}` : "commander-server";
const outfile = join(root, "dist", edition === "vanilla" ? name : name.replace("commander-server", "commander-server-expert"));
mkdirSync(join(root, "dist"), { recursive: true });

const result = await Bun.build({
  entrypoints: [join(root, "src", "main.ts")],
  compile: target ? { target: target as never, outfile } : { outfile },
  minify: true,
  define: { "process.env.COMMANDER_EDITION": JSON.stringify(edition) },
  plugins: [
    {
      name: "cloudflare-workers-shim",
      setup(build) {
        build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: join(root, "src", "runtime", "workers-shim.ts") }));
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`만들었다: ${outfile}  (${edition}${target ? `, ${target}` : ""})`);
