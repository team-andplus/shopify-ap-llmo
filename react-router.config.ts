import type { Config } from "@react-router/dev/config";

// SHOPIFY_APP_URL 未設定 or localhost のときは本番 URL（サーバーで .env が localhost でも basename が入る）
const defaultProdUrl = "https://apps.andplus.tech/andplus-apps/shopify-ap-llmo/";
const envUrl = process.env.SHOPIFY_APP_URL?.trim();
const appUrl =
  envUrl && !envUrl.includes("localhost") ? envUrl : defaultProdUrl;
const host = new URL(appUrl).hostname;
const pathname = new URL(appUrl).pathname;
const basename = host !== "localhost" && pathname !== "/" ? pathname.replace(/\/?$/, "/") : "/";

export default {
  basename,
} satisfies Config;
