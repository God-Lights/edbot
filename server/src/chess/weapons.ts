// 자원 시스템: 재료 13종과 무기 13종. 설계: docs/DESIGN-autochess.md 9장.
// 확률 효과(출혈, 회피 등)는 난수가 아니라 "쌓였다가 터지는" 방식이라서 전투가 언제나 같은 결과를 낸다.

export type Rarity = "common" | "uncommon" | "rare" | "legendary";

export interface MaterialDef {
  id: string;
  nameKo: string;
  rarity: Rarity;
  /** 재련하면 나오는 무기 */
  weaponId: string;
}

export interface WeaponDef {
  id: string;
  nameKo: string;
  materialId: string;
  rarity: Rarity;
  text: string;
}

const M = (id: string, nameKo: string, rarity: Rarity, weaponId: string): MaterialDef => ({ id, nameKo, rarity, weaponId });
const W = (id: string, nameKo: string, materialId: string, rarity: Rarity, text: string): WeaponDef => ({ id, nameKo, materialId, rarity, text });

export const MATERIALS: readonly MaterialDef[] = [
  M("clawstone", "클로우스톤", "common", "clawstone-axe"),
  M("edmium", "에드뮴", "common", "edmium-blade"),
  M("bit", "비트", "common", "bit-dagger"),
  M("edcoin", "에드코인", "common", "edcoin-sling"),
  M("titanium", "타이타늄 금속", "uncommon", "titanium-shield"),
  M("redocean", "레드오션", "uncommon", "redocean-trident"),
  M("edgem", "에드잼", "uncommon", "edgem-orb"),
  M("ancient-shard", "고대의 파편", "uncommon", "ancient-staff"),
  M("ankio-wing", "안키오의 날개", "rare", "ankio-twinblades"),
  M("dark-essence", "어둠의 정수", "rare", "dark-scythe"),
  M("chaos-crystal", "혼돈의 결정체", "rare", "chaos-staff"),
  M("bitcoin", "비트코인", "legendary", "bitcoin-greatsword"),
  M("digital-miner", "디지털 채굴기", "legendary", "digital-miner-pouch"),
];

export const WEAPONS: readonly WeaponDef[] = [
  W("clawstone-axe", "클로우스톤 도끼", "clawstone", "common", "공격 +15%, 공격할 때 5번에 1번 3초 출혈"),
  W("edmium-blade", "에드뮴 블레이드", "edmium", "common", "공격 속도 +25% (4번에 한 번 추가 공격)"),
  W("bit-dagger", "비트 대거", "bit", "common", "에너지 충전 +35%"),
  W("edcoin-sling", "에드코인 슬링", "edcoin", "common", "공격 +10%, 처치할 때마다 골드 +1 (라운드당 최대 3)"),
  W("titanium-shield", "타이타늄 방패", "titanium", "uncommon", "체력 +15%, 받는 피해 -10%"),
  W("redocean-trident", "레드오션 삼지창", "redocean", "uncommon", "공격이 인접한 적 1명에게 40% 번짐"),
  W("edgem-orb", "에드잼 보주", "edgem", "uncommon", "능력 효과 +40%"),
  W("ancient-staff", "고대의 파편 지팡이", "ancient-shard", "uncommon", "전투 시작 시 최대 체력의 25% 보호막 (5초)"),
  W("ankio-twinblades", "안키오의 날개 쌍검", "ankio-wing", "rare", "회피 25%, 공격 속도 +15%"),
  W("dark-scythe", "어둠의 낫", "dark-essence", "rare", "준 피해의 35% 흡혈"),
  W("chaos-staff", "혼돈의 지팡이", "chaos-crystal", "rare", "공격 3번에 한 번 약화 (기절 1초 / 속박 3초 / 방어 감소 3초 번갈아)"),
  W("bitcoin-greatsword", "비트코인 대검", "bitcoin", "legendary", "공격 +40%, 살아남으면 라운드 종료 골드 +2"),
  W("digital-miner-pouch", "디지털 채굴기 포대", "digital-miner", "legendary", "공격 +20%, 매 라운드 시작 때 비트 1개 생성"),
];

export const materialDef = (id: string): MaterialDef | undefined => MATERIALS.find((m) => m.id === id);
export const weaponDef = (id: string): WeaponDef | undefined => WEAPONS.find((w) => w.id === id);

/** 광물 시장 가격. 전설은 팔지 않는다. */
export const MARKET_PRICE: Record<Rarity, number | null> = { common: 3, uncommon: 5, rare: 8, legendary: null };

/** 무기가 주는 공격력 배율 */
export const WEAPON_ATK: Record<string, number> = {
  "clawstone-axe": 1.15, "edcoin-sling": 1.1, "bitcoin-greatsword": 1.4, "digital-miner-pouch": 1.2,
};
