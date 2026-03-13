/**
 * Shopify Billing API（App Subscription）のサーバー側処理
 * - 課金状態の取得（currentAppInstallation.activeSubscriptions）
 * - 月額プランの作成と承認 URL の取得（appSubscriptionCreate）
 */

export type BillingStatus = {
  hasActiveSubscription: boolean;
  subscriptions: Array<{ id: string; name: string; status: string }>;
};

type Graphql = (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<unknown>;

function isRedirectResponse(raw: unknown): boolean {
  return Boolean(raw && typeof raw === "object" && "status" in raw && (raw as Response).status >= 300 && (raw as Response).status < 400);
}

async function parseGraphqlResponse(raw: unknown): Promise<{ data?: unknown; errors?: unknown[] }> {
  if (raw && typeof raw === "object" && "json" in raw && typeof (raw as Response).json === "function") {
    const res = raw as Response;
    if (!res.ok) return { errors: [{ message: `HTTP ${res.status}` }] };
    return (await res.json()) as { data?: unknown; errors?: unknown[] };
  }
  if (raw && typeof raw === "object" && "data" in raw) return raw as { data?: unknown; errors?: unknown[] };
  return { errors: [{ message: "Unexpected response" }] };
}

const QUERY_CURRENT_BILLING = `#graphql
  query CurrentAppInstallationBilling {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
      }
    }
  }
`;

/**
 * 現在のショップにアクティブなアプリサブスクリプションがあるか取得する。
 */
export async function getBillingStatus(graphql: Graphql): Promise<BillingStatus> {
  const raw = await graphql(QUERY_CURRENT_BILLING);
  if (isRedirectResponse(raw)) {
    throw new Error("Billing check got redirect (session refresh); treat as allow access");
  }
  const result = await parseGraphqlResponse(raw) as {
    data?: { currentAppInstallation?: { activeSubscriptions?: Array<{ id: string; name: string; status: string }> } };
    errors?: unknown[];
  };
  if (result.errors?.length) {
    return { hasActiveSubscription: false, subscriptions: [] };
  }
  const list = result.data?.currentAppInstallation?.activeSubscriptions ?? [];
  return {
    hasActiveSubscription: list.length > 0,
    subscriptions: list.map((s) => ({ id: s.id, name: s.name, status: s.status })),
  };
}

/** AP LLMO Pro プラン: $25/月（将来: Free / $12 プラン追加時は $25 にログのAI分析などを付与） */
export const DEFAULT_PLAN = {
  name: "AP LLMO Pro",
  price: { amount: "25.00", currencyCode: "USD" },
  interval: "EVERY_30_DAYS" as const,
  trialDays: 7,
};

const MUTATION_APP_SUBSCRIPTION_CREATE = `#graphql
  mutation AppSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $trialDays: Int) {
    appSubscriptionCreate(name: $name, returnUrl: $returnUrl, lineItems: $lineItems, trialDays: $trialDays) {
      userErrors {
        field
        message
      }
      confirmationUrl
      appSubscription {
        id
      }
    }
  }
`;

export type RequestSubscriptionResult =
  | { ok: true; confirmationUrl: string }
  | { ok: false; userErrors: Array<{ field?: string[]; message: string }> };

/**
 * サブスクリプション作成をリクエストし、店舗が承認するための URL を返す。
 */
export async function requestSubscription(
  graphql: Graphql,
  returnUrl: string,
  plan: { name: string; price: { amount: string; currencyCode: string }; interval: "EVERY_30_DAYS" | "ANNUAL"; trialDays?: number } = DEFAULT_PLAN,
): Promise<RequestSubscriptionResult> {
  const variables = {
    name: plan.name,
    returnUrl,
    trialDays: plan.trialDays ?? 0,
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: {
              amount: plan.price.amount,
              currencyCode: plan.price.currencyCode,
            },
            interval: plan.interval,
          },
        },
      },
    ],
  };

  const raw = await graphql(MUTATION_APP_SUBSCRIPTION_CREATE, { variables });
  const result = (await parseGraphqlResponse(raw)) as {
    data?: {
      appSubscriptionCreate?: {
        userErrors: Array<{ field?: string[]; message: string }>;
        confirmationUrl?: string | null;
        appSubscription?: { id: string } | null;
      };
    };
    errors?: unknown[];
  };

  const payload = result.data?.appSubscriptionCreate;
  if (result.errors?.length || !payload) {
    return {
      ok: false,
      userErrors: payload?.userErrors ?? [{ message: "Request failed" }],
    };
  }
  if (payload.userErrors.length > 0) {
    return { ok: false, userErrors: payload.userErrors };
  }
  if (!payload.confirmationUrl) {
    return { ok: false, userErrors: [{ message: "No confirmation URL returned" }] };
  }
  return { ok: true, confirmationUrl: payload.confirmationUrl };
}
