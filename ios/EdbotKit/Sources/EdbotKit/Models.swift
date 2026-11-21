import Foundation

// 서버(server/src/protocol.ts)와 주고받는 메시지 형식. 이번 단계는 로비까지 필요한 필드만 두고,
// 뒤 단계(밴·드래프트, 전투, 탐사, 대장간)에서 늘린다. 모르는 필드는 디코더가 무시한다.

/// 한 판이 흐르는 단계. 서버의 Phase와 같은 문자열이다.
public enum Phase: String, Codable, Sendable, Equatable {
    case lobby, ban, draft, placement, explore, forge, battle, deathmatch, result
}

public struct PublicPlayer: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    /// 0 또는 1. 먼저 들어온 사람이 0.
    public let seat: Int
    public let connected: Bool
    public let ready: Bool
}

public struct RoomSnapshot: Codable, Equatable, Sendable {
    public let code: String
    public let phase: Phase
    public let phaseStartedAt: Int64
    /// 단계가 끝나는 서버 시각(ms). 로비처럼 타이머가 없으면 nil.
    public let phaseEndsAt: Int64?
    /// 이 스냅샷을 만든 서버 시각(ms). 시계 차이를 보정하는 데 쓴다.
    public let serverTime: Int64
    public let players: [PublicPlayer]

    public func player(id: String?) -> PublicPlayer? {
        guard let id else { return nil }
        return players.first { $0.id == id }
    }
}

public struct RoomInfo: Codable, Equatable, Sendable {
    public let code: String
    public let phase: String
    public let players: Int
    public let joinable: Bool
}

/// 서버가 보내는 메시지.
public enum ServerMessage: Equatable, Sendable {
    case welcome(playerId: String, token: String, room: RoomSnapshot)
    case state(RoomSnapshot)
    case pong(ts: Int64, serverTime: Int64)
    case error(code: String, message: String)
}

/// 서버 오류 코드. 서버의 ErrorCode와 같은 문자열이다.
public enum ErrorCode {
    public static let roomNotFound = "room_not_found"
    public static let roomFull = "room_full"
    public static let gameInProgress = "game_in_progress"
    public static let notInLobby = "not_in_lobby"
    public static let wrongPhase = "wrong_phase"
    public static let unauthorized = "unauthorized"

    /// 다시 시도해도 소용없는 오류. 이 오류를 받으면 자동 재접속을 멈춘다.
    public static func isFatal(_ code: String) -> Bool {
        [roomNotFound, roomFull, gameInProgress, unauthorized].contains(code)
    }
}
