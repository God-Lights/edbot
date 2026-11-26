// 콘텐츠 팩: 목록(/api/packs), 리소스 적용(색·로고·배경·캐릭터 그림·효과음·음악), 로비의 팩 목록 창, 가이드의 "팩" 탭.
// 팩은 엑스퍼트 서버에만 있다. 리소스는 팩 id 순서로 겹쳐서, 뒤의 팩이 앞의 것을 덮는다.

import { ic } from "./icons.js";
import { bgm, sfx } from "./sfx.js";
import { S, materialInfo, unitInfo } from "./state.js";
import { COST_COLOR, esc, setTeamColors } from "./util.js";

export const KIND_NAME = { bundle: "종합", resource: "리소스", plugin: "플러그인" };
const KIND_HINT = { bundle: "규칙·캐릭터와 화면·소리를 함께 바꿔요", resource: "화면·소리만 바꿔요 (규칙은 그대로)", plugin: "규칙·캐릭터를 바꿔요" };

/** 팩 색 이름 -> CSS 변수 */
const COLOR_VARS = {
  bgTop: ["--bg-top"], bgBottom: ["--bg-bottom"], panel: ["--panel-top", "--panel-bot"], gold: ["--gold"], goldHi: ["--gold-hi"],
  accent: ["--accent"], text: ["--text"], mine: ["--mine"], theirs: ["--theirs"],
};
const DEFAULT_COST = { ...COST_COLOR };

const RULE_NAME = {
  startHp: "시작 체력", startGold: "시작 골드", baseIncome: "라운드 수입", maxInterest: "최대 이자", maxRounds: "최대 라운드",
  maxDeploy: "최대 배치 수", rerollCost: "새로고침 비용", prepSeconds: "준비 시간", firstPrepSeconds: "첫 준비 시간", poolCopies: "상점 풀 수",
};
const MUSIC_NAME = { prep: "준비", combat: "전투", finale: "마지막 라운드" };

/** 서버의 팩 목록을 받아 리소스를 적용한다. (팩이 없으면 공식 모습 그대로) */
export async function loadPacks() {
  S.packs = [];
  if (S.server?.packs?.length) {
    try {
      const res = await fetch("/api/packs", { cache: "no-cache" });
      if (res.ok) S.packs = (await res.json()).packs ?? [];
    } catch { /* 팩을 못 읽어도 게임은 된다 */ }
  }
  applyResources();
}

/** 팩들의 리소스를 합쳐(뒤의 팩이 덮는다) 화면에 적용한다. */
export function applyResources() {
  const merged = { colors: {}, units: {}, sounds: {}, music: {} };
  for (const pack of S.packs) {
    const r = pack.resources;
    if (!r) continue;
    Object.assign(merged.colors, r.colors ?? {});
    for (const key of ["logo", "lobbyBackground", "boardBackground"]) if (r[key]) merged[key] = r[key];
    Object.assign(merged.units, r.units ?? {});
    Object.assign(merged.sounds, r.sounds ?? {});
    Object.assign(merged.music, r.music ?? {});
  }
  S.res = merged;
  const root = document.documentElement.style;
  for (const [key, vars] of Object.entries(COLOR_VARS)) {
    for (const v of vars) merged.colors[key] ? root.setProperty(v, merged.colors[key]) : root.removeProperty(v);
  }
  for (const cost of [1, 2, 3, 4, 5]) COST_COLOR[cost] = merged.colors[`cost${cost}`] ?? DEFAULT_COST[cost];
  setTeamColors(merged.colors.mine, merged.colors.theirs);
  root.setProperty("--pack-lobby-bg", merged.lobbyBackground ? `url("${merged.lobbyBackground}")` : "none");
  root.setProperty("--pack-board-bg", merged.boardBackground ? `url("${merged.boardBackground}")` : "none");
  document.body.classList.toggle("pack-board", !!merged.boardBackground);
  sfx.override(merged.sounds);
  bgm.setTracks(merged.music);
}

/** 이 캐릭터의 팩 그림 (없으면 undefined: 기물 모양으로 그린다) */
export const unitArt = (defId) => S.res?.units?.[defId];
/** 로고 (팩이 바꿨으면 그 그림) */
export const logoUrl = () => S.res?.logo || "assets/logo.png";

const kindBadge = (kind) => `<span class="pkind k-${esc(kind)}" title="${esc(KIND_HINT[kind] ?? "")}">${esc(KIND_NAME[kind] ?? kind)}</span>`;

/** 팩이 바꾼 것을 짧은 줄로 */
function summaryLines(pack) {
  const s = pack.summary ?? {};
  const r = pack.resources ?? {};
  const names = (ids, info) => ids.map((id) => esc(info(id)?.nameKo ?? id)).join(", ");
  const lines = [];
  if (s.units?.length) lines.push(`새 캐릭터 ${s.units.length}명: ${names(s.units, unitInfo)}`);
  if (s.overrides?.length) lines.push(`값을 바꾼 캐릭터: ${names(s.overrides, unitInfo)}`);
  if (s.materials?.length) lines.push(`새 재료: ${names(s.materials, materialInfo)}`);
  if (s.weapons?.length) lines.push(`새 무기 ${s.weapons.length}종`);
  if (s.rules?.length) lines.push(`규칙: ${s.rules.map((k) => RULE_NAME[k] ?? k).join(", ")}`);
  const look = [];
  if (r.colors && Object.keys(r.colors).length) look.push(`색 ${Object.keys(r.colors).length}가지`);
  if (r.logo) look.push("로고");
  if (r.lobbyBackground) look.push("로비 배경");
  if (r.boardBackground) look.push("판 배경");
  if (r.units && Object.keys(r.units).length) look.push(`캐릭터 그림 ${Object.keys(r.units).length}명`);
  if (r.sounds && Object.keys(r.sounds).length) look.push(`효과음 ${Object.keys(r.sounds).length}개`);
  if (r.music && Object.keys(r.music).length) look.push(`음악(${Object.keys(r.music).map((k) => MUSIC_NAME[k] ?? k).join("·")})`);
  if (look.length) lines.push(`화면·소리: ${look.join(", ")}`);
  return lines;
}

/** 로비의 "팩" 창: 이 서버에 들어 있는 팩 */
export function packsModal() {
  const list = S.packs.length
    ? S.packs.map((p) => `<div class="panel packrow">
        <div class="packhead"><b>${esc(p.name)}</b>${kindBadge(p.kind)}<span class="sub tiny">v${esc(p.version)}${p.author ? ` · ${esc(p.author)}` : ""}</span>
          <span class="grow"></span><button class="mini" data-act="pack-guide" data-id="${esc(p.id)}">${ic("book")} 설명서</button></div>
        ${p.description ? `<div class="sub">${esc(p.description)}</div>` : ""}
        <ul class="packsum">${summaryLines(p).map((l) => `<li>${l}</li>`).join("")}</ul></div>`).join("")
    : `<div class="sub">이 서버에는 팩이 없어요. 팩은 엑스퍼트 서버에서만 쓸 수 있어요.</div>`;
  const ruleset = S.server?.ruleset && S.server.ruleset !== "official" ? `규칙 묶음 ${esc(S.server.ruleset)}` : "규칙은 공식 그대로";
  return `<div class="modal"><div class="modal-box"><div class="modal-head"><h2>${ic("list")} 이 서버의 팩</h2><button class="btn sec" data-act="close-modal">닫기</button></div>
    <div class="modal-body"><div class="sub tiny" style="margin-bottom:8px">팩 ${S.packs.length}개 · ${ruleset}</div>${list}</div></div></div>`;
}

/** 가이드의 "팩" 탭: 팩마다 설명, 팩이 쓴 설명서, 바꾼 것 요약 */
export function packsGuide() {
  if (!S.packs.length) return `<div class="panel gcard"><h4>팩</h4><div class="sub">이 서버에는 팩이 없어요.</div></div>`;
  return S.packs.map((p) => `<div class="panel gcard packguide${S.guidePack === p.id ? " focus" : ""}" id="pack-${esc(p.id)}">
    <h4>${esc(p.name)} ${kindBadge(p.kind)} <span class="sub tiny">v${esc(p.version)}${p.author ? ` · ${esc(p.author)}` : ""}</span></h4>
    ${p.description ? `<p>${esc(p.description)}</p>` : ""}
    ${(p.guide ?? []).map((g) => `<h5>${esc(g.title)}</h5><p class="pre">${esc(g.body)}</p>`).join("")}
    ${summaryLines(p).length ? `<h5>이 팩이 바꾸는 것</h5><ul>${summaryLines(p).map((l) => `<li>${l}</li>`).join("")}</ul>` : ""}
  </div>`).join("");
}
