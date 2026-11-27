// 팩 개발 위키(web/packs-wiki.html)가 읽는 "팩을 만들 때 쓸 수 있는 값"과 팩 검사기.
// 값은 서버 코드에서 바로 뽑으므로 위키가 실제 검사 규칙과 어긋나지 않는다.
//   GET  /api/packs/schema    능력·역할·기물·기본 능력치·규칙 범위·색·소리 이름·제한·공식 캐릭터와 재료
//   POST /api/packs/validate  팩 JSON 하나를 서버가 켤 때와 같은 규칙으로 검사한다 (적용하지는 않는다)

import { OFFICIAL_RULES } from "./content";
import type { PackInfo } from "./content";
import {
  COLOR_KEYS, CONTENT_API_VERSION, MAX_GUIDE_SECTIONS, MAX_PACK_UNITS, MAX_TOTAL_MATERIALS, MAX_TOTAL_UNITS, MAX_TOTAL_WEAPONS,
  MAX_UNIT_ART, MUSIC_TRACKS, PASSIVE_ABILITIES, RULE_RANGES, SOUND_NAMES, UNIT_MULT_RANGE, WEAPON_STAT_RANGES, buildContent,
} from "./content-build";
import { ABILITIES } from "./abilities";
import { BASE, PIECE_TUNING, ROLE, ROSTER } from "./roster";
import { MATERIALS, WEAPONS } from "./weapons";

/** 팩 검사기에 보낼 수 있는 JSON 크기 */
export const MAX_VALIDATE_BYTES = 512 * 1024;

export function packSchema() {
  const abilityIds = Object.keys(ABILITIES);
  return {
    apiVersion: CONTENT_API_VERSION,
    limits: {
      unitsPerPack: MAX_PACK_UNITS,
      totalUnits: MAX_TOTAL_UNITS,
      totalMaterials: MAX_TOTAL_MATERIALS,
      totalWeapons: MAX_TOTAL_WEAPONS,
      guideSections: MAX_GUIDE_SECTIONS,
      unitArt: MAX_UNIT_ART,
      zipBytes: 40 * 1024 * 1024,
      zipFiles: 600,
    },
    // 능력: 공식 캐릭터 중 그 능력을 쓰는 예 (설명은 캐릭터의 능력 글)
    abilities: abilityIds.map((id) => {
      const users = ROSTER.filter((u) => u.ability === id);
      return {
        id,
        passive: PASSIVE_ABILITIES.has(id),
        examples: users.map((u) => ({ id: u.id, nameKo: u.nameKo, text: u.abilityText })),
      };
    }),
    roles: Object.entries(ROLE).map(([id, m]) => ({ id, hp: m.hp, atk: m.atk })),
    pieces: Object.entries(PIECE_TUNING).map(([id, m]) => ({ id, hp: m.hp, atk: m.atk })),
    // 기본 능력치: 체력 = base.hp × 역할 × 기물 × hpMult, 공격 = base.atk × 역할 × 2.5 × 기물 × atkMult
    base: Object.entries(BASE).map(([cost, b]) => ({ cost: Number(cost), hp: b.hp, atk: b.atk, energy: b.energy })),
    atkScale: 2.5,
    unitMult: UNIT_MULT_RANGE,
    weaponStats: WEAPON_STAT_RANGES,
    rarities: ["common", "uncommon", "rare", "legendary"],
    rules: [
      ...RULE_RANGES.map(([key, min, max]) => ({ key, min, max, official: OFFICIAL_RULES[key] })),
    ],
    poolCopies: { min: 1, max: 30, official: OFFICIAL_RULES.poolCopies },
    colors: COLOR_KEYS,
    sounds: SOUND_NAMES,
    music: MUSIC_TRACKS,
    imageTypes: ["png", "jpg", "jpeg", "webp", "gif"],
    audioTypes: ["mp3", "ogg", "m4a", "wav"],
    units: ROSTER.map((u) => ({
      id: u.id, nameKo: u.nameKo, piece: u.piece, cost: u.cost, role: u.role, ability: u.ability, faction: u.faction,
      ...(u.evolveOnly ? { evolveOnly: true } : {}),
    })),
    materials: MATERIALS.map((m) => ({ id: m.id, nameKo: m.nameKo, rarity: m.rarity, weapon: m.weaponId, ...(m.special ? { special: true } : {}) })),
    weapons: WEAPONS.map((w) => ({ id: w.id, nameKo: w.nameKo, material: w.materialId, rarity: w.rarity, text: w.text })),
  };
}

export type ValidateResult =
  | { ok: true; pack: PackInfo; ruleset: string; units: number; materials: number; weapons: number }
  | { ok: false; errors: string[] };

/** 팩 하나를 공식 콘텐츠 위에 얹어 본다. 리소스 파일이 실제로 있는지는 여기서 보지 못한다(위키의 zip 검사가 본다). */
export function validatePack(raw: unknown): ValidateResult {
  const result = buildContent([raw]);
  const rejected = result.rejected[0];
  if (rejected || !result.content || !result.accepted[0]) return { ok: false, errors: rejected?.errors ?? ["팩을 읽지 못했다."] };
  return {
    ok: true,
    pack: result.accepted[0],
    ruleset: result.content.ruleset,
    units: result.content.units.length,
    materials: result.content.materials.length,
    weapons: result.content.weapons.length,
  };
}
