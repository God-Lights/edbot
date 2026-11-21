import EdbotKit
import SwiftUI

/// 랭킹 화면: 내 순위와 전적, 최근 판, 상위 20명. 로그인하지 않았으면 순위만 보인다.
struct RankingView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            AppBackground()
            VStack(spacing: 14) {
                HStack {
                    Text("랭킹").font(.title.bold())
                    Spacer()
                    if model.isLoadingRanking { ProgressView() }
                    Button { model.refreshRanking() } label: { Label("새로고침", systemImage: "arrow.clockwise") }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(model.isLoadingRanking)
                    Button("닫기") { model.showRanking = false }.buttonStyle(SecondaryButtonStyle())
                }

                if let error = model.rankingError {
                    Text(error).foregroundStyle(Theme.warn).frame(maxWidth: .infinity, alignment: .leading)
                }

                HStack(alignment: .top, spacing: 16) {
                    ScrollView { mine }.frame(maxWidth: 420)
                    ScrollView { board }.frame(maxWidth: .infinity)
                }
            }
            .padding(24)
        }
        .preferredColorScheme(.dark)
    }

    // MARK: 내 전적

    @ViewBuilder private var mine: some View {
        VStack(spacing: 14) {
            if model.user == nil {
                VStack(alignment: .leading, spacing: 6) {
                    Text("내 전적").font(.headline)
                    Text("로그인하면 내 순위와 전적이 기록돼요. 두 사람 모두 로그인한 판만 기록되고, 테스트 대전은 기록되지 않아요.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .panel()
            } else if let stats = model.myStats {
                statsCard(stats)
                recentMatches
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text(model.user?.nickname ?? "").font(.headline)
                    Text(model.isLoadingRanking ? "불러오는 중..." : "아직 한 판도 하지 않았어요. 한 판 하면 여기에 순위가 생겨요.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .panel()
            }
        }
    }

    private func statsCard(_ stats: PlayerStats) -> some View {
        VStack(spacing: 10) {
            Text(stats.nickname).font(.headline).foregroundStyle(Theme.silver)
            HStack(spacing: 28) {
                bigStat("순위", "\(stats.rank)위", Theme.accent)
                bigStat("레이팅", "\(stats.rating)", Theme.silver)
            }
            Text("\(stats.games)판  \(stats.wins)승 \(stats.losses)패 \(stats.draws)무  ·  승률 \(Int((stats.winRate * 100).rounded()))%")
                .font(.callout).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .panel()
    }

    private func bigStat(_ title: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.system(size: 40, weight: .heavy, design: .rounded).monospacedDigit()).foregroundStyle(color)
        }
    }

    @ViewBuilder private var recentMatches: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("최근 판").font(.headline)
            if model.myMatches.isEmpty {
                Text("기록이 없어요.").font(.callout).foregroundStyle(.secondary)
            }
            ForEach(model.myMatches) { match in
                matchRow(match)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }

    private func matchRow(_ match: MatchSummary) -> some View {
        let color: Color = match.result == "win" ? Theme.good : (match.result == "loss" ? Theme.theirs : Theme.silver)
        return HStack(spacing: 10) {
            Text(Labels.matchResult(match.result))
                .font(.title3.bold()).foregroundStyle(color)
                .frame(width: 36, height: 36)
                .background(Circle().fill(color.opacity(0.2)))
            VStack(alignment: .leading, spacing: 2) {
                Text("vs \(match.opponent)").font(.subheadline.bold())
                Text("\(Labels.matchDate(match.endedAt)) · \(match.score[safe: 0] ?? 0):\(match.score[safe: 1] ?? 0) · \(Labels.resultReason(match.reason))")
                    .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                HStack(spacing: 2) {
                    ForEach(match.picks, id: \.self) { id in
                        if let piece = (model.character(id)?.piece ?? model.chessUnit(id)?.piece) { Text(Labels.pieceGlyph(piece)).font(.caption).foregroundStyle(Theme.mine) }
                    }
                    Text("vs").font(.system(size: 9)).foregroundStyle(.secondary)
                    ForEach(match.opponentPicks, id: \.self) { id in
                        if let piece = (model.character(id)?.piece ?? model.chessUnit(id)?.piece) { Text(Labels.pieceGlyph(piece)).font(.caption).foregroundStyle(Theme.theirs) }
                    }
                }
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 0) {
                Text(Labels.delta(match.ratingDelta)).font(.subheadline.bold().monospacedDigit())
                    .foregroundStyle(match.ratingDelta >= 0 ? Theme.good : Theme.theirs)
                Text("\(match.ratingAfter)").font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
    }

    // MARK: 순위표

    @ViewBuilder private var board: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("상위 20명").font(.headline)
            if model.leaderboard.isEmpty {
                Text(model.isLoadingRanking ? "불러오는 중..." : "아직 기록이 없어요. 첫 번째가 되어 보세요!")
                    .font(.callout).foregroundStyle(.secondary).padding(.vertical, 12)
            }
            ForEach(model.leaderboard) { entry in
                row(entry)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }

    private func row(_ entry: LeaderboardEntry) -> some View {
        HStack(spacing: 12) {
            Text(medal(entry.rank)).font(.title3).frame(width: 40)
            Text(entry.nickname + (entry.isMe ? " (나)" : "")).font(.subheadline.bold()).lineLimit(1)
            Spacer()
            Text("\(entry.wins)승 \(entry.losses)패").font(.caption).foregroundStyle(.secondary)
            Text("\(entry.rating)").font(.headline.monospacedDigit()).frame(width: 64, alignment: .trailing)
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(entry.isMe ? Theme.accent.opacity(0.25) : Theme.panel))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(entry.isMe ? Theme.accent : Color.clear, lineWidth: 2))
    }

    private func medal(_ rank: Int) -> String {
        switch rank {
        case 1: return "🥇"
        case 2: return "🥈"
        case 3: return "🥉"
        default: return "\(rank)"
        }
    }
}
