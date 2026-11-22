// 바닐라 실행파일용: 플러그인 읽기가 없다. (build.ts가 src/plugins.ts 대신 이 파일을 넣는다)
export function loadPlugins(_dataDir: string): never {
  throw new Error("바닐라 서버는 플러그인을 읽지 않는다.");
}
