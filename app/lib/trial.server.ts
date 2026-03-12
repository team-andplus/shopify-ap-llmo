/**
 * 7日間無料トライアルと has_access の判定
 * - アクセス可否は AppTrial (DB) + 課金 API で算出
 */

import { getBillingStatus } from "./billing.server";
import prisma from "../db.server";

const TRIAL_DAYS = 7;

type Admin = { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<unknown> };

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function normalizeShop(shopDomain?: string | null): string {
  return (shopDomain ?? "").trim().toLowerCase();
}

export type TrialAccessResult = {
  hasAccess: boolean;
  trialEndsAt: string;
  isSubscribed: boolean;
  isTrialActive: boolean;
  daysRemaining: number;
};

/**
 * トライアル終了日と hasAccess を DB と課金 API で算出。
 */
export async function syncTrialAndAccess(admin: Admin, shopDomain?: string | null): Promise<TrialAccessResult> {
  const graphql = admin.graphql.bind(admin);
  const now = new Date();
  const defaultEnd = addDays(now, TRIAL_DAYS);
  const shop = normalizeShop(shopDomain);

  let dbTrialEndsAt: Date | null = null;
  if (shop) {
    try {
      const row = await prisma.appTrial.findUnique({ where: { shopDomain: shop } });
      if (row) {
        dbTrialEndsAt = row.trialEndsAt;
      }
    } catch (e) {
      console.warn("[trial] AppTrial read failed", e);
    }
  }

  let billing: { hasActiveSubscription: boolean };
  try {
    billing = await getBillingStatus(graphql);
  } catch {
    const end = dbTrialEndsAt ?? defaultEnd;
    const withinTrial = now < end;
    return {
      hasAccess: withinTrial,
      trialEndsAt: toISODate(end),
      isSubscribed: false,
      isTrialActive: withinTrial,
      daysRemaining: Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))),
    };
  }

  const effectiveEnd: Date = dbTrialEndsAt ?? defaultEnd;
  const withinTrial = now < effectiveEnd;
  const hasAccess = withinTrial || billing.hasActiveSubscription;
  const daysRemaining = Math.max(0, Math.ceil((effectiveEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  if (shop) {
    try {
      await prisma.appTrial.upsert({
        where: { shopDomain: shop },
        create: { shopDomain: shop, trialEndsAt: effectiveEnd, hasAccess },
        update: { trialEndsAt: effectiveEnd, hasAccess, updatedAt: new Date() },
      });
    } catch (e) {
      console.warn("[trial] AppTrial upsert failed", e);
    }
  }

  return {
    hasAccess,
    trialEndsAt: toISODate(effectiveEnd),
    isSubscribed: billing.hasActiveSubscription,
    isTrialActive: withinTrial && !billing.hasActiveSubscription,
    daysRemaining,
  };
}

/**
 * DB の hasAccess のみで判定（App Proxy 用など）
 */
export async function getHasAccessFromDb(shopDomain: string): Promise<boolean> {
  try {
    const shop = shopDomain.trim().toLowerCase();
    if (!shop) return false;
    const row = await prisma.appTrial.findUnique({ where: { shopDomain: shop } });
    if (!row) return true; // 未登録は初回扱いで許可
    return Boolean(row.hasAccess);
  } catch {
    return true;
  }
}
