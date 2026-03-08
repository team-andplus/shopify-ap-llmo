import type { Config } from "@react-router/dev/config";

// 本番ビルドで SHOPIFY_APP_URL が渡らない環境（例: サーバーで npm run build）でも basename を埋めるため
const defaultProdUrl = "https://apps.andplus.tech/andplus-apps/shopify-ap-llmo/";
const appUrl =
  process.env.SHOPIFY_APP_URL ||
  (process.env.NODE_ENV === "production" ? defaultProdUrl : "http://localhost");
const host = new URL(appUrl).hostname;
const pathname = new URL(appUrl).pathname;
const basename = host !== "localhost" && pathname !== "/" ? pathname.replace(/\/?$/, "/") : "/";

export default {
  basename,
} satisfies Config;
