import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useFetcher } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { type DocsAiFileEntry } from "../lib/llmo-files.server";
import { getTranslations, getLocaleFromRequest } from "../lib/i18n";
import { runDailyJobManually } from "../lib/cron.server";
import { readAndAggregateLlmoAccessLog } from "../lib/llmo-access-log.server";

function parseDocsAiFromSettings(json: string | null): DocsAiFileEntry[] {
  if (!json?.trim()) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is DocsAiFileEntry => x && typeof x === "object" && "filename" in x)
      .map((x) => ({
        filename: String(x.filename ?? ""),
        content: String(x.content ?? ""),
        fileId: x.fileId ?? null,
        fileUrl: x.fileUrl ?? null,
      }));
  } catch {
    return [];
  }
}

const emptySettings = {
  siteType: "",
  title: "",
  roleSummary: "",
  sectionsOutline: "",
  notesForAi: "",
  llmsTxtBody: "",
  llmsTxtFileUrl: "",
  llmsFullTxtFileUrl: "",
  llmsFullTxtGeneratedAt: null as string | null,
  aiContextBody: "",
  aiContextFileUrl: "",
  aiContextGeneratedAt: null as string | null,
  docsAiFiles: [] as DocsAiFileEntry[],
  openaiApiKeySet: false,
  reportEmail: "",
  reportEnabled: false,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shop = session?.shop ?? "";
    const storeUrl = shop ? `https://${shop}` : "";
    const locale = getLocaleFromRequest(request);

    // トライアル・課金状態をチェック
    const { syncTrialAndAccess } = await import("../lib/trial.server");
    const trialInfo = await syncTrialAndAccess(admin, shop);

    // openaiApiKey 列がまだない DB でも動くよう、select で列を限定（openaiApiKey は参照しない）
    const settings = shop
      ? await prisma.llmoSettings.findUnique({
          where: { shop },
          select: {
            siteType: true,
            title: true,
            roleSummary: true,
            sectionsOutline: true,
            notesForAi: true,
            llmsTxtBody: true,
            llmsTxtFileUrl: true,
            llmsFullTxtFileUrl: true,
            llmsFullTxtGeneratedAt: true,
            aiContextBody: true,
            aiContextFileUrl: true,
            aiContextGeneratedAt: true,
            docsAiFiles: true,
            reportEmail: true,
            reportEnabled: true,
          },
        })
      : null;

    // API Key が設定済みかだけ別途取得（列がなければ false、値は返さない）
    let openaiApiKeySet = false;
    if (shop) {
      try {
        const rows = await prisma.$queryRawUnsafe<{ openaiApiKey: string | null }[]>(
          "SELECT `openaiApiKey` FROM `LlmoSettings` WHERE shop = ? LIMIT 1",
          shop
        );
        const val = rows[0]?.openaiApiKey;
        openaiApiKeySet = typeof val === "string" && val.length > 0;
      } catch {
        openaiApiKeySet = false;
      }
    }

    const docsAiFiles = parseDocsAiFromSettings(settings?.docsAiFiles ?? null);

    // ユーザーの locale を DB に保存（週次レポートで使用）
    if (shop) {
      prisma.llmoSettings.upsert({
        where: { shop },
        create: { shop, locale },
        update: { locale },
      }).catch(() => {}); // エラーは無視（バックグラウンドで実行）
    }

    // AI Visibility 用: AI ボットアクセス集計（直近7日間固定・サイドバー表示用）
    let aiVisibility = { aiBotTotal: 0, aiBotByService: {} as Record<string, number> };
    try {
      const logData = await readAndAggregateLlmoAccessLog(shop, "7d");
      aiVisibility = {
        aiBotTotal: logData.aiBotTotal,
        aiBotByService: logData.aiBotByService,
      };
    } catch {
      // ログファイルがない場合は空のまま
    }

    return {
      storeUrl,
      locale,
      t: getTranslations(locale),
      trialInfo,
      aiVisibility,
      settings: settings
        ? {
            siteType: settings.siteType ?? "",
            title: settings.title ?? "",
            roleSummary: settings.roleSummary ?? "",
            sectionsOutline: settings.sectionsOutline ?? "",
            notesForAi: settings.notesForAi ?? "",
            llmsTxtBody: settings.llmsTxtBody ?? "",
            llmsTxtFileUrl: settings.llmsTxtFileUrl ?? "",
            llmsFullTxtFileUrl: settings.llmsFullTxtFileUrl ?? "",
            llmsFullTxtGeneratedAt: settings.llmsFullTxtGeneratedAt?.toISOString() ?? null,
            aiContextBody: settings.aiContextBody ?? "",
            aiContextFileUrl: settings.aiContextFileUrl ?? "",
            aiContextGeneratedAt: settings.aiContextGeneratedAt?.toISOString() ?? null,
            docsAiFiles,
            openaiApiKeySet,
            reportEmail: settings.reportEmail ?? "",
            reportEnabled: settings.reportEnabled ?? false,
          }
        : emptySettings,
      loaderError: null as string | null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ap-llmo] app._index loader error:", err);
    const locale = getLocaleFromRequest(request);
    return {
      storeUrl: "",
      locale,
      t: getTranslations(locale),
      trialInfo: { hasAccess: true, trialEndsAt: "", isSubscribed: false, isTrialActive: false, daysRemaining: 0 },
      aiVisibility: { aiBotTotal: 0, aiBotByService: {} as Record<string, number> },
      settings: emptySettings,
      loaderError: message,
    };
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  if (!shop) {
    return Response.json({ error: "No shop" }, { status: 400 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string | null;

  // 定時処理を手動実行
  if (intent === "runCronJob") {
    try {
      const result = await runDailyJobManually();
      return Response.json({ ok: result.success, message: result.message });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ap-llmo] runCronJob error:", err);
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  }

  // レポート設定を保存
  if (intent === "saveReportSettings") {
    try {
      const reportEmail = (formData.get("reportEmail") as string)?.trim() ?? "";
      const reportEnabled = formData.get("reportEnabled") === "true";

      await prisma.llmoSettings.upsert({
        where: { shop },
        create: { shop, reportEmail: reportEmail || null, reportEnabled },
        update: { reportEmail: reportEmail || null, reportEnabled },
      });

      return Response.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ap-llmo] saveReportSettings error:", err);
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  }

  // テストメール送信
  if (intent === "testEmail") {
    try {
      const { sendEmail } = await import("../lib/email.server");
      const testEmail = (formData.get("testEmail") as string)?.trim();
      if (!testEmail) {
        return Response.json({ ok: false, error: "Email address required" }, { status: 400 });
      }
      const locale = getLocaleFromRequest(request);
      const isJa = locale === "ja";
      const result = await sendEmail({
        to: testEmail,
        subject: isJa ? "[AP LLMO] テストメール" : "[AP LLMO] Test Email",
        html: isJa
          ? `
            <h1>テストメール</h1>
            <p>AP LLMO からのメール送信テストです。</p>
            <p>このメールが届いていれば、SMTP 設定は正常です。</p>
            <p>Store: ${shop}</p>
            <p>Time: ${new Date().toISOString()}</p>
          `
          : `
            <h1>Test Email</h1>
            <p>This is a test email from AP LLMO.</p>
            <p>If you received this email, your SMTP settings are working correctly.</p>
            <p>Store: ${shop}</p>
            <p>Time: ${new Date().toISOString()}</p>
          `,
      });
      return Response.json({ ok: result.success, error: result.error });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ap-llmo] testEmail error:", err);
      return Response.json({ ok: false, error: message }, { status: 500 });
    }
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

const sectionStyle = {
  marginTop: "1.5rem",
  padding: "1rem 1.25rem",
  background: "#f6f6f7",
  borderRadius: "8px",
  fontSize: "0.9375rem",
  lineHeight: 1.7,
} as const;

const listStyle = { margin: 0, paddingLeft: "1.25rem" } as const;

const inputStyle = {
  display: "block",
  width: "100%",
  maxWidth: "480px",
  minWidth: 0,
  boxSizing: "border-box" as const,
  marginTop: "0.25rem",
  padding: "0.5rem 0.75rem",
  border: "1px solid #c9cccf",
  borderRadius: "6px",
  fontSize: "0.9375rem",
} as const;

const labelStyle = { display: "block", marginTop: "1rem", fontWeight: 600, fontSize: "0.875rem" };

export default function AppIndex() {
  const data = useLoaderData<Awaited<ReturnType<typeof loader>>>();
  const t = data.t;
  const fetcher = useFetcher<{ ok?: boolean; error?: string; message?: string }>();
  const lastIntent = (fetcher.formData as FormData | undefined)?.get("intent");
  const isRunningCronJob = fetcher.state !== "idle" && lastIntent === "runCronJob";
  const isSavingReport = fetcher.state !== "idle" && lastIntent === "saveReportSettings";
  const isSendingTestEmail = fetcher.state !== "idle" && lastIntent === "testEmail";
  const cronJobResult =
    lastIntent === "runCronJob"
      ? (fetcher.data as { ok?: boolean; error?: string; message?: string } | undefined)
      : null;
  const reportResult =
    lastIntent === "saveReportSettings"
      ? (fetcher.data as { ok?: boolean; error?: string } | undefined)
      : null;
  const testEmailResult =
    lastIntent === "testEmail"
      ? (fetcher.data as { ok?: boolean; error?: string } | undefined)
      : null;

  const [reportEmail, setReportEmail] = useState(data.settings.reportEmail);
  const [reportEnabled, setReportEnabled] = useState(data.settings.reportEnabled);

  const docsAiCount = data.settings.docsAiFiles?.length ?? 0;
  const loaderError = (data as { loaderError?: string | null }).loaderError;

  const isAnyLoading = isSavingReport || isSendingTestEmail || isRunningCronJob;

  return (
    <div
      className="app-home-grid"
      style={{
        padding: "2rem",
        display: "grid",
        gridTemplateColumns: "1fr minmax(260px, 320px)",
        gap: "2rem",
        alignItems: "start",
        maxWidth: "1200px",
      }}
    >
      <style>{`
        @media (max-width: 900px) { .app-home-grid { grid-template-columns: 1fr !important; } }
        @keyframes ap-llmo-spin { to { transform: rotate(360deg); } }
      `}</style>

      {isAnyLoading && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0, 0, 0, 0.5)",
          }}
        >
          <div
            style={{
              width: "3rem",
              height: "3rem",
              border: "4px solid rgba(255, 255, 255, 0.3)",
              borderTopColor: "#fff",
              borderRadius: "50%",
              animation: "ap-llmo-spin 0.7s linear infinite",
            }}
            aria-label="Loading"
          />
        </div>
      )}

      <main style={{ minWidth: 0 }}>
      {loaderError && (
        <p style={{ padding: "1rem", marginBottom: "1rem", background: "#fef2f2", color: "#b91c1c", borderRadius: "8px", fontSize: "0.9375rem" }}>
          {t.error}: {loaderError}
        </p>
      )}
      {/* ヒーロー: なんのためのアプリか・訴求 */}
      <header style={{ marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.75rem", marginBottom: "0.75rem", fontWeight: 700, color: "#1a1a1a" }}>
          {t.appTitle}
        </h1>
        <p style={{ color: "#1a1a1a", fontSize: "1.0625rem", marginBottom: "0.5rem", lineHeight: 1.6, fontWeight: 500 }}>
          {t.appHeroWhy}
        </p>
        <p style={{ color: "#4a4a4a", fontSize: "0.9375rem", lineHeight: 1.6 }}>
          {t.appHeroHow}
        </p>
      </header>

      {/* 思想: トップに置いてアプリの価値観を伝える */}
      <section
        style={{
          ...sectionStyle,
          marginTop: "0.5rem",
          borderLeft: "4px solid #2c6ecb",
          background: "#f0f4fa",
        }}
      >
        <h2 style={{ fontSize: "1.0625rem", fontWeight: 700, marginBottom: "0.5rem", color: "#1a1a1a" }}>
          {t.philosophyTitle}
        </h2>
        <p style={{ margin: 0, fontSize: "0.9375rem", lineHeight: 1.75, color: "#333" }}>
          {(() => {
            const boldPhrase = data.locale === "en" ? "don't let it tell lies" : "嘘をつかせない";
            const parts = t.philosophyBody.split(boldPhrase);
            return (
              <>
                {parts[0]}
                <strong style={{ color: "#1a1a1a" }}>{boldPhrase}</strong>
                {parts[1] ?? ""}
              </>
            );
          })()}
        </p>
        <p style={{ margin: "0.75rem 0 0 0", fontSize: "0.8125rem", color: "#6d7175", lineHeight: 1.6 }}>
          {t.philosophyNote}{" "}
          <a href="https://www.andplus.co.jp/llms.txt" target="_blank" rel="noopener noreferrer" style={{ color: "#2c6ecb", textDecoration: "underline" }}>
            {t.andplusLlmsRef}
          </a>
        </p>
      </section>

      {/* AI Visibility */}
      <section
        style={{
          ...sectionStyle,
          background: data.aiVisibility.aiBotTotal > 0 ? "#e8f5e9" : "#f5f5f5",
          borderLeft: data.aiVisibility.aiBotTotal > 0 ? "4px solid #4caf50" : "4px solid #9e9e9e",
        }}
      >
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.5rem", color: data.aiVisibility.aiBotTotal > 0 ? "#2e7d32" : "#666" }}>
          {data.aiVisibility.aiBotTotal > 0 ? "🤖 " : ""}{t.aiVisibilityTitle}
        </h2>
        {data.aiVisibility.aiBotTotal > 0 ? (
          <>
            <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem", color: "#2e7d32", fontWeight: 600 }}>
              {t.aiVisibilityDesc}
            </p>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <span style={{ fontSize: "2rem", fontWeight: 700, color: "#2e7d32" }}>{data.aiVisibility.aiBotTotal}</span>
              <span style={{ fontSize: "0.875rem", color: "#666" }}>{t.aiVisitsTotal}</span>
            </div>
            {Object.entries(data.aiVisibility.aiBotByService).length > 0 && (
              <div style={{ marginBottom: "0.75rem" }}>
                {Object.entries(data.aiVisibility.aiBotByService)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([service, count]) => (
                    <div key={service} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", color: "#555", padding: "0.125rem 0" }}>
                      <span>{service}</span>
                      <span style={{ fontWeight: 600 }}>{count}</span>
                    </div>
                  ))}
              </div>
            )}
            <Link
              to="access-log"
              style={{ display: "inline-block", fontSize: "0.8125rem", color: "#2e7d32", textDecoration: "underline" }}
            >
              {t.viewDetails} →
            </Link>
          </>
        ) : (
          <>
            <p style={{ margin: "0 0 0.25rem 0", fontSize: "0.875rem", color: "#666" }}>
              {t.noAiVisitsYet}
            </p>
            <p style={{ margin: 0, fontSize: "0.75rem", color: "#999" }}>
              {t.noAiVisitsHint}
            </p>
          </>
        )}
      </section>

      {/* 生成されたファイルと状態 */}
      <section style={{ ...sectionStyle, background: "#f0f9ff", borderLeft: "4px solid #3b82f6" }}>
        <h2 style={{ fontSize: "1.0625rem", fontWeight: 700, marginBottom: "0.75rem", color: "#1a1a1a" }}>
          {t.generatedFilesTitle}
        </h2>
        <p style={{ margin: "0 0 1rem 0", fontSize: "0.8125rem", color: "#6d7175", lineHeight: 1.5 }}>
          {t.generatedFilesDesc}
        </p>
        <div style={{ fontSize: "0.8125rem", lineHeight: 2 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.25rem" }}>
            <span style={{ fontWeight: 600 }}>llms.txt</span>
            {data.settings.llmsTxtFileUrl ? (
              <a href={`${data.storeUrl}/llms.txt`} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", fontSize: "0.8125rem" }}>
                {data.storeUrl}/llms.txt ↗
              </a>
            ) : (
              <span style={{ color: "#9ca3af", fontSize: "0.8125rem" }}>{t.fileNotGenerated}</span>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.25rem" }}>
            <span style={{ fontWeight: 600 }}>llms.full.txt</span>
            {data.settings.llmsFullTxtFileUrl ? (
              <a href={`${data.storeUrl}/llms.full.txt`} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", fontSize: "0.8125rem" }}>
                {data.storeUrl}/llms.full.txt ↗
              </a>
            ) : (
              <span style={{ color: "#9ca3af", fontSize: "0.8125rem" }}>{t.fileNotGenerated}</span>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.25rem" }}>
            <span style={{ fontWeight: 600 }}>.ai-context</span>
            {data.settings.aiContextFileUrl ? (
              <a href={`${data.storeUrl}/.ai-context`} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", fontSize: "0.8125rem" }}>
                {data.storeUrl}/.ai-context ↗
              </a>
            ) : (
              <span style={{ color: "#9ca3af", fontSize: "0.8125rem" }}>{t.fileNotGenerated}</span>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.25rem" }}>
            <span style={{ fontWeight: 600 }}>docs/ai</span>
            {docsAiCount > 0 ? (
              <a href={`${data.storeUrl}/docs/ai/README.md`} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", fontSize: "0.8125rem" }}>
                {data.storeUrl}/docs/ai/ ↗
              </a>
            ) : (
              <span style={{ color: "#9ca3af", fontSize: "0.8125rem" }}>{t.fileNotGenerated}</span>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.25rem" }}>
            <span style={{ fontWeight: 600 }}>sitemap-ai.xml</span>
            <a href={`${data.storeUrl}/sitemap-ai.xml`} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", fontSize: "0.8125rem" }}>
              {data.storeUrl}/sitemap-ai.xml ↗
            </a>
          </div>
        </div>
      </section>
      </main>

      <aside style={{ position: "sticky", top: "1rem" }}>
        {/* トライアル・課金バナー */}
        {data.trialInfo.isTrialActive && (
          <section style={{ ...sectionStyle, background: "#fef3c7", borderLeft: "3px solid #f59e0b", marginTop: 0 }}>
            <p style={{ margin: 0, fontWeight: 600, color: "#92400e", fontSize: "0.875rem" }}>
              {data.locale === "ja"
                ? `🎁 無料トライアル中（残り ${data.trialInfo.daysRemaining} 日）`
                : `🎁 Free trial (${data.trialInfo.daysRemaining} days left)`}
            </p>
            <Link
              to="/app/billing"
              style={{ display: "inline-block", marginTop: "0.5rem", fontSize: "0.8125rem", color: "#92400e", textDecoration: "underline" }}
            >
              {data.locale === "ja" ? "Pro プランを見る" : "View Pro Plan"}
            </Link>
          </section>
        )}
        {!data.trialInfo.hasAccess && !data.trialInfo.isSubscribed && (
          <section style={{ ...sectionStyle, background: "#fee2e2", borderLeft: "3px solid #ef4444", marginTop: 0 }}>
            <p style={{ margin: 0, fontWeight: 600, color: "#b91c1c", fontSize: "0.875rem" }}>
              {data.locale === "ja" ? "⚠️ トライアル終了" : "⚠️ Trial ended"}
            </p>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "#b91c1c" }}>
              {data.locale === "ja"
                ? "一部機能が制限されています。"
                : "Some features are restricted."}
            </p>
            <Link
              to="/app/billing"
              style={{ display: "inline-block", marginTop: "0.5rem", padding: "0.375rem 0.75rem", fontSize: "0.8125rem", color: "#fff", background: "#ef4444", borderRadius: "6px", textDecoration: "none" }}
            >
              {data.locale === "ja" ? "Pro プランにアップグレード" : "Upgrade to Pro"}
            </Link>
          </section>
        )}
        {data.trialInfo.isSubscribed && (
          <section style={{ ...sectionStyle, background: "#dcfce7", borderLeft: "3px solid #22c55e", marginTop: 0 }}>
            <p style={{ margin: 0, fontWeight: 600, color: "#166534", fontSize: "0.875rem" }}>
              ✓ {data.locale === "ja" ? "Pro プラン" : "Pro Plan"}
            </p>
          </section>
        )}

        <section style={{ ...sectionStyle, background: "#f0fdf4", borderLeft: "3px solid #22c55e" }}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            {data.locale === "ja" ? "週次レポート" : "Weekly Report"}
          </h2>
          <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.8125rem", color: "#6d7175", lineHeight: 1.5 }}>
            {data.locale === "ja"
              ? "AI Bot のアクセス状況をメールで受け取れます。毎週月曜 9:00 (JST) に送信されます。"
              : "Receive AI bot access reports via email. Sent every Monday at 9:00 AM (JST)."}
          </p>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={reportEnabled}
                onChange={(e) => setReportEnabled(e.target.checked)}
                style={{ width: "1rem", height: "1rem" }}
              />
              {data.locale === "ja" ? "週次レポートを受け取る" : "Receive weekly report"}
            </label>
          </div>
          {reportEnabled && (
            <div style={{ marginBottom: "0.75rem", minWidth: 0 }}>
              <label style={{ fontSize: "0.8125rem", color: "#6d7175", display: "block" }}>
                {data.locale === "ja" ? "送信先メールアドレス" : "Email address"}
              </label>
              <input
                type="email"
                value={reportEmail}
                onChange={(e) => setReportEmail(e.target.value)}
                placeholder="you@example.com"
                style={{
                  ...inputStyle,
                  marginTop: "0.25rem",
                }}
              />
            </div>
          )}
          <button
            type="button"
            disabled={isSavingReport}
            onClick={() => {
              fetcher.submit(
                { intent: "saveReportSettings", reportEmail, reportEnabled: String(reportEnabled) },
                { method: "post" }
              );
            }}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              border: "1px solid #22c55e",
              background: isSavingReport ? "#dcfce7" : "#fff",
              color: "#166534",
              cursor: isSavingReport ? "wait" : "pointer",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            {isSavingReport
              ? (data.locale === "ja" ? "保存中..." : "Saving...")
              : (data.locale === "ja" ? "設定を保存" : "Save Settings")}
          </button>
          {reportResult?.ok && (
            <p style={{ marginTop: "0.5rem", color: "#15803d", fontSize: "0.8125rem" }}>
              ✓ {data.locale === "ja" ? "保存しました" : "Saved"}
            </p>
          )}
          {reportResult && !reportResult.ok && (
            <p style={{ marginTop: "0.5rem", color: "#b91c1c", fontSize: "0.8125rem" }}>
              {t.error}: {reportResult.error}
            </p>
          )}
          {reportEnabled && reportEmail && (
            <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #d1d5db" }}>
              <button
                type="button"
                disabled={isSendingTestEmail}
                onClick={() => {
                  fetcher.submit(
                    { intent: "testEmail", testEmail: reportEmail },
                    { method: "post" }
                  );
                }}
                style={{
                  padding: "0.375rem 0.75rem",
                  borderRadius: "6px",
                  border: "1px solid #9ca3af",
                  background: isSendingTestEmail ? "#f3f4f6" : "#fff",
                  color: "#374151",
                  cursor: isSendingTestEmail ? "wait" : "pointer",
                  fontSize: "0.8125rem",
                }}
              >
                {isSendingTestEmail
                  ? (data.locale === "ja" ? "送信中..." : "Sending...")
                  : (data.locale === "ja" ? "テストメール送信" : "Send Test Email")}
              </button>
              {testEmailResult?.ok && (
                <p style={{ marginTop: "0.5rem", color: "#15803d", fontSize: "0.8125rem" }}>
                  ✓ {data.locale === "ja" ? "送信しました" : "Sent"}
                </p>
              )}
              {testEmailResult && !testEmailResult.ok && (
                <p style={{ marginTop: "0.5rem", color: "#b91c1c", fontSize: "0.8125rem" }}>
                  {t.error}: {testEmailResult.error}
                </p>
              )}
            </div>
          )}
        </section>

        <section style={{ ...sectionStyle, background: "#fef9e7", borderLeft: "3px solid #f59e0b" }}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            {data.locale === "ja" ? "開発者向け" : "Developer"}
          </h2>
          <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.8125rem", color: "#6d7175", lineHeight: 1.5 }}>
            {data.locale === "ja"
              ? "定時処理（llms.full.txt 再生成 + ログローテーション）を手動で実行します。"
              : "Manually run the daily job (regenerate llms.full.txt + log rotation)."}
          </p>
          <button
            type="button"
            disabled={isRunningCronJob}
            onClick={() => {
              const confirmed = window.confirm(
                data.locale === "ja"
                  ? "定時処理を今すぐ実行しますか？\n\n全ストアの llms.full.txt が再生成されます。"
                  : "Run the daily job now?\n\nThis will regenerate llms.full.txt for all stores."
              );
              if (!confirmed) return;
              fetcher.submit({ intent: "runCronJob" }, { method: "post" });
            }}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              border: "1px solid #f59e0b",
              background: isRunningCronJob ? "#fef3c7" : "#fff",
              color: "#92400e",
              cursor: isRunningCronJob ? "wait" : "pointer",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            {isRunningCronJob
              ? (data.locale === "ja" ? "実行中..." : "Running...")
              : (data.locale === "ja" ? "定時処理を実行" : "Run Daily Job")}
          </button>
          {cronJobResult?.ok && (
            <p style={{ marginTop: "0.5rem", color: "#15803d", fontSize: "0.8125rem" }}>
              ✓ {data.locale === "ja" ? "完了しました" : "Completed"}
            </p>
          )}
          {cronJobResult && !cronJobResult.ok && (
            <p style={{ marginTop: "0.5rem", color: "#b91c1c", fontSize: "0.8125rem" }}>
              {t.error}: {cronJobResult.error || cronJobResult.message}
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
