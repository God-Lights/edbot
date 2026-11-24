#!/bin/bash
# 에뮬레이터에서 서버 고르기 화면과 게임 화면(로컬 서버의 웹 화면)을 찍는다. (CI 확인용)
#   android/scripts/screenshots.sh <api 레벨>   ->  android/build/screenshots/api<레벨>-*.png
# 에뮬레이터가 켜져 있고 app/build/outputs/apk/debug/app-debug.apk 가 만들어져 있어야 한다.
set -uo pipefail
cd "$(dirname "$0")/.."
api="${1:-0}"
out=build/screenshots
mkdir -p "$out"
pkg=com.officialgl.commander
shot() { sleep "$2"; adb exec-out screencap -p > "$out/api${api}-$1.png"; echo "찍음: api${api}-$1.png"; }

# 로컬 서버 (에뮬레이터에서는 10.0.2.2 가 이 머신이다)
(cd ../local-server && bun --preload ./src/runtime/plugin.ts src/main.ts --port 8801 --data "${RUNNER_TEMP:-/tmp}/android-demo" --no-discovery > "${RUNNER_TEMP:-/tmp}/server.log" 2>&1 &)
for i in $(seq 1 30); do curl -sf localhost:8801/health >/dev/null && break; sleep 1; done
curl -sf localhost:8801/health >/dev/null || { echo "로컬 서버가 켜지지 않았다"; cat "${RUNNER_TEMP:-/tmp}/server.log"; exit 1; }

adb install -r app/build/outputs/apk/debug/app-debug.apk
echo "WebView: $(adb shell dumpsys webviewupdate | grep -m1 -i 'current webview package' | tr -d '\r')"
adb logcat -c

# 1) 서버 고르기 (세로·가로)
adb shell am start -W -n $pkg/.MainActivity >/dev/null
shot picker 5
# 2) 서버 열기: WebView 가 오래됐으면 안내 창이 먼저 뜬다
adb shell am start -n $pkg/.MainActivity --es url http://10.0.2.2:8801 >/dev/null
shot open 12
# 3) 안내 없이 바로 게임 화면 (오래된 WebView 에서 어떻게 보이는지도 본다)
adb shell am force-stop $pkg
adb shell am start -n $pkg/.MainActivity --es url http://10.0.2.2:8801 --ez force true >/dev/null
shot game 15
# 4) commander:// 링크로 열기 (QR 과 같은 길)
adb shell am force-stop $pkg
adb shell am start -a android.intent.action.VIEW -d "'commander://connect?url=http%3A%2F%2F10.0.2.2%3A8801&name=CI'" >/dev/null
shot link 12

adb logcat -d -s CommanderWeb:* ServerDiscovery:* AndroidRuntime:E > "$out/api${api}-logcat.txt" || true
grep -q "FATAL EXCEPTION" "$out/api${api}-logcat.txt" && { echo "앱이 죽었다"; cat "$out/api${api}-logcat.txt"; exit 1; }
pkill -f "src/main.ts --port 8801" || true
exit 0
