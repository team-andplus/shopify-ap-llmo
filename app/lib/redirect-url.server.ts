/**
 * リダイレクト用のアプリベースURLを返す。
 */
export function getAppRedirectBase(request: Request): string {
  const appUrl = process.env.SHOPIFY_APP_URL?.trim();
  if (appUrl) {
    try {
      const u = new URL(appUrl);
      return `${u.origin}${u.pathname.replace(/\/?$/, "")}`;
    } catch {
      // invalid URL, fall through
    }
  }
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/?$/, "") || "";
  const basePath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const host = request.headers.get("X-Forwarded-Host") ?? request.headers.get("Host") ?? "";
  const proto = request.headers.get("X-Forwarded-Proto") ?? "https";
  return host ? `${proto}://${host}${basePath}` : basePath;
}
