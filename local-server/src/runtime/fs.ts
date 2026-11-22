// 파일 시스템 추상화. 서버 쪽 저장 코드(objects.ts, json-store.ts)는 이것만 쓴다.
//   - 데스크톱 로컬 서버: nodeFs (진짜 파일)
//   - iOS 서버 앱: 메모리에 두고, 바뀐 것을 앱(Swift)에 넘겨 파일로 쓰게 하는 구현(ios-server/engine)

export interface Fs {
  exists(path: string): boolean;
  /** 폴더를 만든다(이미 있어도 된다, 위쪽 폴더도 함께). */
  mkdir(path: string): void;
  /** 글자(utf8)로 읽는다. 없으면 오류. */
  read(path: string): string;
  write(path: string, text: string): void;
  append(path: string, text: string): void;
  rename(from: string, to: string): void;
  /** 파일이나 폴더(안의 것까지)를 지운다. 없어도 된다. */
  rm(path: string): void;
  /** 폴더 안의 이름들(파일·폴더). 폴더가 없으면 빈 목록. */
  readdir(path: string): string[];
  copy(from: string, to: string): void;
}

/** 경로를 잇고 `..` 와 `.` 를 정리한다. (구분자는 `/`, 윈도우에서도 node가 받아 준다) */
export function joinPath(...parts: string[]): string {
  const absolute = parts[0]?.startsWith("/") ?? false;
  const out: string[] = [];
  for (const segment of parts.join("/").split(/[\\/]+/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(segment);
  }
  const joined = out.join("/");
  return absolute ? `/${joined}` : (/^[A-Za-z]:$/.test(out[0] ?? "") ? joined.replace(/^([A-Za-z]:)(?!\/)/, "$1/") : joined) || ".";
}

/** 쓰는 도중에 꺼져도 깨진 파일이 남지 않게: 임시 파일에 쓰고 이름을 바꾼다. */
export function writeAtomic(fs: Fs, path: string, text: string): void {
  const tmp = `${path}.tmp`;
  fs.write(tmp, text);
  fs.rename(tmp, path);
}
