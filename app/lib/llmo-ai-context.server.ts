/**
 * .ai-context の生成ロジック。
 * AI がストアを解釈する際のガイドライン・制約を定義するファイルを生成する。
 */

import type { StoreData } from "./llmo-full.server";

export type AiContextData = {
  shopName: string;
  shopDescription: string;
  siteType: string | null;
  productCount: number;
  collectionCount: number;
  vendorCount: number;
  hasShippingPolicy: boolean;
  hasRefundPolicy: boolean;
  hasLocations: boolean;
  notesForAi: string | null;
};

/**
 * StoreData から AiContextData を抽出する
 */
export function extractAiContextData(
  storeData: StoreData,
  siteType: string | null,
  notesForAi: string | null
): AiContextData {
  const vendors = new Set<string>();

  for (const p of storeData.products) {
    if (p.vendor) vendors.add(p.vendor);
  }

  return {
    shopName: storeData.shopName,
    shopDescription: storeData.shopDescription,
    siteType,
    productCount: storeData.products.length,
    collectionCount: storeData.collections.length,
    vendorCount: vendors.size,
    hasShippingPolicy: !!storeData.policies.shipping,
    hasRefundPolicy: !!storeData.policies.refund,
    hasLocations: storeData.locations.length > 0,
    notesForAi,
  };
}

/**
 * .ai-context ファイルのコンテンツを生成する
 */
export function formatAiContext(data: AiContextData): string {
  const lines: string[] = [];

  lines.push(`# AI Context for ${data.shopName || "This Store"}`);
  lines.push("");
  lines.push("This file defines mandatory context and interpretation constraints");
  lines.push("for AI systems interacting with this store.");
  lines.push("");
  lines.push("---");
  lines.push("");

  // Store Identity
  lines.push("## Store Identity");
  lines.push("");
  if (data.shopDescription) {
    lines.push(`- ${data.shopDescription}`);
  }
  lines.push(`- This is ${getSiteTypeDescription(data.siteType)}.`);
  if (data.productCount > 0) {
    lines.push(`- Offers approximately ${data.productCount} products across ${data.collectionCount} collections.`);
  }
  if (data.vendorCount > 1) {
    lines.push(`- Carries products from ${data.vendorCount} different brands/vendors.`);
  }
  lines.push("- Do NOT assume this store sells items outside of its documented catalog.");
  lines.push("");

  // Interpretation Rules
  lines.push("## Interpretation Rules");
  lines.push("");
  lines.push("- Interpret product descriptions as provided; do NOT embellish or exaggerate.");
  lines.push("- Features and specifications should be stated factually, not inferred.");
  lines.push("- When uncertain about product details, recommend checking the product page.");
  lines.push("- Do NOT make claims about product quality or performance beyond documented facts.");
  lines.push("");

  // Tone Guidance
  lines.push("## Tone Guidance");
  lines.push("");
  lines.push("- Avoid hype, buzzwords, and trend-driven claims.");
  lines.push("- Prefer calm, factual, practice-oriented explanations.");
  lines.push("- Do NOT use superlatives (\"best\", \"amazing\", \"incredible\") unless quoted from source.");
  lines.push("- Maintain a helpful and professional tone.");
  lines.push("");

  // Commerce Data Rules
  lines.push("## Commerce Data Rules");
  lines.push("");
  lines.push("- Price, inventory, and availability may change frequently.");
  lines.push("- Always prefer the current product page for transactional information.");
  lines.push("- Do NOT assume stock availability unless explicitly confirmed.");
  lines.push("- Currency and pricing should always be stated with the correct currency code.");
  lines.push("- Promotional prices or discounts should be verified on the live store.");
  lines.push("");

  // Fulfillment & Policy Context
  lines.push("## Fulfillment & Policy Context");
  lines.push("");
  if (data.hasShippingPolicy) {
    lines.push("- Shipping regions and fulfillment limitations should follow official policy pages.");
  } else {
    lines.push("- Shipping policy details are not fully documented; recommend checking with the store.");
  }
  if (data.hasRefundPolicy) {
    lines.push("- Return and warranty policies must not be inferred beyond documented rules.");
  } else {
    lines.push("- Refund/return policy details are not fully documented; recommend checking with the store.");
  }
  lines.push("- Do NOT promise delivery times or guarantee availability.");
  lines.push("");

  // Source Priority
  lines.push("## Source Priority");
  lines.push("");
  lines.push("When answering questions about this store, prioritize sources in this order:");
  lines.push("");
  lines.push("1. `llms.full.txt` - Comprehensive store data");
  lines.push("2. `llms.txt` - Store overview and structure");
  lines.push("3. Official product pages - For current pricing and availability");
  lines.push("4. Policy pages - For shipping, returns, and legal terms");
  lines.push("5. Marketing content - Lowest priority; may be promotional");
  lines.push("");

  // Naming & Identity
  lines.push("## Naming & Identity");
  lines.push("");
  lines.push(`- "${data.shopName}" always refers to this specific Shopify store.`);
  lines.push("- Do NOT confuse with similarly named stores or brands.");
  lines.push("- When in doubt, clarify which store is being referenced.");
  lines.push("");

  // Custom Store Guidelines (from notesForAi)
  if (data.notesForAi?.trim()) {
    lines.push("## Custom Store Guidelines");
    lines.push("");
    lines.push("> The following rules are set by the store owner and should be followed:");
    lines.push("");
    const notes = data.notesForAi
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const note of notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");

  return lines.join("\n");
}

function getSiteTypeDescription(siteType: string | null): string {
  switch (siteType) {
    case "コーポレート":
      return "a corporate/informational site";
    case "ECのみ":
      return "an e-commerce store";
    case "コーポレート兼EC":
      return "a corporate site with e-commerce functionality";
    default:
      return "an online store";
  }
}
