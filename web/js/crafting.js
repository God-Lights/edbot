// 조합 규칙의 클라이언트 쪽 복사본 (미리보기와 이름 표시용). 규칙의 기준은 서버(server/src/chess/crafting.ts)다.

export const STAR_POWER = 1.5;
export const HYBRID_POWER = 0.75;
const RARITY_ORDER = ["common", "uncommon", "rare", "legendary"];

/** 무기 이름표 해석: "a"(기본), "a*"(★2), "a+b"(융합). 올바르지 않으면 null. */
export function parseWeaponId(id, weapons) {
  const has = (x) => weapons.some((w) => w.id === x);
  if (id.endsWith("*")) return has(id.slice(0, -1)) ? { kind: "star", parts: [id.slice(0, -1)], power: STAR_POWER } : null;
  if (id.includes("+")) {
    const pieces = id.split("+");
    const [a, b] = pieces;
    return pieces.length === 2 && a && b && a < b && has(a) && has(b) ? { kind: "hybrid", parts: [a, b], power: HYBRID_POWER } : null;
  }
  return has(id) ? { kind: "single", parts: [id], power: 1 } : null;
}

/** 화면에 보여 줄 무기 정보 (기본 무기는 서버 도감 그대로, ★2·융합은 이름과 설명을 만들어 낸다) */
export function weaponView(id, catalog) {
  const weapons = catalog?.weapons;
  if (!weapons) return null;
  const parsed = parseWeaponId(id, weapons);
  if (!parsed) return null;
  const parts = parsed.parts.map((p) => weapons.find((w) => w.id === p));
  if (parsed.kind === "single") return { ...parts[0], id };
  if (parsed.kind === "star") {
    return { id, nameKo: `${parts[0].nameKo} ★2`, rarity: parts[0].rarity, materialId: parts[0].materialId, text: `${parts[0].text} · 효과 ${STAR_POWER}배` };
  }
  const rarity = parts.map((p) => p.rarity).sort((x, y) => RARITY_ORDER.indexOf(y) - RARITY_ORDER.indexOf(x))[0];
  return {
    id, nameKo: `${parts[0].nameKo} + ${parts[1].nameKo}`, rarity, materialId: null,
    text: `${parts[0].nameKo}: ${parts[0].text} / ${parts[1].nameKo}: ${parts[1].text} (각각 ${Math.round(HYBRID_POWER * 100)}%)`,
  };
}

/** 두 아이템을 합친 결과 { kind, id }. 합칠 수 없으면 null. (순서 무관) */
export function combineItems(a, b, catalog) {
  if (!catalog) return null;
  if (a.kind === "material" && b.kind === "material") {
    if (a.id === b.id) return null;
    const [x, y] = [a.id, b.id].sort();
    const found = catalog.fusions?.find((f) => f.a === x && f.b === y);
    return found ? { kind: "material", id: found.result } : null;
  }
  if (a.kind === "weapon" && b.kind === "weapon") {
    const pa = parseWeaponId(a.id, catalog.weapons);
    const pb = parseWeaponId(b.id, catalog.weapons);
    if (!pa || !pb || pa.kind !== "single" || pb.kind !== "single") return null;
    return { kind: "weapon", id: a.id === b.id ? `${a.id}*` : [a.id, b.id].sort().join("+") };
  }
  const weapon = a.kind === "weapon" ? a : b;
  const material = a.kind === "material" ? a : b;
  const parsed = parseWeaponId(weapon.id, catalog.weapons);
  if (!parsed || parsed.kind !== "single") return null;
  return catalog.weapons.find((w) => w.id === weapon.id)?.materialId === material.id ? { kind: "weapon", id: `${weapon.id}*` } : null;
}

/** 아이템 이름 */
export function itemName(item, catalog) {
  if (item.kind === "material") return catalog?.materials.find((m) => m.id === item.id)?.nameKo ?? item.id;
  return weaponView(item.id, catalog)?.nameKo ?? item.id;
}
