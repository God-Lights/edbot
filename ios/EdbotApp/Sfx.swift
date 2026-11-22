import AVFoundation
import Foundation

/// 효과음과 배경 음악. 파일 없이 합성한다. (웹의 sfx.js와 같은 소리)
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
    private(set) var musicOn: Bool = UserDefaults.standard.bool(forKey: "bgmOn")

    private let sampleRate: Double = 44100
    private let format: AVAudioFormat
    private let engine = AVAudioEngine()
    private var players: [AVAudioPlayerNode] = []
    private let musicPlayer = AVAudioPlayerNode()
    private var buffers: [Sound: AVAudioPCMBuffer] = [:]
    private var musicBuffer: AVAudioPCMBuffer?
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
        if value { musicPlayer.pause() } else if musicOn { startMusic() }
    }

    func setMusic(_ value: Bool) {
        musicOn = value
        UserDefaults.standard.set(value, forKey: "bgmOn")
        if value { startMusic() } else { musicPlayer.stop() }
    }

    /// 앱이 켜질 때 배경 음악이 켜져 있으면 시작한다.
    func resumeMusicIfNeeded() {
        if musicOn && !muted { startMusic() }
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
            engine.attach(musicPlayer)
            engine.connect(musicPlayer, to: engine.mainMixerNode, format: format)
            musicPlayer.volume = 0.8
        }
        if !engine.isRunning {
            do { try engine.start() } catch { return false }
        }
        return true
    }

    private func startMusic() {
        guard ensureStarted(), !muted else { return }
        if musicBuffer == nil { musicBuffer = renderMusic() }
        guard let buffer = musicBuffer else { return }
        if musicPlayer.isPlaying { return }
        musicPlayer.scheduleBuffer(buffer, at: nil, options: .loops, completionHandler: nil)
        musicPlayer.play()
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

    /// 잔잔한 아르페지오 13.4초를 이어 붙여 반복한다.
    private func renderMusic() -> AVAudioPCMBuffer? {
        let scale: [Double] = [0, 3, 5, 7, 10, 12, 15]
        let pattern: [Int] = [0, 2, 4, 2, 5, 4, 2, 1]
        let roots: [Double] = [110, 98, 123, 98]
        let step = 0.42
        var notes: [Note] = []
        for s in 0..<32 {
            let root = roots[(s / 8) % 4]
            let freq = root * pow(2, scale[pattern[s % 8]] / 12)
            notes.append(Note(freq: freq, dur: 0.7, wave: .sine, vol: 0.035, delay: Double(s) * step))
            if s % 8 == 0 { notes.append(Note(freq: root / 2, dur: 1.6, wave: .triangle, vol: 0.03, delay: Double(s) * step)) }
        }
        return render(notes: notes, noise: [], length: 32 * step, wrap: true)
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
