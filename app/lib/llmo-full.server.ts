/**
 * llms.full.txt の生成ロジック。
 * ストアのコレクション・商品・ロケーション・ポリシー等を取得し、プレーンテキストに整形。
 * 有料プランでは AI 補正を適用し、Files API にアップロードする。
 */

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const MAX_COLLECTIONS = 20;
const MAX_PRODUCTS_PER_COLLECTION = 30;
const MAX_LOCATIONS = 10;

export type StoreData = {
  shopName: string;
  shopDescription: string;
  collections: CollectionData[];
  locations: LocationData[];
  shippingPolicy: string;
  refundPolicy: string;
};

type CollectionData = {
  title: string;
  description: string;
  products: ProductData[];
};

type ProductData = {
  title: string;
  vendor: string;
  productType: string;
  priceRange: string;
};

type LocationData = {
  name: string;
  address: string;
};

/**
 * Shopify Admin API からストアデータを取得する。
 */
export async function fetchStoreData(admin: AdminApiContext): Promise<StoreData> {
  const [shopInfo, collections, locations, policies] = await Promise.all([
    fetchShopInfo(admin),
    fetchCollectionsWithProducts(admin),
    fetchLocations(admin),
    fetchPolicies(admin),
  ]);

  return {
    shopName: shopInfo.name,
    shopDescription: shopInfo.description,
    collections,
    locations,
    shippingPolicy: policies.shipping,
    refundPolicy: policies.refund,
  };
}

async function fetchShopInfo(admin: AdminApiContext): Promise<{ name: string; description: string }> {
  const query = `#graphql
    query {
      shop {
        name
        description
      }
    }
  `;
  const res = await admin.graphql(query);
  const json = (await res.json()) as {
    data?: { shop?: { name?: string; description?: string } };
  };
  return {
    name: json.data?.shop?.name ?? "",
    description: json.data?.shop?.description ?? "",
  };
}

async function fetchCollectionsWithProducts(admin: AdminApiContext): Promise<CollectionData[]> {
  const query = `#graphql
    query getCollections($first: Int!) {
      collections(first: $first) {
        edges {
          node {
            title
            description
            products(first: ${MAX_PRODUCTS_PER_COLLECTION}) {
              edges {
                node {
                  title
                  vendor
                  productType
                  priceRangeV2 {
                    minVariantPrice { amount currencyCode }
                    maxVariantPrice { amount currencyCode }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
  const res = await admin.graphql(query, { variables: { first: MAX_COLLECTIONS } });
  const json = (await res.json()) as {
    data?: {
      collections?: {
        edges: Array<{
          node: {
            title: string;
            description: string;
            products: {
              edges: Array<{
                node: {
                  title: string;
                  vendor: string;
                  productType: string;
                  priceRangeV2?: {
                    minVariantPrice?: { amount: string; currencyCode: string };
                    maxVariantPrice?: { amount: string; currencyCode: string };
                  };
                };
              }>;
            };
          };
        }>;
      };
    };
  };

  const collections = json.data?.collections?.edges ?? [];
  return collections.map((edge) => {
    const col = edge.node;
    const products = col.products.edges.map((pe) => {
      const p = pe.node;
      const min = p.priceRangeV2?.minVariantPrice;
      const max = p.priceRangeV2?.maxVariantPrice;
      let priceRange = "";
      if (min && max) {
        const currency = min.currencyCode;
        const minAmt = Number(min.amount).toLocaleString();
        const maxAmt = Number(max.amount).toLocaleString();
        priceRange = min.amount === max.amount ? `${currency} ${minAmt}` : `${currency} ${minAmt}–${maxAmt}`;
      }
      return {
        title: p.title,
        vendor: p.vendor,
        productType: p.productType,
        priceRange,
      };
    });
    return {
      title: col.title,
      description: col.description ?? "",
      products,
    };
  });
}

async function fetchLocations(admin: AdminApiContext): Promise<LocationData[]> {
  try {
    const query = `#graphql
      query getLocations($first: Int!) {
        locations(first: $first) {
          edges {
            node {
              name
              address {
                address1
                address2
                city
                province
                country
                zip
              }
            }
          }
        }
      }
    `;
    const res = await admin.graphql(query, { variables: { first: MAX_LOCATIONS } });
    const json = (await res.json()) as {
      data?: {
        locations?: {
          edges: Array<{
            node: {
              name: string;
              address?: {
                address1?: string;
                address2?: string;
                city?: string;
                province?: string;
                country?: string;
                zip?: string;
              };
            };
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      console.warn("[llmo-full] locations query error (scope missing?):", json.errors[0]?.message);
      return [];
    }

    const locations = json.data?.locations?.edges ?? [];
    return locations.map((edge) => {
      const loc = edge.node;
      const addr = loc.address;
      const parts = [addr?.address1, addr?.address2, addr?.city, addr?.province, addr?.zip, addr?.country].filter(Boolean);
      return {
        name: loc.name,
        address: parts.join(", "),
      };
    });
  } catch (err) {
    console.warn("[llmo-full] fetchLocations failed:", err);
    return [];
  }
}

async function fetchPolicies(admin: AdminApiContext): Promise<{ shipping: string; refund: string }> {
  try {
    const query = `#graphql
      query {
        shopPolicies {
          type
          body
        }
      }
    `;
    const res = await admin.graphql(query);
    const json = (await res.json()) as {
      data?: {
        shopPolicies?: Array<{ type: string; body: string }>;
      };
    };
    const policies = json.data?.shopPolicies ?? [];
    const shipping = policies.find((p) => p.type === "SHIPPING_POLICY")?.body ?? "";
    const refund = policies.find((p) => p.type === "REFUND_POLICY")?.body ?? "";
    return {
      shipping: stripHtml(shipping),
      refund: stripHtml(refund),
    };
  } catch {
    return { shipping: "", refund: "" };
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * StoreData をプレーンテキスト（Markdown 風）に整形する。
 */
export function formatStoreDataAsText(data: StoreData): string {
  const lines: string[] = [];

  lines.push(`# ${data.shopName || "Store"}: Full Site Information`);
  lines.push("");
  if (data.shopDescription) {
    lines.push(`> ${data.shopDescription}`);
    lines.push("");
  }
  lines.push("This file provides a structured summary of the store's collections, products, locations, and policies for LLM and AI agent reference.");
  lines.push("");

  if (data.collections.length > 0) {
    lines.push("## Collections & Products");
    lines.push("");
    for (const col of data.collections) {
      lines.push(`### ${col.title}`);
      if (col.description) {
        lines.push(`${col.description}`);
      }
      lines.push("");
      if (col.products.length > 0) {
        for (const p of col.products) {
          const parts = [p.title];
          if (p.vendor) parts.push(`by ${p.vendor}`);
          if (p.priceRange) parts.push(`(${p.priceRange})`);
          lines.push(`- ${parts.join(" ")}`);
        }
      } else {
        lines.push("- (No products in this collection)");
      }
      lines.push("");
    }
  }

  const vendors = new Set<string>();
  for (const col of data.collections) {
    for (const p of col.products) {
      if (p.vendor) vendors.add(p.vendor);
    }
  }
  if (vendors.size > 0) {
    lines.push("## Brands / Vendors");
    lines.push("");
    for (const v of Array.from(vendors).sort()) {
      lines.push(`- ${v}`);
    }
    lines.push("");
  }

  if (data.locations.length > 0) {
    lines.push("## Locations");
    lines.push("");
    for (const loc of data.locations) {
      lines.push(`- **${loc.name}**: ${loc.address || "(No address)"}`);
    }
    lines.push("");
  }

  if (data.shippingPolicy || data.refundPolicy) {
    lines.push("## Policies");
    lines.push("");
    if (data.shippingPolicy) {
      lines.push("### Shipping Policy");
      lines.push(truncateText(data.shippingPolicy, 1000));
      lines.push("");
    }
    if (data.refundPolicy) {
      lines.push("### Refund Policy");
      lines.push(truncateText(data.refundPolicy, 1000));
      lines.push("");
    }
  }

  lines.push("---");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push("");

  return lines.join("\n");
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}
