// 콘텐츠(캐릭터, 재료·무기, 규칙 값)를 한 곳에 모은 "현재 적용된 콘텐츠".
//
// 공식 콘텐츠는 roster.ts, weapons.ts, crafting.ts, game.ts 의 상수에 있다. 서버가 콘텐츠 팩(플러그인)을 읽으면
// content-build.ts 가 공식 콘텐츠 위에 팩을 얹은 Content 를 만들고, setActiveContent 로 서버 전체에 적용한다.
// 엔진은 roster(), materials(), weapons(), fusions(), rules() 같은 접근 함수로 읽어서, 팩이 없으면 공식 그대로다.
//
// 이 파일은 다른 chess 모듈을 값으로 불러오지 않는다. (순환을 피하려고 타입만 불러온다)

import type { MaterialFusion } from "./crafting";
import type { UnitDef } from "./types";
import type { MaterialDef, WeaponDef } from "./weapons";

/** 규칙 값. 공식 값은 game.ts의 상수와 같다. 팩의 `rules`가 일부를 바꿀 수 있다. */
export interface Rules {
  startHp: number;
  startGold: number;
  baseIncome: number;
  maxInterest: number;
  maxRounds: number;
  /** 판에 올릴 수 있는 기물 수의 최대 */
  maxDeploy: number;
  rerollCost: number;
  prepSeconds: number;
  firstPrepSeconds: number;
  /** 가격별 공용 풀의 복사본 수 */
  poolCopies: Record<1 | 2 | 3 | 4, number>;
}

export const OFFICIAL_RULES: Readonly<Rules> = Object.freeze({
  startHp: 30,
  startGold: 5,
  baseIncome: 5,
  maxInterest: 3,
  maxRounds: 8,
  maxDeploy: 7,
  rerollCost: 2,
  prepSeconds: 25,
  firstPrepSeconds: 40,
  poolCopies: Object.freeze({ 1: 9, 2: 8, 3: 6, 4: 5 }) as Record<1 | 2 | 3 | 4, number>,
});

/** 팩이 만든 무기가 주는 능력치 배율. (확률 효과는 코드라서 팩이 만들 수 없다. 숫자만) */
export interface WeaponStats {
  /** 공격력 배율 */
  atk?: number;
  /** 최대 체력 배율 */
  hp?: number;
  /** 받는 피해 배율(낮을수록 단단하다) */
  dmgTaken?: number;
  /** 에너지 충전 배율 */
  energy?: number;
}

export interface PackInfo {
  id: string;
  name: string;
  version: string;
}

export interface Content {
  /** 규칙 묶음의 이름: 팩이 없으면 "official", 있으면 내용의 해시 */
  ruleset: string;
  packs: readonly PackInfo[];
  units: readonly UnitDef[];
  unitMap: ReadonlyMap<string, UnitDef>;
  /** 입문 모드의 상점에 나오는 캐릭터 id */
  liteIds: readonly string[];
  materials: readonly MaterialDef[];
  weapons: readonly WeaponDef[];
  weaponStats: Readonly<Record<string, WeaponStats>>;
  fusions: readonly MaterialFusion[];
  rules: Readonly<Rules>;
}

let active: Content | null = null;

/** 지금 적용된 콘텐츠. 팩을 안 읽었으면 null(= 공식) */
export const activeContent = (): Content | null => active;

export function setActiveContent(content: Content | null): void {
  active = content;
}

/** 지금 적용된 규칙 값 */
export const rules = (): Readonly<Rules> => active?.rules ?? OFFICIAL_RULES;

/** 규칙 묶음 이름. 방이 시작될 때 기록해서, 서버의 팩이 바뀐 뒤에 옛 방이 이어지지 않게 한다. */
export const currentRuleset = (): string => active?.ruleset ?? "official";
