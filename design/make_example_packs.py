"""예시 팩(리소스·종합)의 그림과 소리를 만든다: python3 design/make_example_packs.py  ->  server/packs/examples/"""
import json, math, struct, wave, random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "server/packs/examples"
PIECES = ROOT / "web/assets/pieces"
LOGO = ROOT / "design/commander-logo.png"

def gradient(w, h, top, bottom):
    im = Image.new("RGB", (w, h)); d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return im

def stars(im, n, seed):
    rnd = random.Random(seed); d = ImageDraw.Draw(im)
    for _ in range(n):
        x, y, r = rnd.randrange(im.width), rnd.randrange(im.height), rnd.choice([1, 1, 1, 2])
        c = rnd.randrange(170, 255)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(c, c, 255))
    return im

def portrait(piece, top, bottom, size=256):
    im = gradient(size, size, top, bottom).convert("RGBA")
    glow = Image.new("L", (size, size), 0)
    ImageDraw.Draw(glow).ellipse([size * .15, size * .15, size * .85, size * .85], fill=120)
    im = Image.composite(Image.new("RGBA", (size, size), (255, 255, 255, 255)), im, glow.filter(ImageFilter.GaussianBlur(size * .12)).point(lambda v: v // 3))
    p = Image.open(PIECES / f"{piece}.png").convert("RGBA").resize((int(size * .62),) * 2, Image.LANCZOS)
    silhouette = Image.new("RGBA", p.size, (250, 244, 225, 255)); silhouette.putalpha(p.getchannel("A"))
    shadow = Image.new("RGBA", p.size, (0, 0, 0, 160)); shadow.putalpha(p.getchannel("A").point(lambda v: v * 6 // 10))
    off = ((size - p.width) // 2, int(size * .2))
    im.alpha_composite(shadow, (off[0] + 4, off[1] + 6)); im.alpha_composite(silhouette, off)
    return im.convert("RGB")

def tone_wav(path, freqs, dur=0.18, vol=0.35):
    rate = 22050; n = int(rate * dur)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        frames = bytearray()
        for i in range(n):
            t = i / rate; env = min(1, i / 200) * (1 - i / n) ** 2
            s = sum(math.sin(2 * math.pi * f * t * (1 + 0.15 * t)) for f in freqs) / len(freqs)
            frames += struct.pack("<h", int(max(-1, min(1, s * env * vol)) * 32767))
        w.writeframes(bytes(frames))

def save(im, path, **kw):
    path.parent.mkdir(parents=True, exist_ok=True); im.save(path, **kw)

# ---- 리소스 팩: 밤하늘 스킨 ----
skin = OUT / "night-skin"
logo = Image.open(LOGO).convert("RGBA"); logo = logo.crop(logo.getbbox())
tint = Image.new("RGBA", logo.size, (120, 170, 255, 255)); tint.putalpha(logo.getchannel("A"))
logo_n = Image.blend(logo, tint, 0.45); logo_n.thumbnail((640, 640))
save(logo_n, skin / "assets/logo.png", optimize=True)
save(stars(gradient(1280, 800, (6, 10, 34), (2, 3, 12)), 380, 1), skin / "assets/lobby.jpg", quality=80)
save(stars(gradient(800, 800, (10, 22, 52), (4, 8, 26)), 160, 2), skin / "assets/board.jpg", quality=82)
arts = {"relic": ("pawn", (40, 80, 160), (10, 20, 60)), "nut-wolf": ("pawn", (60, 120, 90), (10, 40, 30)),
        "felis": ("bishop", (120, 60, 160), (30, 10, 60)), "marshal-berg": ("king", (170, 130, 40), (60, 40, 10)),
        "obelion": ("rook", (150, 70, 60), (50, 15, 15))}
for uid, (piece, a, b) in arts.items():
    save(portrait(piece, a, b), skin / f"assets/units/{uid}.jpg", quality=85)
tone_wav(skin / "sfx/buy.wav", [880, 1320]); tone_wav(skin / "sfx/merge.wav", [523, 784, 1047], 0.4); tone_wav(skin / "sfx/roundWin.wav", [659, 988], 0.35)
(skin / "pack.json").write_text(json.dumps({
    "apiVersion": 1, "id": "night-skin", "name": "밤하늘 스킨", "version": "1.0.0", "kind": "resource", "author": "COMMANDER",
    "description": "밤하늘 색과 별 배경, 몇몇 캐릭터의 그림과 효과음을 바꾸는 리소스 팩 예시예요. 규칙은 공식 그대로예요.",
    "guide": [
        {"title": "이 팩은", "body": "화면과 소리만 바꿔요. 캐릭터 능력치나 규칙은 그대로라서 공식 서버와 똑같이 즐길 수 있어요."},
        {"title": "바뀌는 것", "body": "· 금색 대신 푸른 은색\n· 로비와 판에 별이 뜬 밤하늘\n· 렐릭·넛울프·펠리스·마샬 베르그·오벨리온의 그림\n· 사기, ★2 합치기, 라운드 승리 소리"},
    ],
    "resources": {
        "colors": {"gold": "#8fb8ff", "goldHi": "#d6e6ff", "accent": "#5b8cff", "bgTop": "#070b22", "bgBottom": "#02030c"},
        "logo": "assets/logo.png", "lobbyBackground": "assets/lobby.jpg", "boardBackground": "assets/board.jpg",
        "units": {k: f"assets/units/{k}.jpg" for k in arts},
        "sounds": {"buy": "sfx/buy.wav", "merge": "sfx/merge.wav", "roundWin": "sfx/roundWin.wav"},
    },
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# ---- 종합 팩: 별똥별 (새 캐릭터 + 그림 + 규칙 + 설명서) ----
star = OUT / "starfall"
save(portrait("knight", (90, 60, 170), (20, 10, 50)), star / "assets/comet.jpg", quality=85)
(star / "pack.json").write_text(json.dumps({
    "apiVersion": 1, "id": "starfall", "name": "별똥별", "version": "1.0.0", "kind": "bundle", "author": "COMMANDER",
    "description": "새 캐릭터 '혜성 기사'와 그 그림, 조금 빨라진 규칙을 담은 종합 팩 예시예요.",
    "guide": [
        {"title": "혜성 기사", "body": "3골드 나이트 · 암살. 적이 가장 많은 곳으로 도약해 주변을 쳐요.\n상점에 새로 나와요."},
        {"title": "규칙 변경", "body": "· 새로고침 1골드\n· 준비 시간 20초 (첫 라운드 30초)"},
    ],
    "units": [{"id": "comet-knight", "nameKo": "혜성 기사", "piece": "knight", "faction": "별", "cost": 3, "role": "암살",
               "ability": "dimension-leap", "abilityText": "적이 가장 많은 곳으로 도약해 주변 적에게 피해를 준다"}],
    "rules": {"rerollCost": 1, "prepSeconds": 20, "firstPrepSeconds": 30},
    "resources": {"units": {"comet-knight": "assets/comet.jpg"}},
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("ok")
