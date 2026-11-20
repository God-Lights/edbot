import roster from "./data/characters.json";
import type { Lane, Piece } from "./protocol";

export type SpeedTier = "slow" | "normal" | "fast" | "veryFast";
export type RangeTier = "melee" | "mid" | "long";

export interface Character {
  /** 영문 소문자와 '-' 로 된 고정 id. 데이터와 메시지에서 이 값으로 가리킨다. */
  id: string;
  nameKo: string;
  nameEn: string;
  piece: Piece;
  hp: number;
  attack: number;
  speed: SpeedTier;
  range: RangeTier;
}

// 데이터 파일(JSON)은 문자열을 넓은 타입으로 읽기 때문에 한 번 좁혀 준다. 내용은 테스트가 검증한다.
export const CHARACTERS: readonly Character[] = roster as Character[];

export function characterById(id: string): Character | undefined {
  return CHARACTERS.find((c) => c.id === id);
}

/**
 * 배치 시간 안에 정하지 못한 캐릭터가 가는 레인. 기물별 기본값이다.
 * 룩은 킹사이드, 비숍은 센터 (기획서). 나머지는 세 레인이 고르게 차도록 정했다.
 */
export const DEFAULT_LANE_BY_PIECE: Record<Piece, Lane> = {
  king: "center",
  queen: "queenside",
  rook: "kingside",
  bishop: "center",
  knight: "queenside",
  pawn: "kingside",
};

export function defaultLaneFor(characterId: string): Lane {
  const character = characterById(characterId);
  return character ? DEFAULT_LANE_BY_PIECE[character.piece] : "center";
}
