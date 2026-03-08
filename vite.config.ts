import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

if (process.env.HOST) {
  const h = process.env.HOST;
  const port = process.env.PORT || "3000";
  if (h.startsWith("http://") || h.startsWith("https://")) {
    process.env.SHOPIFY_APP_URL = h;
  } else if (h === "127.0.0.1" || h === "localhost") {
    process.env.SHOPIFY_APP_URL = `http://${h}:${port}`;
  } else {
    process.env.SHOPIFY_APP_URL = `https://${h}`;
  }
  delete process.env.HOST;
}

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
const rawAppUrl = useProd ? defaultProdUrl : envUrl;
const appUrl =
  rawAppUrl.startsWith("http://") || rawAppUrl.startsWith("https://")
    ? rawAppUrl
    : `https://${rawAppUrl}`;
const host = new URL(appUrl).hostname;
const basePath = new URL(appUrl).pathname.replace(/\/?$/, "/");
const base = host !== "localhost" && basePath !== "/" ? basePath : "/";

let hmrConfig: { protocol: string; host: string; port: number; clientPort: number };
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT ?? "8002", 10),
    clientPort: 443,
  };
}

export default defineConfig({
  base,
  define: {
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: true,
    allowedHosts: ["localhost", "127.0.0.1", host].filter(
      (h, i, a) => a.indexOf(h) === i
    ),
    cors: { preflightContinue: true },
    port: Number(process.env.PORT || 3000),
    strictPort: true,
    hmr: hmrConfig,
    fs: { allow: ["app", "node_modules"] },
  },
  plugins: [reactRouter(), tsconfigPaths()],
  build: { assetsInlineLimit: 0 },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react"],
  },
}) satisfies UserConfig;
