import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

/**
 * Shopify 管理画面プロキシパスを basename 基準に正規化。
 * iframe では replaceState が効かないことがあるため、必要なら location.replace でフルナビする。
 * @returns リダイレクトした場合 true（このあとハイドレートしない）
 */
function normalizeLocationForRouter(): boolean {
  if (typeof window === "undefined") return false;
  const p = window.location.pathname;
  const appPath = "/andplus-apps/shopify-ap-llmo";
  if (p.indexOf(appPath) === -1 || p.indexOf(appPath) === 0) return false;
  const after = p.split(appPath)[1] ?? "/";
  const suffix = after.startsWith("/") ? after : `/${after}`;
  const path = (appPath + suffix).replace(/\/\/+/g, "/") || `${appPath}/`;
  const url = path + (window.location.search || "");
  window.location.replace(url);
  return true;
}

if (!normalizeLocationForRouter()) {
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <HydratedRouter />
      </StrictMode>,
    );
  });
}
