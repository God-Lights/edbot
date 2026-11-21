// SideStore(AltStore 호환) 소스. SideStore에서 "소스 추가"에 이 서버의 /sidestore.json 주소를 넣으면
// COMMANDER iPad 앱이 목록에 나타나고 업데이트도 알려 준다.
// 앱 파일(.ipa)은 GitHub 릴리스(태그 ios-vX.Y.Z)에서 받는다. 서버는 릴리스 목록만 읽어서 소스를 만든다.

export const IOS_TAG_PREFIX = "ios-v";
export const BUNDLE_ID = "com.officialgl.commander";
/** 릴리스에 아이콘이 없을 때 쓰는 주소. SideStore는 빈 문자열을 잘못된 URL로 보고 소스 추가를 거부한다. */
export const FALLBACK_ICON_URL =
  "https://raw.githubusercontent.com/God-Lights/edbot/main/ios/EdbotApp/Assets.xcassets/AppIcon.appiconset/icon-1024.png";
const IPA_NAME = "Commander.ipa";
const ICON_NAME = "icon.png";

export interface GithubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface GithubRelease {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  body?: string | null;
  assets?: GithubAsset[];
}

export interface SideStoreVersion {
  version: string;
  buildVersion: string;
  date: string;
  downloadURL: string;
  size: number;
  minOSVersion: string;
  localizedDescription: string;
}

/** 소스에 올릴 수 있는 릴리스(공개된 ios-v* 태그 + .ipa 첨부)를 새것부터 골라 버전 정보로 바꾼다. */
export function versionsFromReleases(releases: GithubRelease[]): { versions: SideStoreVersion[]; iconURL: string | null } {
  const usable = releases
    .filter((r) => !r.draft && r.tag_name.startsWith(IOS_TAG_PREFIX))
    .map((r) => ({ release: r, ipa: r.assets?.find((a) => a.name === IPA_NAME) }))
    .filter((x): x is { release: GithubRelease; ipa: GithubAsset } => x.ipa !== undefined)
    .sort((a, b) => Date.parse(b.release.published_at ?? "") - Date.parse(a.release.published_at ?? ""));

  const versions = usable.map(({ release, ipa }) => {
    const version = release.tag_name.slice(IOS_TAG_PREFIX.length);
    return {
      version,
      buildVersion: version,
      date: release.published_at ?? new Date(0).toISOString(),
      downloadURL: ipa.browser_download_url,
      size: ipa.size,
      minOSVersion: "17.0",
      localizedDescription: (release.body ?? "").trim() || `COMMANDER ${version}`,
    };
  });
  const iconAsset = usable.flatMap((x) => x.release.assets ?? []).find((a) => a.name === ICON_NAME);
  return { versions, iconURL: iconAsset?.browser_download_url ?? null };
}

/** AltStore 소스 형식(v1)의 JSON. 옛 SideStore를 위해 최신 버전을 앱 최상위에도 적는다. */
export function buildSource(releases: GithubRelease[], sourceURL: string): unknown {
  const { versions, iconURL } = versionsFromReleases(releases);
  const latest = versions[0];
  const icon = iconURL ?? FALLBACK_ICON_URL;
  return {
    name: "COMMANDER",
    identifier: `${BUNDLE_ID}.source`,
    subtitle: "COMMANDER iPad 앱",
    description: "COMMANDER iPad 앱을 SideStore로 설치하고 업데이트합니다.",
    iconURL: icon,
    website: "https://edgame-api.officialgl.com",
    tintColor: "B040BE",
    sourceURL,
    // 릴리스가 아직 없으면 앱을 싣지 않는다. 다운로드 주소가 없는 앱은 SideStore가 소스를 거부할 수 있다.
    apps: !latest ? [] : [
      {
        name: "COMMANDER",
        bundleIdentifier: BUNDLE_ID,
        developerName: "God Lights",
        subtitle: "2인 실시간 전략 대전",
        localizedDescription:
          "캐릭터 12명 중 5명을 뽑아 세 레인에 보내고, 타워를 부수며 싸우는 2인 실시간 전략 대전 게임입니다.",
        iconURL: icon,
        tintColor: "B040BE",
        screenshotURLs: [],
        version: latest.version,
        versionDate: latest.date,
        versionDescription: latest.localizedDescription,
        downloadURL: latest.downloadURL,
        size: latest.size,
        versions,
        appPermissions: { entitlements: [], privacy: {} },
      },
    ],
    news: [],
  };
}

/** 릴리스 때 워크플로가 올려 두는 소스 파일의 주소(고정). GitHub API가 아니라 일반 다운로드라서 호출 한도가 없다. */
export const SOURCE_ASSET_URL = "https://github.com/God-Lights/edbot/releases/download/sidestore-source/sidestore.json";

export type SourceResult = { ok: true; body: string } | { ok: false };

/**
 * 서버가 내보낼 소스 JSON을 가져온다.
 * - 워크플로가 올린 sidestore.json이 있으면 그대로 쓴다. (정확한 용량과 날짜가 들어 있다)
 * - 아직 올린 적이 없으면(404) 앱이 없는 빈 소스를 만든다.
 * - 그 밖의 오류나 깨진 JSON은 실패로 본다.
 *
 * GitHub API(api.github.com)를 쓰지 않는 이유: Cloudflare Workers의 공유 IP에서는
 * 비로그인 호출 한도(시간당 60회)를 금방 넘겨서 403이 난다.
 */
export async function loadSourceJson(
  sourceURL: string,
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<SourceResult> {
  try {
    const res = await fetcher(SOURCE_ASSET_URL, { headers: { "user-agent": "commander-server" }, redirect: "follow" });
    if (res.status === 404) return { ok: true, body: JSON.stringify(buildSource([], sourceURL)) };
    if (!res.ok) return { ok: false };
    const body = await res.text();
    JSON.parse(body); // 깨진 파일을 SideStore에 넘기지 않는다
    return { ok: true, body };
  } catch {
    return { ok: false };
  }
}
