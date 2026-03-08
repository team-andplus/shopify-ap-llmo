/**
 * Shopify 管理画面プロキシで /store/XXX/apps//andplus-apps/shopify-ap-llmo/ のような
 * パスで来た場合、React Router の basename と一致する URL に正規化する。
 */
const APP_PATH = "/andplus-apps/shopify-ap-llmo";

export function normalizeRouterUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  const pathname = url.pathname;
  if (!pathname.includes(APP_PATH)) return requestUrl;
  const after = pathname.split(APP_PATH)[1] ?? "/";
  const suffix = after.startsWith("/") ? after : `/${after}`;
  const normalizedPath = (APP_PATH + suffix).replace(/\/\/+/g, "/") || `${APP_PATH}/`;
  url.pathname = normalizedPath;
  return url.toString();
}

/**
 * 管理画面から開いたときのパス（/store/XXX/apps/ap-llmo など）を検出し、
 * 正規パス /andplus-apps/shopify-ap-llmo/ へのリダイレクト URL を返す。
 */
function getRedirectForAdminAppPath(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  const pathname = url.pathname;
  if (!pathname.includes("/apps/ap-llmo")) return null;
  const search = url.search ? `?${url.searchParams.toString()}` : "";
  const target = `${url.origin}/andplus-apps/shopify-ap-llmo/${search}`;
  return target;
}

/**
 * リクエスト URL が正規化すべきパス（/store/... や二重スラッシュ含む）なら、
 * 302 用の正規化済み URL を返す。不要なら null。
 */
export function getRedirectUrlIfUnnormalized(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  const pathname = url.pathname;

  if (!pathname.includes(APP_PATH)) {
    const adminRedirect = getRedirectForAdminAppPath(requestUrl);
    if (adminRedirect) return adminRedirect;
    return null;
  }
  const normalized = normalizeRouterUrl(requestUrl);
  if (url.toString() === normalized) return null;
  return normalized;
}
