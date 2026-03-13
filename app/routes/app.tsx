import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useLocation, useNavigate, useRouteError, redirect } from "react-router";
import { useEffect, useRef } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { getAppRedirectBase } from "../lib/redirect-url.server";
import { getLocaleFromRequest, getTranslations } from "../lib/i18n";

/** ブラウザのパス基準（basename 相当） */
const APP_PATH = "/andplus-apps/shopify-ap-llmo";

/**
 * ブラウザの実際の URL と React Router を同期する。
 * s-app-nav 等で URL だけ変わり描画が切り替わらない場合に、pathname+search で navigate し直す。
 * リロード直後は親が先にURLを変えることがあるため、マウント直後に短い間隔で複数回 sync する。
 */
function useUrlSync() {
  const location = useLocation();
  const navigate = useNavigate();
  const lastSynced = useRef<string>("");
  const locationRef = useRef(location.pathname + location.search);
  locationRef.current = location.pathname + location.search;

  useEffect(() => {
    function getWindowRouterPath(): string {
      if (typeof window === "undefined") return "";
      const p = window.location.pathname;
      const search = window.location.search || "";
      const pathAfterBase =
        p.startsWith(APP_PATH) && p.length > APP_PATH.length
          ? p.slice(APP_PATH.length) || "/"
          : p.startsWith(APP_PATH)
            ? "/"
            : p;
      const path = pathAfterBase.startsWith("/") ? pathAfterBase : `/${pathAfterBase}`;
      return path + search;
    }

    function syncFromWindow() {
      const windowPath = getWindowRouterPath();
      const routerPath = locationRef.current;
      if (windowPath && windowPath !== routerPath && windowPath !== lastSynced.current) {
        lastSynced.current = windowPath;
        navigate(windowPath, { replace: true });
      }
    }

    const handleNavigate = (e: Event) => {
      e.stopImmediatePropagation?.();
      const ev = e as CustomEvent<{ url?: string }> & { target?: { href?: string; getAttribute?(a: string): string | null } };
      const href =
        ev.detail?.url ??
        (typeof ev.target?.getAttribute === "function" ? ev.target.getAttribute("href") : null) ??
        ev.target?.href ??
        "";
      if (!href || href.startsWith("javascript:")) return;
      try {
        const url = href.startsWith("/") ? new URL(href, window.location.origin) : new URL(href);
        const pathAfterBase = url.pathname.startsWith(APP_PATH)
          ? url.pathname.slice(APP_PATH.length) || "/"
          : url.pathname;
        const path = pathAfterBase.startsWith("/") ? pathAfterBase : `/${pathAfterBase}`;
        const to = path + (url.search || "");
        if (to && to !== locationRef.current) {
          lastSynced.current = to;
          navigate(to, { replace: true });
        }
      } catch {
        if (href.startsWith("/") && href !== locationRef.current) {
          lastSynced.current = href;
          navigate(href, { replace: true });
        }
      }
    };

    syncFromWindow();
    const earlySyncDelays = [0, 80, 200, 500];
    const earlySyncIds = earlySyncDelays.map((ms) =>
      setTimeout(syncFromWindow, ms)
    );
    document.addEventListener("shopify:navigate", handleNavigate, true);
    const interval = setInterval(syncFromWindow, 250);
    return () => {
      earlySyncIds.forEach((id) => clearTimeout(id));
      document.removeEventListener("shopify:navigate", handleNavigate, true);
      clearInterval(interval);
    };
  }, [navigate]);
}

/** App Bridge Next が shop を読むために head に meta を出す（script より前に必要） */
export function meta({
  loaderData,
}: {
  loaderData: { apiKey?: string; shop?: string } | undefined;
}) {
  if (!loaderData?.apiKey) return [];
  return [
    { name: "shopify-api-key", content: loaderData.apiKey },
    ...(loaderData.shop
      ? [{ name: "shopify-shop", content: loaderData.shop } as const]
      : []),
  ];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  console.log("[ap-llmo] app layout loader:", url.pathname, shop ?? "");
  try {
    const { session } = await authenticate.admin(request);
    const apiKey = process.env.SHOPIFY_API_KEY ?? "";
    const sessionShop = session?.shop ?? "";
    const storeUrl = sessionShop ? `https://${sessionShop}` : "";
    const locale = getLocaleFromRequest(request);
    return { apiKey, shop: sessionShop, storeUrl, locale };
  } catch (err) {
    console.error("[ap-llmo] app layout loader error:", err);
    try {
      const base = getAppRedirectBase(request);
      const search = url.search;
      throw redirect(`${base}/auth${search ? (search.startsWith("?") ? search : `?${search}`) : shop ? `?shop=${shop}` : ""}`);
    } catch (redirectErr) {
      console.error("[ap-llmo] app layout redirect failed:", redirectErr);
      throw redirectErr;
    }
  }
};

export default function AppLayout() {
  const { apiKey, locale } = useLoaderData<typeof loader>();
  const location = useLocation();
  const t = getTranslations(locale);

  useUrlSync();

  const path = location.pathname || "/app";
  const search = location.search || "";
  const searchJa = new URLSearchParams(location.search);
  searchJa.set("locale", "ja");
  const searchEn = new URLSearchParams(location.search);
  searchEn.set("locale", "en");

  const base = APP_PATH || "";
  const nav = (
    <s-app-nav>
      <a href={`${base}/app${search}`} rel="home">{t.navHome}</a>
      <a href={`${base}/app/setup${search}`}>{t.navSetup}</a>
      <a href={`${base}/app/access-log${search}`}>{t.navAiVisibility}</a>
      <a href={`${base}/app/billing${search}`}>{t.navBilling}</a>
    </s-app-nav>
  );

  return (
    <AppProvider embedded apiKey={apiKey}>
      {nav}
      <Outlet />
      <footer
        style={{
          marginTop: "var(--p-space-800, 2rem)",
          padding: "var(--p-space-400, 1rem) var(--p-space-600, 1.5rem)",
          borderTop: "1px solid var(--p-color-border-secondary, #e1e3e5)",
          fontSize: "var(--p-font-size-200, 0.75rem)",
          color: "var(--p-color-text-secondary, #6d7175)",
        }}
      >
        <a href="https://www.andplus.co.jp/contact/work/" target="_blank" rel="noopener noreferrer" style={{ marginRight: "1rem" }}>
          {t.footerContact}
        </a>
        <a href="https://www.andplus.co.jp/privacy/" target="_blank" rel="noopener noreferrer" style={{ marginRight: "1rem" }}>
          {t.footerPrivacy}
        </a>
        <span style={{ marginLeft: "1rem" }}>
          <Link to={`${path}?${searchJa.toString()}`} style={{ marginRight: "0.5rem" }}>日本語</Link>
          <Link to={`${path}?${searchEn.toString()}`}>English</Link>
        </span>
      </footer>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
