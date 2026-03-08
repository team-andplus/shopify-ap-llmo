import { useEffect } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

const APP_PATH = "/andplus-apps/shopify-ap-llmo";

/** ブラウザの location が /store/.../apps//... のままのときに正規化 URL へリダイレクト（entry.client のフォールバック） */
function ClientUrlNormalizer() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = window.location.pathname;
    if (p.includes("/apps/ap-llmo") && p.indexOf(APP_PATH) !== 0) {
      window.location.replace(`${APP_PATH}/${window.location.search || ""}`);
      return;
    }
    if (p.indexOf(APP_PATH) === -1 || p.indexOf(APP_PATH) === 0) return;
    const after = p.split(APP_PATH)[1] ?? "/";
    const suffix = after.startsWith("/") ? after : `/${after}`;
    const path = (APP_PATH + suffix).replace(/\/\/+/g, "/") || `${APP_PATH}/`;
    const url = path + (window.location.search || "");
    window.location.replace(url);
  }, []);
  return null;
}

export default function App() {
  return (
    <html lang="ja">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: [
              "(function(){",
              'var p=document.location.pathname,a="/andplus-apps/shopify-ap-llmo",q=document.location.search||"";',
              'if(p.indexOf("/apps/ap-llmo")!==-1&&p.indexOf(a)!==0){document.location.replace(a+"/"+q);return;}',
              "if(p.indexOf(a)!==-1&&p.indexOf(a)!==0){",
              'var s=p.split(a)[1]||"/";',
              'if(s.charAt(0)!=\"/\")s=\"/\"+s;',
              'var n=(a+s).replace(/\\/\\/+/g,\"/\")||a+\"/\";',
              "document.location.replace(n+q);",
              "}",
              "})();",
            ].join(""),
          }}
        />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
        <Links />
      </head>
      <body>
        <ClientUrlNormalizer />
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
