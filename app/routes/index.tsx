import type { CSSProperties } from "react";
import { getAppRedirectBase } from "../lib/redirect-url.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

const containerStyle: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: "2rem",
  boxSizing: "border-box",
  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
};

const cardStyle: CSSProperties = {
  maxWidth: "420px",
  padding: "2rem",
  textAlign: "center",
  color: "#202223",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const embedded = url.searchParams.get("embedded");
  if (shop) {
    const base = getAppRedirectBase(request);
    const search = url.searchParams.toString();
    if (embedded === "1") {
      throw redirect(`${base}/app${search ? `?${search}` : ""}`);
    }
    throw redirect(`${base}/auth${search ? `?${search}` : ""}`);
  }
  return null;
}

export default function Index() {
  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
          このアプリは Shopify 管理画面から開いてください
        </h1>
        <p style={{ fontSize: "0.9375rem", lineHeight: 1.6, color: "#6d7175" }}>
          LLMO アプリをご利用の場合は、Shopify 管理画面の「アプリ」一覧から本アプリを開いてください。
        </p>
      </div>
    </div>
  );
}
