import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

export default function App() {
  return (
    <html lang="ja">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: [
              "(function(){",
              'var p=document.location.pathname,a="/andplus-apps/shopify-ap-llmo";',
              "if(p.indexOf(a)!==-1&&p.indexOf(a)!==0){",
              'var s=p.split(a)[1]||"/";',
              'if(s.charAt(0)!=\"/\")s=\"/\"+s;',
              'var n=(a+s).replace(/\\/\\/+/g,\"/\")||a+\"/\";',
              "document.location.replace(n+(document.location.search||\"\"));",
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
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
