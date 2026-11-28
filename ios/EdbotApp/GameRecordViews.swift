import EdbotKit
import SwiftUI

/// 이 판의 기록 (8전 5승제): 결과 단계에서 잡아 두고, 방이 로비로 돌아가도 창을 닫을 때까지 남는다.
struct GameRecord: Equatable {
    let code: String
    let seat: Int
    let names: [String]
    let result: ResultSnapshot
    let rounds: [ChessRoundResult]
    let winTarget: Int?
    let roundWins: [Int]
    /// 마지막 라운드에 낸 기물 (전투 기록에서)
    let lastBoard: [ChessCombatPlacement]
    /// 봇과 한 판 (레이팅 없이 기록)
    let bot: Bool

    var lost: Bool { result.winner != nil && result.winner != seat }
}

/// 8전 5승제: 이름과 라운드 승수 (●●○○○)
struct WinsPill: View {
    let name: String
    let wins: Int
    let target: Int
    let color: Color
    var width: CGFloat = 170

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(name).font(.caption.bold()).lineLimit(1)
                Spacer()
                Text("\(wins)승").font(.caption.monospacedDigit().bold())
            }
            HStack(spacing: 3) {
                ForEach(0..<max(1, target), id: \.self) { i in
                    Capsule()
                        .fill(i < wins ? color : Color.white.opacity(0.12))
                        .shadow(color: i < wins ? color.opacity(0.8) : .clear, radius: 4)
                        .frame(height: 6)
                }
            }
            .accessibilityLabel("\(target)승 중 \(wins)승")
        }
        .frame(width: width)
    }
}

/// 진 사람에게 화면 가득 "Checkmate!" (약 2.8초). 킹이 쓰러지고 글자가 쾅 떨어진다.
struct CheckmateOverlay: View {
    let reason: String
    @State private var slam = false
    @State private var topple = false
    @State private var flash = 0.85
    @State private var shake: CGFloat = 0

    var body: some View {
        ZStack {
            RadialGradient(colors: [Color(red: 0.24, green: 0, blue: 0.04).opacity(0.8), .black.opacity(0.94)], center: .center, startRadius: 10, endRadius: 700)
                .ignoresSafeArea()
            Color(red: 1, green: 0.18, blue: 0.18).opacity(flash).blendMode(.screen).ignoresSafeArea()
            VStack(spacing: 8) {
                Image(Labels.pieceImageName(.king))
                    .resizable().renderingMode(.template).scaledToFit()
                    .foregroundStyle(LinearGradient(colors: [Color(red: 1, green: 0.95, blue: 0.82), Theme.gold], startPoint: .top, endPoint: .bottom))
                    .frame(width: 120, height: 120)
                    .shadow(color: .black.opacity(0.8), radius: 16, y: 6)
                    .rotationEffect(.degrees(topple ? 78 : 0), anchor: .bottom)
                    .offset(x: topple ? 10 : 0)
                Text("Checkmate!")
                    .font(.system(size: 110, weight: .black, design: .serif).italic())
                    .minimumScaleFactor(0.4).lineLimit(1)
                    .foregroundStyle(.white)
                    .shadow(color: Color(red: 1, green: 0.24, blue: 0.24).opacity(0.95), radius: 18)
                    .shadow(color: Color(red: 0.35, green: 0, blue: 0.06), radius: 0, y: 6)
                    .scaleEffect(slam ? 1 : 3.2)
                    .opacity(slam ? 1 : 0)
                    .blur(radius: slam ? 0 : 10)
                    .offset(x: shake)
                Text("패배 · \(Labels.resultReason(reason))")
                    .font(.title3).tracking(2)
                    .foregroundStyle(Color(red: 1, green: 0.79, blue: 0.76))
                    .opacity(slam ? 1 : 0)
            }
            .padding(.horizontal, 24)
        }
        .allowsHitTesting(false)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("체크메이트. 패배")
        .task {
            withAnimation(.easeOut(duration: 0.5).delay(0.35)) { flash = 0 }
            withAnimation(.spring(response: 0.45, dampingFraction: 0.55).delay(0.3)) { slam = true }
            withAnimation(.easeIn(duration: 0.7).delay(0.9)) { topple = true }
            try? await Task.sleep(nanoseconds: 850_000_000)
            for x in [-7.0, 6.0, -4.0, 3.0, 0.0] {
                withAnimation(.linear(duration: 0.06)) { shake = x }
                try? await Task.sleep(nanoseconds: 60_000_000)
            }
        }
    }
}

/// 이 판의 기록: 승패, 최종 승수, 라운드별 승패, 레이팅, 마지막 라운드에 낸 기물
struct GameRecordView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            AppBackground()
            if let record = model.gameRecord {
                ScrollView {
                    VStack(spacing: 16) {
                        HStack {
                            Label("이 판의 기록", systemImage: "list.bullet.rectangle").font(.title2.bold())
                            Spacer()
                            Button("닫기") { model.showRecord = false }.buttonStyle(SecondaryButtonStyle())
                        }
                        content(record)
                    }
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity)
                    .padding(24)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    @ViewBuilder private func content(_ r: GameRecord) -> some View {
        let headline = outcome(r)
        VStack(spacing: 4) {
            Text(headline.title).font(.system(size: 56, weight: .heavy, design: .rounded)).foregroundStyle(headline.color)
            Text(Labels.resultReason(r.result.reason)).font(.title3).foregroundStyle(.secondary)
        }
        HStack(alignment: .center, spacing: 24) {
            score(r.names[safe: r.seat] ?? "나", r.roundWins[safe: r.seat] ?? 0, Theme.mine, me: true)
            Text(":").font(.largeTitle).foregroundStyle(.secondary)
            score(r.names[safe: 1 - r.seat] ?? "상대", r.roundWins[safe: 1 - r.seat] ?? 0, Theme.theirs, me: false)
        }
        if let target = r.winTarget {
            let dm = r.rounds.filter { $0.deathmatch != nil }.count
            Text("\(target)승 먼저 · \(r.rounds.count - dm)라운드 진행\(dm > 0 ? " + 데스매치 \(dm)번" : "")")
                .font(.caption).foregroundStyle(.secondary)
        }
        VStack(alignment: .leading, spacing: 8) {
            Text("라운드별 결과").font(.headline)
            if r.rounds.isEmpty {
                Text("라운드 기록이 없어요").font(.caption).foregroundStyle(.secondary)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 54), spacing: 6)], spacing: 6) {
                    ForEach(Array(r.rounds.enumerated()), id: \.offset) { _, round in chip(round, seat: r.seat) }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
        if let rating = r.result.ratings[safe: r.seat] ?? nil {
            Text("레이팅 \(rating.before) → \(rating.after) (\(rating.delta >= 0 ? "+" : "")\(rating.delta))")
                .font(.title3.bold())
                .foregroundStyle(rating.delta >= 0 ? Theme.good : Theme.theirs)
        } else if r.bot {
            Text("봇과 한 판은 레이팅 없이 내 전적에 기록돼요.").font(.callout).foregroundStyle(.secondary)
        }
        if !r.lastBoard.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("마지막 라운드에 낸 기물").font(.headline)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 64), spacing: 6)], spacing: 6) {
                    ForEach(Array(r.lastBoard.enumerated()), id: \.offset) { _, unit in
                        ChessToken(defId: unit.defId, star: unit.star, selected: false).frame(width: 64, height: 64)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .panel()
        }
        Button { model.showRecord = false; model.openRanking() } label: { Label("내 전적", systemImage: "trophy") }
            .buttonStyle(SecondaryButtonStyle())
    }

    private func score(_ name: String, _ wins: Int, _ color: Color, me: Bool) -> some View {
        VStack(spacing: 2) {
            Text(me ? "\(name) (나)" : name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Text("\(wins)").font(.system(size: 64, weight: .heavy, design: .rounded).monospacedDigit()).foregroundStyle(color)
        }
    }

    private func chip(_ round: ChessRoundResult, seat: Int) -> some View {
        let (mark, color): (String, Color) = round.winner == nil ? ("무", Theme.silver) : round.winner == seat ? ("승", Theme.good) : ("패", Theme.theirs)
        let label: String = round.deathmatch.map { $0 > 1 ? "DM\($0)" : "DM" } ?? "R\(round.round)"
        return VStack(spacing: 1) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(mark).font(.headline).foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, minHeight: 46)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(color.opacity(0.14)))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(round.deathmatch != nil ? Theme.warn : color.opacity(0.6), lineWidth: round.deathmatch != nil ? 2 : 1))
    }

    private func outcome(_ r: GameRecord) -> (title: String, color: Color) {
        guard let winner = r.result.winner else { return ("무승부", Theme.silver) }
        return winner == r.seat ? ("승리", Theme.good) : ("패배", Theme.theirs)
    }
}
