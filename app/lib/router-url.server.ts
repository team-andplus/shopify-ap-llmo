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
