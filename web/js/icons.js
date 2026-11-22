// 아이콘: 이모지 대신 쓰는 인라인 SVG. 글자 색(currentColor)과 크기(1em)를 따라간다.
// ic("ghost") -> <svg class="ic">…</svg>. 가이드의 문구 안에서는 {icon:ghost} 로 쓴다.

const P = {
  "volume": ['<path d="M11 5 6 9H2v6h4l5 4V5z"/>', '<path d="M15.5 8.5a5 5 0 0 1 0 7"/>', '<path d="M19 5a10 10 0 0 1 0 14"/>'],
  "volume-off": ['<path d="M11 5 6 9H2v6h4l5 4V5z"/>', '<path d="m22 9-6 6"/>', '<path d="m16 9 6 6"/>'],
  "music": ['<path d="M9 18V5l12-2v13"/>', '<circle cx="6" cy="18" r="3"/>', '<circle cx="18" cy="16" r="3"/>'],
  "music-off": ['<path d="M9 18V5l12-2v13"/>', '<circle cx="6" cy="18" r="3"/>', '<circle cx="18" cy="16" r="3"/>', '<path d="m3 3 18 18"/>'],
  "book": ['<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/>', '<path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>'],
  "flag": ['<path d="M4 22V4"/>', '<path d="M4 4h13l-2 4 2 4H4"/>'],
  "log-out": ['<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>', '<path d="m16 17 5-5-5-5"/>', '<path d="M21 12H9"/>'],
  "trash": ['<path d="M3 6h18"/>', '<path d="M8 6V4h8v2"/>', '<path d="m19 6-1 14H6L5 6"/>', '<path d="M10 11v6"/>', '<path d="M14 11v6"/>'],
  "trophy": ['<path d="M8 21h8"/>', '<path d="M12 17v4"/>', '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/>', '<path d="M7 5H4v2a3 3 0 0 0 3 3"/>', '<path d="M17 5h3v2a3 3 0 0 1-3 3"/>'],
  "bot": ['<rect x="4" y="8" width="16" height="12" rx="2"/>', '<path d="M12 8V4"/>', '<circle cx="12" cy="3" r="1"/>', '<path d="M9 13v2"/>', '<path d="M15 13v2"/>', '<path d="M2 14h2"/>', '<path d="M20 14h2"/>'],
  "swords": ['<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/>', '<path d="m13 19 6-6"/>', '<path d="m16 16 4 4"/>', '<path d="m19 21 2-2"/>', '<path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/>', '<path d="m5 14 4 4"/>', '<path d="m7 17-3 3"/>', '<path d="m3 19 2 2"/>'],
  "sword": ['<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/>', '<path d="m13 19 6-6"/>', '<path d="m16 16 4 4"/>', '<path d="m19 21 2-2"/>'],
  "eye": ['<path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12z"/>', '<circle cx="12" cy="12" r="3"/>'],
  "cap": ['<path d="m22 10-10-5L2 10l10 5z"/>', '<path d="M6 12v5c3 2 9 2 12 0v-5"/>', '<path d="M22 10v6"/>'],
  "folder": ['<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'],
  "key": ['<circle cx="8" cy="15" r="4"/>', '<path d="m10.8 12.2 9.2-9.2"/>', '<path d="m17 6 3 3"/>', '<path d="m14 9 2 2"/>'],
  "infinity": ['<path d="M12 12c-2-2.7-4-4-6-4a4 4 0 0 0 0 8c2 0 4-1.3 6-4zm0 0c2 2.7 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.3-6 4z"/>'],
  "ghost": ['<path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/>', '<path d="M9 10h.01"/>', '<path d="M15 10h.01"/>'],
  "link": ['<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/>', '<path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'],
  "mountain": ['<path d="m8 3 4 8 5-5 5 15H2z"/>'],
  "crown": ['<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7z"/>', '<path d="M5 20h14"/>'],
  "coin": ['<circle cx="12" cy="12" r="9"/>', '<circle cx="12" cy="12" r="5"/>'],
  "shield": ['<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'],
  "heart": ['<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>'],
  "sparkles": ['<path d="m11 3 1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z"/>', '<path d="M19 15v4"/>', '<path d="M17 17h4"/>'],
  "rotate-ccw": ['<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>', '<path d="M3 3v5h5"/>'],
  "refresh": ['<path d="M21 12a9 9 0 0 0-15-6.7L3 8"/>', '<path d="M3 3v5h5"/>', '<path d="M3 12a9 9 0 0 0 15 6.7L21 16"/>', '<path d="M16 16h5v5"/>'],
  "store": ['<path d="m2 7 1.5-4h17L22 7"/>', '<path d="M2 7a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>', '<path d="M4 10v11h16V10"/>', '<path d="M10 21v-6h4v6"/>'],
  "hammer": ['<path d="m13 11-8.4 8.4a2.1 2.1 0 0 1-3-3L10 8"/>', '<path d="m14 5 3-3 5 5-3 3z"/>', '<path d="m11 8 5 5"/>'],
  "flask": ['<path d="M10 2v7.5L4.6 18.4a2 2 0 0 0 1.7 3.1h11.4a2 2 0 0 0 1.7-3.1L14 9.5V2"/>', '<path d="M8.5 2h7"/>', '<path d="M7 16h10"/>'],
  "list": ['<path d="M8 6h13"/>', '<path d="M8 12h13"/>', '<path d="M8 18h13"/>', '<path d="M3 6h.01"/>', '<path d="M3 12h.01"/>', '<path d="M3 18h.01"/>'],
  "server": ['<rect x="3" y="3" width="18" height="7" rx="2"/>', '<rect x="3" y="14" width="18" height="7" rx="2"/>', '<path d="M7 6.5h.01"/>', '<path d="M7 17.5h.01"/>'],
  "arrow-up": ['<path d="M12 19V5"/>', '<path d="m5 12 7-7 7 7"/>'],
};

export function ic(name, extra = "") {
  const body = P[name];
  if (!body) return "";
  return `<svg class="ic ic-${name}${extra ? ` ${extra}` : ""}" viewBox="0 0 24 24" aria-hidden="true">${body.join("")}</svg>`;
}

/** 문구 안의 {icon:이름}을 아이콘으로 바꾼다. */
export const withIcons = (text) => text.replace(/\{icon:([\w-]+)\}/g, (_, name) => ic(name));
