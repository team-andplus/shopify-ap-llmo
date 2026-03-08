/**
 * Shopify 管理画面プロキシパスを basename 基準に正規化。
 * バンドル実行の最初に実行し、React Router が window.location を読む前に URL を揃える。
 */
function normalizeLocationForRouter() {
  if (typeof window === "undefined") return;
  const p = window.location.pathname;
  const appPath = "/andplus-apps/shopify-ap-llmo";
  if (p.indexOf(appPath) === -1 || p.indexOf(appPath) === 0) return;
  const after = p.split(appPath)[1] ?? "/";
  const suffix = after.startsWith("/") ? after : `/${after}`;
  const path = (appPath + suffix).replace(/\/\/+/g, "/") || `${appPath}/`;
  const url = path + (window.location.search || "");
  window.history.replaceState(null, "", url);
}

normalizeLocationForRouter();

import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
