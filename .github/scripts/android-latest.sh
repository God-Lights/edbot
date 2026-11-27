#!/usr/bin/env bash
# 설치 안내 페이지의 '늘 최신' 링크를 맞춘다:
#   https://github.com/<저장소>/releases/download/android-latest/Commander.apk
#   https://github.com/<저장소>/releases/download/android-latest/CommanderServer.apk
# 인자로 버전(0.1.0)을 주면 그 정식판, 없으면 가장 새 android-v* 정식판의 APK 를 버전 없는 이름으로 android-latest 에 올린다.
# android-latest 는 프리릴리스라서 저장소의 'Latest' 표시나 앱의 새 버전 안내(android-v*)에 끼지 않는다.
set -euo pipefail
repo="${GITHUB_REPOSITORY:?}"
version="${1:-}"
if [[ -z "$version" ]]; then
  tag=$(gh release list --repo "$repo" --limit 100 --exclude-drafts --exclude-pre-releases --json tagName,createdAt \
    --jq '[.[] | select(.tagName | startswith("android-v"))] | sort_by(.createdAt) | reverse | .[0].tagName // ""')
  [[ -n "$tag" ]] || { echo "android-v* 정식판이 아직 없다"; exit 0; }
  version="${tag#android-v}"
fi
dir=$(mktemp -d)
gh release download "android-v${version}" --repo "$repo" --dir "$dir" --pattern "Commander-${version}.apk" --pattern "CommanderServer-${version}.apk"
mv "$dir/Commander-${version}.apk" "$dir/Commander.apk"
mv "$dir/CommanderServer-${version}.apk" "$dir/CommanderServer.apk"
notes="늘 가장 새 정식판 (지금: ${version}). 설치 안내 페이지의 'APK 받기' 링크가 이 파일을 가리켜요. 버전별 파일은 android-v${version} 릴리스."
if gh release view android-latest --repo "$repo" >/dev/null 2>&1; then
  gh release edit android-latest --repo "$repo" --notes "$notes" --prerelease
else
  gh release create android-latest --repo "$repo" --target "${GITHUB_SHA:-main}" --prerelease \
    --title "COMMANDER Android (늘 최신)" --notes "$notes"
fi
gh release upload android-latest "$dir/Commander.apk" "$dir/CommanderServer.apk" --repo "$repo" --clobber
echo "android-latest → ${version}"
