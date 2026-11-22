#!/bin/sh
# .deb 만들기:  linux/build-deb.sh [버전]   (먼저 local-server에서 `bun build.ts`, `bun build.ts --edition expert`)
# 결과: local-server/dist/commander-server_<버전>_amd64.deb
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
version="${1:-$(grep '"version"' "$root/package.json" | head -1 | sed 's/[^0-9.]//g')}"
stage="$(mktemp -d)"
pkg="$stage/commander-server_${version}_amd64"
for f in commander-server commander-server-expert; do
  [ -f "$root/dist/$f" ] || { echo "$root/dist/$f 가 없다. 먼저 bun build.ts 로 만드세요."; exit 1; }
done
install -d "$pkg/DEBIAN" "$pkg/opt/commander-server" "$pkg/usr/bin" "$pkg/usr/share/applications" "$pkg/usr/lib/systemd/user" "$pkg/usr/share/icons/hicolor/scalable/apps" "$pkg/usr/share/doc/commander-server"
install -m 755 "$root/dist/commander-server" "$root/dist/commander-server-expert" "$pkg/opt/commander-server/"
install -m 755 "$here/commander-server-launcher" "$pkg/usr/bin/commander-server-launcher"
install -m 644 "$here/commander-server.desktop" "$pkg/usr/share/applications/commander-server.desktop"
install -m 644 "$here/commander-server.service" "$pkg/usr/lib/systemd/user/commander-server.service"
install -m 644 "$here/commander-server.svg" "$pkg/usr/share/icons/hicolor/scalable/apps/commander-server.svg"
install -m 644 "$root/README.md" "$pkg/usr/share/doc/commander-server/README.md"
size="$(du -sk "$pkg/opt" | cut -f1)"
cat > "$pkg/DEBIAN/control" <<EOF
Package: commander-server
Version: $version
Section: games
Priority: optional
Architecture: amd64
Installed-Size: $size
Depends: libc6, curl
Recommends: libnotify-bin, xdg-utils
Maintainer: COMMANDER <noreply@example.com>
Description: COMMANDER 로컬 서버 (바닐라/엑스퍼트)
 같은 와이파이의 기기와 함께 하는 COMMANDER 서버. 설치 없이 도는 실행파일 두 개
 (바닐라, 엑스퍼트)와 앱 메뉴 런처, 로그인 시 자동 실행용 systemd 사용자 서비스가 들어 있다.
EOF
mkdir -p "$root/dist"
dpkg-deb --root-owner-group --build "$pkg" "$root/dist/commander-server_${version}_amd64.deb" >/dev/null
echo "만들었다: $root/dist/commander-server_${version}_amd64.deb"
