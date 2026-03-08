import type { Config } from "@react-router/dev/config";

// 未設定 / localhost / パスが "/" のときは本番 URL（サーバーで .env がパスなしでも basename が入る）
const defaultProdUrl = "https://apps.andplus.tech/andplus-apps/shopify-ap-llmo/";
const envUrl = process.env.SHOPIFY_APP_URL?.trim();
const useProd =
  !envUrl ||
  envUrl.includes("localhost") ||
  (() => {
    try {
      return new URL(envUrl).pathname.replace(/\/?$/, "") === "";
    } catch {
      return true;
    }
  })();
const appUrl = useProd ? defaultProdUrl : envUrl;
const host = new URL(appUrl).hostname;
const pathname = new URL(appUrl).pathname;
const basename = host !== "localhost" && pathname !== "/" ? pathname.replace(/\/?$/, "/") : "/";

export default {
  basename,
} satisfies Config;
