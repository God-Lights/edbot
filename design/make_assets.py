#!/usr/bin/env python3
"""commander-logo.png(투명 배경 원본)에서 앱 아이콘, 게임 안 로고, 시작 화면 이미지를 만든다.

    python3 design/make_assets.py          # 저장소 루트에서

만드는 것:
  ios/EdbotApp/Assets.xcassets/AppIcon.appiconset/icon-1024.png   (투명 없음, iOS가 모서리를 깎는다)
  ios/EdbotApp/Assets.xcassets/Logo.imageset/logo@1x,2x,3x.png    (투명 배경, 가장자리 여백 없이 다듬음)
  ios/EdbotApp/Assets.xcassets/LaunchLogo.imageset/...            (시작 화면용)
  client/Assets/Resources/CommanderLogo.png                       (Unity 로비용)
  android/app/src/main/res/drawable-nodpi/ic_launcher_{bg,fg}.png (안드로이드 적응형 아이콘)
  android/app/src/main/res/drawable-nodpi/logo.png                (안드로이드 서버 고르기 화면)
  android/server/src/main/res/drawable-nodpi/*                    (안드로이드 서버 앱 아이콘·로고)
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(__file__).resolve().parent / "commander-logo.png"
ASSETS = ROOT / "ios/EdbotApp/Assets.xcassets"

# 로고에서 뽑은 색. 앱 테마(ios/EdbotApp/Theme.swift)와 같다.
BG_TOP = (14, 12, 38)      # 짙은 남색
BG_BOTTOM = (8, 7, 20)


def trimmed_logo(pad: int = 24) -> Image.Image:
    """투명한 가장자리와 거의 안 보이는 잔선(알파 < 24)을 잘라 낸 로고."""
    img = Image.open(SRC).convert("RGBA")
    alpha = img.getchannel("A").point(lambda a: 255 if a >= 24 else 0)
    box = alpha.getbbox()
    img = img.crop(box)
    out = Image.new("RGBA", (img.width + pad * 2, img.height + pad * 2), (0, 0, 0, 0))
    out.alpha_composite(img, (pad, pad))
    return out


def fit_square(img: Image.Image, size: int, margin: float) -> Image.Image:
    """정사각형 캔버스 가운데에 margin 비율의 여백을 두고 맞춘다."""
    inner = int(size * (1 - margin * 2))
    scale = min(inner / img.width, inner / img.height)
    resized = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def gradient_background(size: int) -> Image.Image:
    bg = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(bg)
    for y in range(size):
        t = y / (size - 1)
        draw.line([(0, y), (size, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM)))
    # 가운데가 살짝 밝은 빛 번짐: 로고의 남색과 보라가 배경에 묻히지 않게 한다.
    glow = Image.new("L", (size, size), 0)
    ImageDraw.Draw(glow).ellipse([size * 0.12, size * 0.12, size * 0.88, size * 0.88], fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.12))
    tint = Image.new("RGB", (size, size), (70, 40, 110))
    return Image.composite(tint, bg, glow)


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    print("wrote", path.relative_to(ROOT), img.size)


def write_contents(folder: Path, data: dict) -> None:
    (folder / "Contents.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    logo = trimmed_logo()

    # 앱 아이콘: 투명 없이, 짙은 배경 위에 로고. iOS가 둥근 모서리를 입히므로 직접 깎지 않는다.
    icon_bg = gradient_background(1024).convert("RGBA")
    icon_bg.alpha_composite(fit_square(logo, 1024, 0.07))
    folder = ASSETS / "AppIcon.appiconset"
    save(icon_bg.convert("RGB"), folder / "icon-1024.png")
    write_contents(folder, {
        "images": [{"filename": "icon-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}],
        "info": {"author": "xcode", "version": 1},
    })

    # 화면 안 로고: 배율별 (너비 기준 1x=360pt)
    for name, width_pt in (("Logo", 360), ("LaunchLogo", 240)):
        folder = ASSETS / f"{name}.imageset"
        images = []
        for scale in (1, 2, 3):
            width = width_pt * scale
            height = round(logo.height * width / logo.width)
            filename = f"{name.lower()}@{scale}x.png"
            save(logo.resize((width, height), Image.LANCZOS), folder / filename)
            images.append({"filename": filename, "idiom": "universal", "scale": f"{scale}x"})
        write_contents(folder, {"images": images, "info": {"author": "xcode", "version": 1}})

    # 색: 시작 화면 배경과 앱 강조색
    def color_set(name: str, rgb: tuple) -> None:
        folder = ASSETS / f"{name}.colorset"
        folder.mkdir(parents=True, exist_ok=True)
        r, g, b = (round(c / 255, 3) for c in rgb)
        write_contents(folder, {
            "colors": [{"color": {"color-space": "srgb", "components": {"red": str(r), "green": str(g), "blue": str(b), "alpha": "1.000"}}, "idiom": "universal"}],
            "info": {"author": "xcode", "version": 1},
        })

    color_set("LaunchBackground", (11, 10, 29))
    color_set("AccentColor", (176, 64, 190))
    write_contents(ASSETS, {"info": {"author": "xcode", "version": 1}})

    # Unity 로비용 (너비 1024 이하)
    unity = logo.resize((1024, round(logo.height * 1024 / logo.width)), Image.LANCZOS)
    save(unity, ROOT / "client/Assets/Resources/CommanderLogo.png")

    # 안드로이드: 적응형 아이콘(108dp = 432px, 가운데 66dp 안에 로고), 화면 로고
    android = ROOT / "android/app/src/main/res/drawable-nodpi"
    save(gradient_background(432), android / "ic_launcher_bg.png")
    save(fit_square(logo, 432, 0.22), android / "ic_launcher_fg.png")
    save(logo.resize((720, round(logo.height * 720 / logo.width)), Image.LANCZOS), android / "logo.png")

    # 안드로이드 서버 앱: 같은 로고, 배경은 청록빛으로 (게임 앱과 구분)
    server = ROOT / "android/server/src/main/res/drawable-nodpi"
    teal = gradient_background(432).convert("RGB")
    tint = Image.new("RGB", teal.size, (10, 70, 80))
    save(Image.blend(teal, tint, 0.55), server / "ic_launcher_bg.png")
    save(fit_square(logo, 432, 0.22), server / "ic_launcher_fg.png")
    save(logo.resize((720, round(logo.height * 720 / logo.width)), Image.LANCZOS), server / "logo.png")

    # 미리보기(저장소에는 넣지 않는다)
    print("logo size", logo.size)


if __name__ == "__main__":
    main()
