import sys
from PIL import Image, ImageDraw, ImageFont
src, out = sys.argv[1], sys.argv[2]
GOLD = (240, 217, 160)
def font(size):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
        try: return ImageFont.truetype(p, size)
        except OSError: pass
    return ImageFont.load_default()
def badge(d, x, y, n):
    r = 34
    d.ellipse([x - r, y - r, x + r, y + r], fill=GOLD, outline=(26, 18, 5), width=4)
    f = font(40)
    w = d.textlength(str(n), font=f)
    d.text((x - w / 2, y - 25), str(n), fill=(26, 18, 5), font=f)
def ring(d, box, radius=30):
    d.rounded_rectangle(box, radius=radius, outline=GOLD, width=9)
def save(im, name):
    im = im.crop((0, 42, im.width, im.height))  # 상태 표시줄을 잘라 낸다
    im = im.resize((1200, round(im.height * 1200 / im.width)), Image.LANCZOS)
    im.save(f"{out}/{name}", quality=82, optimize=True, progressive=True)
    print(name, im.size)
imgs = {n: Image.open(f"{src}/{n}.jpg").convert("RGB") for n in ("5", "6", "7")}
# SideStore 첫 화면 (News)
save(imgs["5"].copy(), "sidestore-news.jpg")
# 1) Sources 탭 → 왼쪽 위 +
im = imgs["6"].copy(); d = ImageDraw.Draw(im)
ring(d, [737, 60, 903, 124], 30); badge(d, 820, 172, 1)
d.ellipse([6, 44, 102, 136], outline=GOLD, width=9); badge(d, 150, 92, 2)
save(im, "source-1-plus.jpg")
# 2) 주소 넣기 → COMMANDER 가 보이면 오른쪽 위 ✓
im = imgs["7"].copy(); d = ImageDraw.Draw(im)
ring(d, [530, 414, 1470, 514], 46); badge(d, 500, 464, 3)
ring(d, [530, 546, 1470, 680], 36); badge(d, 500, 613, 4)
d.ellipse([1388, 138, 1486, 236], outline=GOLD, width=9); badge(d, 1532, 187, 5)
save(im, "source-2-url.jpg")
# 3) 목록에 COMMANDER 가 생긴다
im = imgs["6"].copy(); d = ImageDraw.Draw(im)
ring(d, [28, 242, 1972, 375], 46); badge(d, 1990 - 60, 220, 6)
save(im, "source-3-added.jpg")
