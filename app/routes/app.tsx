import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  return { apiKey, shop: session?.shop ?? "" };
};

export default function AppLayout() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <nav style={{ padding: "1rem", borderBottom: "1px solid #e1e3e5" }}>
        <Link to="/app">AP LLMO</Link>
      </nav>
      <Outlet />
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
