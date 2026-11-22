import Foundation

// 조합: 재료와 무기를 서로 합쳐 새 재료나 무기를 만든다. 규칙의 기준은 서버(server/src/chess/crafting.ts)이고,
// 여기는 미리보기와 이름 표시를 위한 복사본이다.
//   재료 + 재료(같은 희귀도, 다른 재료) -> 한 단계 위 재료 (서버가 주는 조합표 fusions)
//   같은 무기 둘 -> ★2 무기(효과 1.5배), 다른 무기 둘 -> 융합 무기(각 효과 75%), 무기 + 원재료 -> ★2 무기
// 무기 이름표: "a"(기본), "a*"(★2), "a+b"(융합, 사전순)

/// 재료 조합표의 한 줄: a + b -> result (a < b)
public struct ChessFusion: Codable, Equatable, Sendable {
    public let a: String
    public let b: String
    public let result: String
}

/// 재료나 무기 하나
public struct ChessItem: Equatable, Hashable, Sendable {
    public enum Kind: String, Sendable { case material, weapon }
    public let kind: Kind
    public let id: String

    public init(_ kind: Kind, _ id: String) {
        self.kind = kind
        self.id = id
    }
}

public enum ChessCrafting {
    public static let starPower = 1.5
    public static let hybridPower = 0.75
    private static let rarityOrder = ["common", "uncommon", "rare", "legendary"]

    public enum WeaponKind: Equatable, Sendable { case single, star, hybrid }

    public struct ParsedWeapon: Equatable, Sendable {
        public let kind: WeaponKind
        /// 효과를 내는 기본 무기들 (융합이면 둘)
        public let parts: [String]
        public let power: Double
    }

    /// 무기 이름표 해석. 올바르지 않으면 nil.
    public static func parseWeapon(_ id: String, weapons: [ChessWeaponInfo]) -> ParsedWeapon? {
        let known: (String) -> Bool = { name in weapons.contains { $0.id == name } }
        if id.hasSuffix("*") {
            let base = String(id.dropLast())
            return known(base) ? ParsedWeapon(kind: .star, parts: [base], power: starPower) : nil
        }
        if id.contains("+") {
            let pieces = id.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
            guard pieces.count == 2, !pieces[0].isEmpty, !pieces[1].isEmpty, pieces[0] < pieces[1],
                  known(pieces[0]), known(pieces[1]) else { return nil }
            return ParsedWeapon(kind: .hybrid, parts: pieces, power: hybridPower)
        }
        return known(id) ? ParsedWeapon(kind: .single, parts: [id], power: 1) : nil
    }

    /// 화면에 보여 줄 무기 정보. 기본 무기는 도감 그대로, ★2·융합은 이름과 설명을 만들어 낸다.
    public static func weaponInfo(_ id: String, weapons: [ChessWeaponInfo]) -> ChessWeaponInfo? {
        guard let parsed = parseWeapon(id, weapons: weapons) else { return nil }
        let parts: [ChessWeaponInfo] = parsed.parts.compactMap { part in weapons.first { $0.id == part } }
        guard let first = parts.first else { return nil }
        switch parsed.kind {
        case .single:
            return first
        case .star:
            return ChessWeaponInfo(id: id, nameKo: first.nameKo + " ★2", materialId: first.materialId, rarity: first.rarity,
                                   text: first.text + " · 효과 \(starPower)배")
        case .hybrid:
            guard parts.count == 2 else { return nil }
            let rarity: String = parts.map { $0.rarity }.max { rarityOrder.firstIndex(of: $0) ?? 0 < rarityOrder.firstIndex(of: $1) ?? 0 } ?? first.rarity
            let percent = Int((hybridPower * 100).rounded())
            return ChessWeaponInfo(id: id, nameKo: parts[0].nameKo + " + " + parts[1].nameKo, materialId: "", rarity: rarity,
                                   text: "\(parts[0].nameKo): \(parts[0].text) / \(parts[1].nameKo): \(parts[1].text) (각각 \(percent)%)")
        }
    }

    /// 두 아이템을 합친 결과. 합칠 수 없으면 nil. (순서는 상관없다)
    public static func combine(_ a: ChessItem, _ b: ChessItem, weapons: [ChessWeaponInfo], fusions: [ChessFusion]) -> ChessItem? {
        switch (a.kind, b.kind) {
        case (.material, .material):
            guard a.id != b.id else { return nil }
            let pair = [a.id, b.id].sorted()
            guard let found = fusions.first(where: { $0.a == pair[0] && $0.b == pair[1] }) else { return nil }
            return ChessItem(.material, found.result)
        case (.weapon, .weapon):
            guard let pa = parseWeapon(a.id, weapons: weapons), let pb = parseWeapon(b.id, weapons: weapons),
                  pa.kind == .single, pb.kind == .single else { return nil }
            return ChessItem(.weapon, a.id == b.id ? a.id + "*" : [a.id, b.id].sorted().joined(separator: "+"))
        default:
            let weapon = a.kind == .weapon ? a : b
            let material = a.kind == .material ? a : b
            guard let parsed = parseWeapon(weapon.id, weapons: weapons), parsed.kind == .single,
                  weapons.first(where: { $0.id == weapon.id })?.materialId == material.id else { return nil }
            return ChessItem(.weapon, weapon.id + "*")
        }
    }
}
