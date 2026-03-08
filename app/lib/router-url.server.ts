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
 * リクエスト URL が正規化すべきパス（/store/... や二重スラッシュ含む）なら、
 * 302 用の正規化済み URL を返す。不要なら null。
 */
export function getRedirectUrlIfUnnormalized(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  const pathname = url.pathname;
  if (!pathname.includes(APP_PATH)) return null;
  const normalized = normalizeRouterUrl(requestUrl);
  if (url.toString() === normalized) return null;
  return normalized;
}
