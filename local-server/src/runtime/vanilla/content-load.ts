// 바닐라 실행파일용: 콘텐츠 팩을 읽지 않는다. (build.ts가 server/src/content-load.ts 대신 이 파일을 넣는다)
export function useExternalContent(): void {}
export function ensureContent(_env: { EDITION?: string }): void {}
