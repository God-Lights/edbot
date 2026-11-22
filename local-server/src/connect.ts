// 접속 링크와 QR. 폰의 카메라로 QR을 찍으면 COMMANDER 앱이 열리고 서버 주소가 채워진다.
import qrcode from "qrcode-generator";

/** 앱이 여는 접속 링크: commander://connect?url=<서버 주소>&name=<서버 이름> */
export function connectLink(serverUrl: string, name: string): string {
  return `commander://connect?url=${encodeURIComponent(serverUrl)}&name=${encodeURIComponent(name)}`;
}

function makeQr(text: string) {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  return qr;
}

/** 터미널에 찍을 QR (글자 두 줄을 한 칸으로 쓰는 반블록, 어두운 터미널 기준) */
export function qrTerminal(text: string): string {
  const qr = makeQr(text);
  const n = qr.getModuleCount();
  const dark = (r: number, c: number) => r >= 0 && r < n && c >= 0 && c < n && qr.isDark(r, c);
  const lines: string[] = [];
  for (let r = -2; r < n + 2; r += 2) {
    let line = "";
    for (let c = -2; c < n + 2; c++) {
      const top = dark(r, c), bottom = dark(r + 1, c);
      // 어두운 터미널: 모듈(어두운 칸)이 '빈 칸', 바탕이 '채운 칸'이어야 밝은 QR로 읽힌다.
      line += top && bottom ? " " : top ? "▄" : bottom ? "▀" : "█";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

/** SVG QR (흰 바탕에 검은 점, 가장자리 여백 포함) */
export function qrSvg(text: string, cell = 6): string {
  const qr = makeQr(text);
  const n = qr.getModuleCount();
  const size = (n + 8) * cell;
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${(c + 4) * cell} ${(r + 4) * cell}h${cell}v${cell}h-${cell}z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

/** /connect 화면: 같은 와이파이의 폰으로 찍을 QR과 주소 */
export function connectPage(name: string, urls: string[]): string {
  const cards = urls
    .map((u) => `<section><div class="qr">${qrSvg(connectLink(u, name))}</div><p class="url">${esc(u)}</p></section>`)
    .join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)} 접속</title>
<style>body{font-family:system-ui,sans-serif;background:#10141c;color:#e8ecf4;margin:0;padding:24px;text-align:center}
section{display:inline-block;margin:12px;padding:16px;background:#1a2030;border-radius:16px}.qr svg{width:240px;height:240px;border-radius:8px}
.url{font:600 15px ui-monospace,monospace;margin:10px 0 0}h1{font-size:20px}p.hint{color:#9aa6bd;font-size:14px}a{color:#8ab4ff}</style></head><body>
<h1>${esc(name)}</h1><p class="hint">같은 와이파이의 폰 카메라로 QR을 찍으면 COMMANDER 앱이 열리고 이 서버가 입력돼요.<br>웹으로 하려면 아래 주소를 브라우저에 열면 돼요.</p>
${cards || "<p>같은 와이파이 주소를 찾지 못했어요.</p>"}</body></html>`;
}
