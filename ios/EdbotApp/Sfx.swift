import AVFoundation
import Foundation

/// 효과음(합성)과 배경 음악(곡 3개를 상황에 맞게 바꿔 튼다). 웹의 sfx.js와 같은 구성이다.
/// 곡: prep = Tactical Drop (로비·준비), combat = Tactical Drop (1) (전투), finale = Final Checkmate (마지막 라운드·체력 위태로울 때·결과).
@MainActor
final class Sfx {
    static let shared = Sfx()

    enum Sound: CaseIterable {
        case click, buy, sell, place, ready, hit, ability, death, promote, mine
        case roundWin, roundLose, win, lose
        case pickup, drop, equip, smelt, combine, merge, full, roundStart, combatStart, tick, suddenDeath
    }

    private enum Wave { case sine, triangle, square, saw }

    private struct Note {
        var freq: Double
        var dur: Double
        var wave: Wave = .sine
        var vol: Double = 0.07
        /// 끝 주파수 = freq + slide (지수로 변한다)
        var slide: Double = 0
        var delay: Double = 0
    }

    private struct Burst {
        var dur: Double
        var vol: Double
        var delay: Double = 0
    }

    var muted: Bool = UserDefaults.standard.bool(forKey: "sfxMuted")
    /// 처음에는 켜져 있고, 끄면 기억한다.
    private(set) var musicOn: Bool = UserDefaults.standard.object(forKey: "bgmOn") as? Bool ?? true

    enum Track: String, CaseIterable { case prep, combat, finale }
    private var scene: Track = .prep
    private var trackPlayers: [Track: AVAudioPlayer] = [:]
    private let musicVolume: Float = 0.5
    private let fadeSeconds: TimeInterval = 1.0

    private let sampleRate: Double = 44100
    private let format: AVAudioFormat
    private let engine = AVAudioEngine()
    private var players: [AVAudioPlayerNode] = []
    private var buffers: [Sound: AVAudioPCMBuffer] = [:]
    private var nextPlayer = 0
    private var started = false
    private var lastPlayed: [Sound: CFAbsoluteTime] = [:]

    private init() {
        format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
    }

    // MARK: 사용

    /// 소리를 낸다. 같은 소리는 60ms 안에 두 번 나지 않는다.
    func play(_ sound: Sound) {
        guard !muted else { return }
        let now = CFAbsoluteTimeGetCurrent()
        if let last = lastPlayed[sound], now - last < 0.06 { return }
        lastPlayed[sound] = now
        guard ensureStarted() else { return }
        let buffer: AVAudioPCMBuffer
        if let cached = buffers[sound] {
            buffer = cached
        } else {
            let spec = score(for: sound)
            guard let rendered = render(notes: spec.notes, noise: spec.noise) else { return }
            buffers[sound] = rendered
            buffer = rendered
        }
        let player = players[nextPlayer]
        nextPlayer = (nextPlayer + 1) % players.count
        player.stop()
        player.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
        player.play()
    }

    func setMuted(_ value: Bool) {
        muted = value
        UserDefaults.standard.set(value, forKey: "sfxMuted")
        syncMusic()
    }

    func setMusic(_ value: Bool) {
        musicOn = value
        UserDefaults.standard.set(value, forKey: "bgmOn")
        syncMusic()
    }

    /// 앱이 켜질 때 배경 음악이 켜져 있으면 시작한다.
    func resumeMusicIfNeeded() {
        syncMusic()
    }

    /// 지금 상황에 맞는 곡으로 바꾼다. 같은 곡이면 아무 일도 없다.
    func setScene(_ track: Track) {
        guard track != scene else { return }
        scene = track
        syncMusic()
    }

    // MARK: 엔진

    private func ensureStarted() -> Bool {
        if !started {
            started = true
            do {
                try AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default, options: [.mixWithOthers])
                try AVAudioSession.sharedInstance().setActive(true)
            } catch {
                // 소리가 안 나도 게임은 된다
            }
            for _ in 0..<6 {
                let node = AVAudioPlayerNode()
                engine.attach(node)
                engine.connect(node, to: engine.mainMixerNode, format: format)
                players.append(node)
            }
        }
        if !engine.isRunning {
            do { try engine.start() } catch { return false }
        }
        return true
    }

    /// 곡마다 재생 위치를 기억한다. 바뀔 때는 앞 곡이 사라지며 새 곡이 커진다.
    private func player(for track: Track) -> AVAudioPlayer? {
        if let cached = trackPlayers[track] { return cached }
        guard let url = Bundle.main.url(forResource: track.rawValue, withExtension: "mp3"),
              let player = try? AVAudioPlayer(contentsOf: url) else { return nil }
        player.numberOfLoops = -1
        player.volume = 0
        player.prepareToPlay()
        trackPlayers[track] = player
        return player
    }

    private func syncMusic() {
        guard ensureStarted() else { return }
        for track in Track.allCases {
            if musicOn && !muted && track == scene {
                guard let player = player(for: track) else { continue }
                if !player.isPlaying { player.play() }
                player.setVolume(musicVolume, fadeDuration: fadeSeconds)
            } else if let player = trackPlayers[track], player.isPlaying {
                player.setVolume(0, fadeDuration: fadeSeconds)
                Task { [weak player] in
                    try? await Task.sleep(nanoseconds: UInt64((fadeSeconds + 0.2) * 1_000_000_000))
                    if let player, player.volume == 0 { player.pause() } // 위치는 그대로 남는다
                }
            }
        }
    }

    // MARK: 합성

    private func wave(_ kind: Wave, _ phase: Double) -> Double {
        switch kind {
        case .sine: return sin(2 * Double.pi * phase)
        case .triangle: return 1 - 4 * abs(phase - 0.5)
        case .square: return phase < 0.5 ? 1 : -1
        case .saw: return 2 * phase - 1
        }
    }

    private func render(notes: [Note], noise: [Burst], length: Double? = nil, wrap: Bool = false) -> AVAudioPCMBuffer? {
        var total: Double = length ?? 0
        if length == nil {
            for note in notes { total = max(total, note.delay + note.dur) }
            for burst in noise { total = max(total, burst.delay + burst.dur) }
            total += 0.05
        }
        let count = max(1, Int(total * sampleRate))
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)),
              let channel = buffer.floatChannelData?[0] else { return nil }
        buffer.frameLength = AVAudioFrameCount(count)
        var mix = [Float](repeating: 0, count: count)

        for note in notes {
            let start = Int(note.delay * sampleRate)
            let frames = Int(note.dur * sampleRate)
            let endFreq = max(30, note.freq + note.slide)
            var phase = 0.0
            for i in 0..<frames {
                let t = Double(i) / sampleRate
                let freq: Double = note.slide == 0 ? note.freq : note.freq * pow(endFreq / note.freq, t / note.dur)
                phase += freq / sampleRate
                phase -= floor(phase)
                let decay: Double = pow(0.0001 / note.vol, (t - 0.01) / max(0.001, note.dur - 0.01))
                let gain: Double = note.vol * (t < 0.01 ? t / 0.01 : decay)
                var index = start + i
                if wrap { index %= count } else if index >= count { break }
                mix[index] += Float(wave(note.wave, phase) * gain)
            }
        }
        for burst in noise {
            let start = Int(burst.delay * sampleRate)
            let frames = Int(burst.dur * sampleRate)
            for i in 0..<frames {
                var index = start + i
                if wrap { index %= count } else if index >= count { break }
                let fade = Float(1 - Double(i) / Double(max(1, frames)))
                mix[index] += Float.random(in: -1...1) * fade * Float(burst.vol)
            }
        }
        for i in 0..<count { channel[i] = max(-1, min(1, mix[i])) }
        return buffer
    }

    private func score(for sound: Sound) -> (notes: [Note], noise: [Burst]) {
        switch sound {
        case .click: return ([Note(freq: 520, dur: 0.05, wave: .triangle, vol: 0.05)], [])
        case .buy: return ([Note(freq: 660, dur: 0.07, wave: .triangle), Note(freq: 880, dur: 0.1, wave: .triangle, delay: 0.06)], [])
        case .sell: return ([Note(freq: 500, dur: 0.08, wave: .triangle), Note(freq: 330, dur: 0.1, wave: .triangle, delay: 0.06)], [])
        case .place: return ([Note(freq: 300, dur: 0.06, wave: .square, vol: 0.04, slide: -80)], [])
        case .ready: return ([Note(freq: 440, dur: 0.08, wave: .triangle), Note(freq: 660, dur: 0.12, wave: .triangle, delay: 0.08)], [])
        case .hit: return ([Note(freq: 180, dur: 0.07, wave: .square, vol: 0.04, slide: -90)], [Burst(dur: 0.07, vol: 0.05)])
        case .ability: return ([Note(freq: 740, dur: 0.18, vol: 0.07, slide: 500), Note(freq: 1100, dur: 0.2, vol: 0.04, delay: 0.05)], [])
        case .death: return ([Note(freq: 220, dur: 0.25, wave: .saw, vol: 0.05, slide: -150)], [Burst(dur: 0.15, vol: 0.04)])
        case .promote:
            return (([523, 659, 784, 1047] as [Double]).enumerated().map { Note(freq: $0.element, dur: 0.12, wave: .triangle, delay: Double($0.offset) * 0.07) }, [])
        case .mine: return ([Note(freq: 1320, dur: 0.08, wave: .triangle, vol: 0.06), Note(freq: 1760, dur: 0.16, wave: .triangle, vol: 0.05, delay: 0.07)], [])
        case .roundWin: return ([Note(freq: 523, dur: 0.12, wave: .triangle), Note(freq: 784, dur: 0.2, wave: .triangle, delay: 0.1)], [])
        case .roundLose: return ([Note(freq: 392, dur: 0.15, wave: .triangle), Note(freq: 294, dur: 0.25, wave: .triangle, delay: 0.12)], [])
        case .win:
            return (([523, 659, 784, 1047, 1318] as [Double]).enumerated().map { Note(freq: $0.element, dur: 0.22, wave: .triangle, delay: Double($0.offset) * 0.12) }, [])
        case .lose:
            return (([392, 330, 262, 196] as [Double]).enumerated().map { Note(freq: $0.element, dur: 0.3, wave: .sine, delay: Double($0.offset) * 0.16) }, [])
        case .pickup: return ([Note(freq: 700, dur: 0.04, wave: .triangle, vol: 0.04)], [])
        case .drop: return ([Note(freq: 260, dur: 0.07, wave: .triangle, vol: 0.06, slide: -60)], [])
        case .equip:
            return ([Note(freq: 1200, dur: 0.05, wave: .square, vol: 0.04), Note(freq: 1800, dur: 0.14, wave: .triangle, vol: 0.05, delay: 0.04)], [Burst(dur: 0.05, vol: 0.03)])
        case .smelt:
            return ([Note(freq: 120, dur: 0.35, wave: .saw, vol: 0.04, slide: 160), Note(freq: 660, dur: 0.12, wave: .triangle, vol: 0.04, delay: 0.3)], [Burst(dur: 0.35, vol: 0.05)])
        case .combine:
            return (([880, 1109, 1319, 1760] as [Double]).enumerated().map { Note(freq: $0.element, dur: 0.18, wave: .triangle, vol: 0.06, delay: 0.1 + Double($0.offset) * 0.07) }
                    + [Note(freq: 440, dur: 0.1, wave: .saw, vol: 0.04, slide: 400)], [Burst(dur: 0.12, vol: 0.04)])
        case .merge:
            return (([523, 659, 784, 1047, 1319] as [Double]).enumerated().map { Note(freq: $0.element, dur: 0.16, wave: .triangle, vol: 0.07, delay: Double($0.offset) * 0.06) }, [])
        case .full: return ([Note(freq: 880, dur: 0.08, wave: .triangle, vol: 0.06), Note(freq: 1175, dur: 0.16, wave: .triangle, vol: 0.06, delay: 0.07)], [])
        case .roundStart: return ([Note(freq: 196, dur: 0.5, vol: 0.07), Note(freq: 392, dur: 0.4, wave: .triangle, vol: 0.04, delay: 0.02)], [])
        case .combatStart:
            return ([Note(freq: 90, dur: 0.18, vol: 0.1, slide: -40), Note(freq: 90, dur: 0.18, vol: 0.1, slide: -40, delay: 0.2)], [Burst(dur: 0.1, vol: 0.04, delay: 0.2)])
        case .tick: return ([Note(freq: 1000, dur: 0.03, wave: .square, vol: 0.025)], [])
        case .suddenDeath: return ([Note(freq: 110, dur: 0.5, wave: .saw, vol: 0.05), Note(freq: 116, dur: 0.5, wave: .saw, vol: 0.04)], [])
        }
    }
}
