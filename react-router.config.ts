import type { Config } from "@react-router/dev/config";

const appUrl = process.env.SHOPIFY_APP_URL || "http://localhost";
const host = new URL(appUrl).hostname;
const pathname = new URL(appUrl).pathname;
const basename = host !== "localhost" && pathname !== "/" ? pathname.replace(/\/?$/, "/") : "/";

export default {
  basename,
} satisfies Config;
