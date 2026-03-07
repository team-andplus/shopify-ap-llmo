/**
 * GDPR 必須コンプライアンス Webhook（App Store 申請で必要）
 * 本アプリは顧客単位データを保存しないため、shop/redact で Session 削除のみ実施。
 */
import type { ActionFunctionArgs } from "react-router";
import { createHmac } from "node:crypto";
import db from "../db.server";

const COMPLIANCE_TOPICS = ["customers/data_request", "customers/redact", "shop/redact"] as const;

function verifyHmac(rawBody: string, hmacHeader: string | null): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret || !hmacHeader) return false;
  const computed = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return computed === hmacHeader;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  const rawBody = await request.text();
  const hmac = request.headers.get("X-Shopify-Hmac-Sha256");
  if (!verifyHmac(rawBody, hmac)) {
    return new Response(null, { status: 401 });
  }

  const topic = request.headers.get("X-Shopify-Topic") ?? "";
  if (!COMPLIANCE_TOPICS.includes(topic as (typeof COMPLIANCE_TOPICS)[number])) {
    return new Response(null, { status: 200 });
  }

  if (topic === "shop/redact") {
    try {
      const payload = JSON.parse(rawBody) as { shop_domain?: string };
      const shopDomain = (payload.shop_domain ?? "").trim().toLowerCase();
      if (shopDomain) {
        await db.session.deleteMany({ where: { shop: shopDomain } });
      }
    } catch (e) {
      console.warn("[webhooks/compliance] shop/redact parse or delete failed", e);
    }
  }

  return new Response(null, { status: 200 });
};
