import type { Config } from "@react-router/dev/config";

// npm run build 時に SHOPIFY_APP_URL が渡らない環境（例: サーバー）でも basename を埋めるため
const defaultProdUrl = "https://apps.andplus.tech/andplus-apps/shopify-ap-llmo/";
const isBuild = process.env.npm_lifecycle_event === "build";
const appUrl =
  process.env.SHOPIFY_APP_URL ||
  (isBuild ? defaultProdUrl : "http://localhost");
const host = new URL(appUrl).hostname;
const pathname = new URL(appUrl).pathname;
const basename = host !== "localhost" && pathname !== "/" ? pathname.replace(/\/?$/, "/") : "/";

export default {
  basename,
} satisfies Config;
