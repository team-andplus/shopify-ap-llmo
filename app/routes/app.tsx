import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useLocation, useOutlet, useRouteError, redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { getAppRedirectBase } from "../lib/redirect-url.server";
import AppIndex from "./app._index";

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
    const shop = session?.shop ?? "";
    const storeUrl = shop ? `https://${shop}` : "";
    return { apiKey, shop, storeUrl };
  } catch (err) {
    console.error("[ap-llmo] app layout loader error:", err);
    // 認証失敗時は 403 ではなく /auth へリダイレクト（再ログインで解消するため）
    const base = getAppRedirectBase(request);
    const search = url.search;
    throw redirect(`${base}/auth${search ? (search.startsWith("?") ? search : `?${search}`) : shop ? `?shop=${shop}` : ""}`);
  }
};

export default function AppLayout() {
  const { apiKey } = useLoaderData<typeof loader>();
  const outlet = useOutlet();
  const location = useLocation();
  const isAppHome = /\/app\/?$/.test(location.pathname);
  const content = outlet ?? (isAppHome ? <AppIndex /> : null);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <nav style={{ padding: "1rem", borderBottom: "1px solid #e1e3e5" }}>
        <Link to="/app">AP LLMO</Link>
      </nav>
      {content}
      <footer
        style={{
          marginTop: "2rem",
          padding: "1rem",
          borderTop: "1px solid #e1e3e5",
          fontSize: "0.75rem",
          color: "#6d7175",
        }}
      >
        <a href="https://www.andplus.co.jp/contact/work/" target="_blank" rel="noopener noreferrer" style={{ marginRight: "1rem" }}>
          お問い合わせ
        </a>
        <a href="https://www.andplus.co.jp/privacy/" target="_blank" rel="noopener noreferrer">
          プライバシーポリシー
        </a>
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
