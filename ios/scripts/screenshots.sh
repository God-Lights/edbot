#!/bin/bash
# 시뮬레이터에서 시연 화면(-demo prep/combat)을 띄워 스크린샷을 찍는다. (CI 디자인 확인용)
#   ios/scripts/screenshots.sh   ->  ios/build/screenshots/*.png
set -euo pipefail
cd "$(dirname "$0")/.."
out=build/screenshots
mkdir -p "$out"

xcodebuild build \
  -project Commander.xcodeproj -scheme Commander -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build/sim CODE_SIGNING_ALLOWED=NO > build/sim-build.log 2>&1 || { grep -E "error:" build/sim-build.log | sort -u | head -40; exit 1; }
app=$(find build/sim/Build/Products -name "Commander.app" -maxdepth 3 | head -1)

# 쓸 수 있는 아이패드와 아이폰 하나씩 (이름은 러너의 Xcode 버전마다 다르다)
pick() {
  xcrun simctl list devices available -j | python3 -c "
import json,sys
want=sys.argv[1]
for runtime, devs in json.load(sys.stdin)['devices'].items():
    if 'iOS' not in runtime: continue
    for d in devs:
        if d['name'].startswith(want): print(d['udid']); sys.exit()
" "$1"
}

for kind in iPad iPhone; do
  udid=$(pick "$kind")
  [ -n "$udid" ] || { echo "$kind 시뮬레이터가 없다"; continue; }
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl install "$udid" "$app"
  for screen in prep combat; do
    xcrun simctl terminate "$udid" com.officialgl.commander 2>/dev/null || true
    xcrun simctl launch "$udid" com.officialgl.commander -demo "$screen" >/dev/null
    # 앱이 뜨는 시간을 기다린다. 전투는 끝나기 전에(진행 중인 모습) 찍는다.
    if [ "$screen" = combat ]; then sleep 4; else sleep 6; fi
    file="$out/$kind-$screen.png"
    xcrun simctl io "$udid" screenshot "$file" >/dev/null
    # 앱은 가로 전용이라 세로로 찍힌 화면을 돌린다.
    w=$(sips -g pixelWidth "$file" | awk '/pixelWidth/{print $2}'); h=$(sips -g pixelHeight "$file" | awk '/pixelHeight/{print $2}')
    if [ "$h" -gt "$w" ]; then sips -r 270 "$file" >/dev/null; fi
    # 올려서 보기 쉽게 크기를 줄인다(압축 파일이 10MB를 넘지 않게).
    sips -Z 1600 "$file" >/dev/null
    echo "찍었다: $file"
  done
  xcrun simctl shutdown "$udid" || true
done
