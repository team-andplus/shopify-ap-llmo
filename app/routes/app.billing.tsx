import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { syncTrialAndAccess } from "../lib/trial.server";
import { requestSubscription, DEFAULT_PLAN } from "../lib/billing.server";
import { getTranslations, getLocaleFromRequest } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const locale = getLocaleFromRequest(request);
  const t = getTranslations(locale);

  const trialInfo = await syncTrialAndAccess(admin, shop);

  // 既に課金済みならメインページへ
  if (trialInfo.isSubscribed) {
    throw redirect("/app");
  }

  return {
    shop,
    locale,
    t,
    trialInfo,
    plan: DEFAULT_PLAN,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "subscribe") {
    const returnUrl = `${process.env.SHOPIFY_APP_URL}/app?subscribed=1`;
    const result = await requestSubscription(admin.graphql.bind(admin), returnUrl);

    if (result.ok) {
      return redirect(result.confirmationUrl);
    }

    return Response.json({
      ok: false,
      error: result.userErrors.map((e) => e.message).join(", "),
    });
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
};

export default function BillingPage() {
  const { locale, trialInfo, plan } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";
  const error = (fetcher.data as { error?: string } | undefined)?.error;

  const isJa = locale === "ja";

  return (
    <div style={{ maxWidth: "600px", margin: "2rem auto", padding: "0 1rem", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "1rem" }}>
        {isJa ? "AP LLMO Pro プランへのアップグレード" : "Upgrade to AP LLMO Pro"}
      </h1>

      {trialInfo.isTrialActive && (
        <div style={{ background: "#fef3c7", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem", borderLeft: "4px solid #f59e0b" }}>
          <p style={{ margin: 0, fontWeight: 600, color: "#92400e" }}>
            {isJa
              ? `無料トライアル期間中です（残り ${trialInfo.daysRemaining} 日）`
              : `Free trial active (${trialInfo.daysRemaining} days remaining)`}
          </p>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.875rem", color: "#92400e" }}>
            {isJa
              ? "トライアル期間中はすべての機能をご利用いただけます。"
              : "You have full access to all features during the trial period."}
          </p>
        </div>
      )}

      {!trialInfo.hasAccess && (
        <div style={{ background: "#fee2e2", padding: "1rem", borderRadius: "8px", marginBottom: "1.5rem", borderLeft: "4px solid #ef4444" }}>
          <p style={{ margin: 0, fontWeight: 600, color: "#b91c1c" }}>
            {isJa ? "トライアル期間が終了しました" : "Trial period has ended"}
          </p>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.875rem", color: "#b91c1c" }}>
            {isJa
              ? "引き続きご利用いただくには、Pro プランへのアップグレードが必要です。"
              : "Please upgrade to Pro plan to continue using the app."}
          </p>
        </div>
      )}

      <div style={{ background: "#f8f9fa", padding: "1.5rem", borderRadius: "8px", marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 1rem", fontSize: "1.25rem", fontWeight: 600 }}>
          {plan.name}
        </h2>
        <p style={{ fontSize: "2rem", fontWeight: 700, margin: "0 0 0.5rem" }}>
          ${plan.price.amount}
          <span style={{ fontSize: "1rem", fontWeight: 400, color: "#6d7175" }}>
            {isJa ? " / 月" : " / month"}
          </span>
        </p>
        <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "#6d7175" }}>
          {isJa ? `${plan.trialDays}日間の無料トライアル付き` : `Includes ${plan.trialDays}-day free trial`}
        </p>

        <ul style={{ margin: "0 0 1.5rem", paddingLeft: "1.25rem", lineHeight: 1.8 }}>
          <li>{isJa ? "llms.txt / llms.full.txt の自動生成" : "Auto-generate llms.txt / llms.full.txt"}</li>
          <li>{isJa ? ".ai-context の AI 生成" : "AI-generated .ai-context"}</li>
          <li>{isJa ? "AI Bot アクセスログ" : "AI bot access logging"}</li>
          <li>{isJa ? "週次レポートメール" : "Weekly report emails"}</li>
          <li>{isJa ? "sitemap-ai.xml 生成" : "sitemap-ai.xml generation"}</li>
        </ul>

        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="subscribe" />
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              width: "100%",
              padding: "0.75rem 1.5rem",
              fontSize: "1rem",
              fontWeight: 600,
              color: "#fff",
              background: isSubmitting ? "#9ca3af" : "#4f46e5",
              border: "none",
              borderRadius: "8px",
              cursor: isSubmitting ? "wait" : "pointer",
            }}
          >
            {isSubmitting
              ? (isJa ? "処理中..." : "Processing...")
              : (isJa ? "Pro プランを開始" : "Start Pro Plan")}
          </button>
        </fetcher.Form>

        {error && (
          <p style={{ marginTop: "1rem", color: "#b91c1c", fontSize: "0.875rem" }}>
            {isJa ? "エラー" : "Error"}: {error}
          </p>
        )}
      </div>

      <p style={{ fontSize: "0.8125rem", color: "#6d7175", textAlign: "center" }}>
        {isJa
          ? "Shopify App Store 経由での課金となります。いつでもキャンセル可能です。"
          : "Billed through Shopify App Store. Cancel anytime."}
      </p>
    </div>
  );
}
