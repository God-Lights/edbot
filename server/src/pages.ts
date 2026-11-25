// 로그인 확인용 작은 웹 페이지. 로그인 화면 자체는 만들지 않고 모두 account.officialgl.com 에서 한다.

import type { PublicUser } from "./auth";

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(title: string, body: string): Response {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:18vh auto;padding:0 20px;text-align:center}
a.btn,button{display:inline-block;padding:12px 28px;border:0;border-radius:8px;background:#3b5bdb;color:#fff;font-size:16px;text-decoration:none;cursor:pointer}
p{color:#555}</style></head><body>${body}</body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    },
  });
}

/** iPad 설치 안내: SideStore에서 소스를 한 번에 추가하는 링크. */
function installLinks(origin: string): string {
  const source = `${origin}/sidestore.json`;
  return `<p style="margin-top:36px;font-size:14px">iPad에 설치하려면 SideStore에서 소스를 추가하세요.<br>
<a href="sidestore://source?url=${encodeURIComponent(source)}">SideStore에 소스 추가</a><br>
<small>${escapeHtml(source)}</small><br>
<a href="/install.html">설치 안내 전체 보기</a></p>`;
}

/** 첫 화면. 자동으로 넘기지 않고, 버튼을 눌러야 로그인 화면으로 간다. */
export function homePage(user: PublicUser | null, enabled: boolean, origin = ""): Response {
  const install = origin ? installLinks(origin) : "";
  if (user) {
    return page("edbot", `<h1>edbot</h1><p><b>${escapeHtml(user.nickname)}</b> 님으로 로그인되어 있습니다.</p>${install}`);
  }
  if (!enabled) return page("edbot", `<h1>edbot</h1><p>서버가 실행 중입니다.</p>${install}`);
  return page("edbot", `<h1>edbot</h1><p>로그인이 필요합니다.</p><a class="btn" href="/auth/login">로그인하기</a>${install}`);
}

/** 로그인 후 돌아오는 화면. 게임 클라이언트가 시작한 로그인이면 한 번 더 확인을 받는다. */
export function donePage(user: PublicUser | null, loginId: string | null): Response {
  if (!user) {
    const href = loginId ? `/auth/login?login=${encodeURIComponent(loginId)}` : "/auth/login";
    return page("edbot", `<h1>edbot</h1><p>로그인이 되어 있지 않습니다.</p><a class="btn" href="${escapeHtml(href)}">로그인하기</a>`);
  }
  if (!loginId) return homePage(user, true);
  return page(
    "edbot",
    `<h1>게임에 로그인</h1><p><b>${escapeHtml(user.nickname)}</b> 님으로 게임 클라이언트에 로그인할까요?<br>직접 게임에서 로그인을 시작한 게 아니라면 닫아 주세요.</p>
<form method="post" action="/auth/approve"><input type="hidden" name="login" value="${escapeHtml(loginId)}"><button type="submit">로그인 확인</button></form>`,
  );
}

export function approvedPage(): Response {
  return page("edbot", "<h1>완료</h1><p>게임으로 돌아가세요. 이 창은 닫아도 됩니다.</p>");
}

export function failedPage(): Response {
  return page("edbot", `<h1>실패</h1><p>로그인 요청이 만료되었거나 잘못되었습니다. 게임에서 다시 시도해 주세요.</p>`);
}
