// 방 코드 만들기. 헷갈리는 글자(0/O, 1/I/L)를 뺀 알파벳으로 4자리(약 80만 가지).

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 4;
/** 테스트 대전 방의 코드. 일반 방과 겹치지 않게 만들어 낸다. */
export const RESERVED_CODES: readonly string[] = ["ADMN", "ADMF", "ADMX"];

export function generateRoomCode(): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    if (!RESERVED_CODES.includes(code)) return code;
  }
}
