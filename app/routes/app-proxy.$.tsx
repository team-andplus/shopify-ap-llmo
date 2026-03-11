import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { writeLlmoAccessLog } from "../lib/llmo-access-log.server";

/**
 * App Proxy: ストアの /apps/llmo/llms.txt 等にアクセスすると、
 * DB から該当ファイルの CDN URL を取得して 302 リダイレクトする。
 * メタフィールドは使わず、アプリの DB のみで完結する。
 * 通過時に log/llmo-access.log に 1 行追記（見える化・集計用）。
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) {
    return new Response("Missing shop", { status: 400 });
  }

  // パスは app-proxy/ の後ろ（例: llms.txt, llms.full.txt, docs/ai/README.md）
  const pathname = url.pathname;
  const idx = pathname.indexOf("app-proxy/");
  const path =
    idx >= 0
      ? pathname.slice(idx + "app-proxy/".length).replace(/\/$/, "")
      : pathname.replace(/^\/+/, "");

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  writeLlmoAccessLog(shop, path, request.headers.get("user-agent"), ip);

  // sitemap-ai.xml を生成して返す
  if (path === "sitemap-ai.xml") {
    const sitemapSettings = await prisma.llmoSettings.findUnique({
      where: { shop },
      select: {
        llmsTxtFileUrl: true,
        llmsFullTxtFileUrl: true,
        llmsFullTxtGeneratedAt: true,
        aiContextFileUrl: true,
        aiContextGeneratedAt: true,
        docsAiFiles: true,
        updatedAt: true,
      },
    });

    const shopUrl = `https://${shop}`;
    const urls: Array<{ loc: string; lastmod?: string }> = [];

    if (sitemapSettings?.llmsTxtFileUrl) {
      urls.push({
        loc: `${shopUrl}/llms.txt`,
        lastmod: sitemapSettings.updatedAt?.toISOString(),
      });
    }
    if (sitemapSettings?.llmsFullTxtFileUrl) {
      urls.push({
        loc: `${shopUrl}/llms.full.txt`,
        lastmod: sitemapSettings.llmsFullTxtGeneratedAt?.toISOString(),
      });
    }
    if (sitemapSettings?.aiContextFileUrl) {
      urls.push({
        loc: `${shopUrl}/.ai-context`,
        lastmod: sitemapSettings.aiContextGeneratedAt?.toISOString(),
      });
    }
    if (sitemapSettings?.docsAiFiles) {
      try {
        const arr = JSON.parse(sitemapSettings.docsAiFiles) as Array<{
          filename?: string;
          fileUrl?: string | null;
        }>;
        if (Array.isArray(arr)) {
          for (const doc of arr) {
            if (doc.filename && doc.fileUrl) {
              urls.push({
                loc: `${shopUrl}/docs/ai/${doc.filename}`,
                lastmod: sitemapSettings.updatedAt?.toISOString(),
              });
            }
          }
        }
      } catch {
        // ignore
      }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ""}
  </url>`
  )
  .join("\n")}
</urlset>`;

    return new Response(xml, {
      status: 200,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  }

  const settings = await prisma.llmoSettings.findUnique({
    where: { shop },
    select: {
      llmsTxtFileUrl: true,
      llmsFullTxtFileUrl: true,
      aiContextFileUrl: true,
      docsAiFiles: true,
    },
  });

  if (path === "llms.txt" && settings?.llmsTxtFileUrl) {
    return redirect(settings.llmsTxtFileUrl, 302);
  }

  if (path === "llms.full.txt" && settings?.llmsFullTxtFileUrl) {
    return redirect(settings.llmsFullTxtFileUrl, 302);
  }

  if (path === ".ai-context" && settings?.aiContextFileUrl) {
    return redirect(settings.aiContextFileUrl, 302);
  }

  if (path === "docs/ai/README.md" && settings?.docsAiFiles) {
    try {
      const arr = JSON.parse(settings.docsAiFiles) as Array<{
        filename?: string;
        fileUrl?: string | null;
      }>;
      const readme = Array.isArray(arr)
        ? arr.find((e) => e.filename === "README.md")
        : undefined;
      if (readme?.fileUrl) {
        return redirect(readme.fileUrl, 302);
      }
    } catch {
      // ignore
    }
    return new Response("Not found", { status: 404 });
  }

  return new Response("Not found", { status: 404 });
}
