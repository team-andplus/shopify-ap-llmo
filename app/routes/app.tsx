import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useLocation, useOutlet, useRouteError, redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { getAppRedirectBase } from "../lib/redirect-url.server";
import { getLocaleFromRequest, getTranslations } from "../lib/i18n";

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
  const outlet = useOutlet();
  const t = getTranslations(locale);
  const content = outlet ?? (
    <div style={{ padding: "2rem", fontSize: "1.25rem" }}>てすとだよ</div>
  );

  const path = location.pathname || "/app";
  const search = location.search || "";
  const searchJa = new URLSearchParams(location.search);
  searchJa.set("locale", "ja");
  const searchEn = new URLSearchParams(location.search);
  searchEn.set("locale", "en");

  const nav = (
    <s-app-nav>
      <Link to={`/app${search}`} rel="home">{t.navHome}</Link>
      <Link to={`/app/setup${search}`}>{t.navSetup}</Link>
      <Link to={`/app/access-log${search}`}>{t.navAiVisibility}</Link>
      <Link to={`/app/billing${search}`}>{t.navBilling}</Link>
    </s-app-nav>
  );

  return (
    <AppProvider embedded apiKey={apiKey}>
      {nav}
      {content}
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
