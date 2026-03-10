/**
 * リダイレクト用のアプリベースURLを返す。
 * /app や /app/ で呼ばれたときは末尾の /app を除き、/auth へ正しくリダイレクトできるようにする。
 */
export function getAppRedirectBase(request: Request): string {
  const appUrl = process.env.SHOPIFY_APP_URL?.trim();
  if (appUrl) {
    try {
      const u = new URL(appUrl);
      let base = `${u.origin}${u.pathname.replace(/\/?$/, "")}`;
      if (base.endsWith("/app")) base = base.slice(0, -4);
      return base;
    } catch {
      // invalid URL, fall through
    }
  }
  const url = new URL(request.url);
  let pathname = url.pathname.replace(/\/?$/, "") || "";
  if (pathname.endsWith("/app")) pathname = pathname.slice(0, -4) || "/";
  const basePath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const host = request.headers.get("X-Forwarded-Host") ?? request.headers.get("Host") ?? "";
  const proto = request.headers.get("X-Forwarded-Proto") ?? "https";
  return host ? `${proto}://${host}${basePath}` : basePath;
}
