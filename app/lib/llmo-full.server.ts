/**
 * llms.full.txt の生成ロジック。
 * ストアの全商品・コレクション・ロケーション・ポリシー等を取得し、プレーンテキストに整形。
 */

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const MAX_PRODUCTS_PER_PAGE = 250;
const MAX_PRODUCTS_TOTAL = 5000;
const MAX_COLLECTIONS = 50;
const MAX_LOCATIONS = 10;

export type StoreData = {
  shopName: string;
  shopDescription: string;
  shopEmail: string;
  shopDomain: string;
  products: ProductData[];
  collections: CollectionData[];
  locations: LocationData[];
  policies: PolicyData;
};

type ProductData = {
  title: string;
  handle: string;
  description: string;
  vendor: string;
  productType: string;
  tags: string[];
  url: string;
  priceRange: string;
  status: string;
  imageUrl: string;
  options: string[];
};

type CollectionData = {
  title: string;
  description: string;
  handle: string;
  productCount: number;
};

type LocationData = {
  name: string;
  address: string;
};

type PolicyData = {
  shipping: string;
  refund: string;
  privacy: string;
  terms: string;
};

/**
 * Shopify Admin API からストアデータを取得する。
 * @param fullFetch true の場合、全商品を取得（定時処理用）。false の場合、500商品まで（手動生成用）。
 */
export async function fetchStoreData(admin: AdminApiContext, fullFetch = false): Promise<StoreData> {
  const maxProducts = fullFetch ? MAX_PRODUCTS_TOTAL : 500;

  const [shopInfo, products, collections, locations, policies] = await Promise.all([
    fetchShopInfo(admin),
    fetchAllProducts(admin, maxProducts),
    fetchCollections(admin),
    fetchLocations(admin),
    fetchPolicies(admin),
  ]);

  return {
    shopName: shopInfo.name,
    shopDescription: shopInfo.description,
    shopEmail: shopInfo.email,
    shopDomain: shopInfo.domain,
    products,
    collections,
    locations,
    policies,
  };
}

async function fetchShopInfo(admin: AdminApiContext): Promise<{
  name: string;
  description: string;
  email: string;
  domain: string;
}> {
  const query = `#graphql
    query {
      shop {
        name
        description
        email
        primaryDomain {
          url
        }
      }
    }
  `;
  const res = await admin.graphql(query);
  const json = (await res.json()) as {
    data?: {
      shop?: {
        name?: string;
        description?: string;
        email?: string;
        primaryDomain?: { url?: string };
      };
    };
  };
  return {
    name: json.data?.shop?.name ?? "",
    description: json.data?.shop?.description ?? "",
    email: json.data?.shop?.email ?? "",
    domain: json.data?.shop?.primaryDomain?.url ?? "",
  };
}

/**
 * 全商品を取得（ページネーション対応）
 */
async function fetchAllProducts(admin: AdminApiContext, maxProducts: number): Promise<ProductData[]> {
  const products: ProductData[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage && products.length < maxProducts) {
    const remaining = maxProducts - products.length;
    const pageSize = Math.min(MAX_PRODUCTS_PER_PAGE, remaining);

    const query = `#graphql
      query getProducts($first: Int!, $after: String) {
        products(first: $first, after: $after, query: "status:active") {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              title
              handle
              description
              vendor
              productType
              tags
              status
              onlineStoreUrl
              featuredImage {
                url
              }
              options {
                name
              }
              priceRangeV2 {
                minVariantPrice { amount currencyCode }
                maxVariantPrice { amount currencyCode }
              }
            }
          }
        }
      }
    `;

    try {
      const res = await admin.graphql(query, {
        variables: { first: pageSize, after: cursor },
      });
      const json = (await res.json()) as {
        data?: {
          products?: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            edges: Array<{
              node: {
                title: string;
                handle: string;
                description: string;
                vendor: string;
                productType: string;
                tags: string[];
                status: string;
                onlineStoreUrl: string | null;
                featuredImage?: { url: string } | null;
                options?: Array<{ name: string }>;
                priceRangeV2?: {
                  minVariantPrice?: { amount: string; currencyCode: string };
                  maxVariantPrice?: { amount: string; currencyCode: string };
                };
              };
            }>;
          };
        };
        errors?: Array<{ message: string }>;
      };

      if (json.errors?.length) {
        console.warn("[llmo-full] products query error:", json.errors[0]?.message);
        break;
      }

      const pageInfo = json.data?.products?.pageInfo;
      const edges = json.data?.products?.edges ?? [];

      for (const edge of edges) {
        const p = edge.node;
        const min = p.priceRangeV2?.minVariantPrice;
        const max = p.priceRangeV2?.maxVariantPrice;
        let priceRange = "";
        if (min && max) {
          const currency = min.currencyCode;
          const minAmt = Number(min.amount).toLocaleString();
          const maxAmt = Number(max.amount).toLocaleString();
          priceRange = min.amount === max.amount ? `${currency} ${minAmt}` : `${currency} ${minAmt}–${maxAmt}`;
        }

        const optionNames = (p.options ?? [])
          .map((o) => o.name)
          .filter((name) => name && name !== "Title");

        products.push({
          title: p.title,
          handle: p.handle ?? "",
          description: stripHtml(p.description ?? ""),
          vendor: p.vendor ?? "",
          productType: p.productType ?? "",
          tags: p.tags ?? [],
          url: p.onlineStoreUrl ?? "",
          priceRange,
          status: p.status,
          imageUrl: p.featuredImage?.url ?? "",
          options: optionNames,
        });
      }

      hasNextPage = pageInfo?.hasNextPage ?? false;
      cursor = pageInfo?.endCursor ?? null;
    } catch (err) {
      console.error("[llmo-full] fetchAllProducts error:", err);
      break;
    }
  }

  return products;
}

/**
 * コレクション一覧を取得
 */
async function fetchCollections(admin: AdminApiContext): Promise<CollectionData[]> {
  const query = `#graphql
    query getCollections($first: Int!) {
      collections(first: $first) {
        edges {
          node {
            title
            description
            handle
            productsCount {
              count
            }
          }
        }
      }
    }
  `;

  try {
    const res = await admin.graphql(query, { variables: { first: MAX_COLLECTIONS } });
    const json = (await res.json()) as {
      data?: {
        collections?: {
          edges: Array<{
            node: {
              title: string;
              description: string;
              handle: string;
              productsCount?: { count: number };
            };
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      console.warn("[llmo-full] collections query error:", json.errors[0]?.message);
      return [];
    }

    const edges = json.data?.collections?.edges ?? [];
    return edges.map((edge) => ({
      title: edge.node.title,
      description: stripHtml(edge.node.description ?? ""),
      handle: edge.node.handle,
      productCount: edge.node.productsCount?.count ?? 0,
    }));
  } catch (err) {
    console.warn("[llmo-full] fetchCollections failed:", err);
    return [];
  }
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

async function fetchPolicies(admin: AdminApiContext): Promise<PolicyData> {
  try {
    const query = `#graphql
      query {
        shop {
          shopPolicies {
            type
            body
          }
        }
      }
    `;
    const res = await admin.graphql(query);
    const json = (await res.json()) as {
      data?: {
        shop?: {
          shopPolicies?: Array<{ type: string; body: string }>;
        };
      };
    };
    const policies = json.data?.shop?.shopPolicies ?? [];
    return {
      shipping: stripHtml(policies.find((p) => p.type === "SHIPPING_POLICY")?.body ?? ""),
      refund: stripHtml(policies.find((p) => p.type === "REFUND_POLICY")?.body ?? ""),
      privacy: stripHtml(policies.find((p) => p.type === "PRIVACY_POLICY")?.body ?? ""),
      terms: stripHtml(policies.find((p) => p.type === "TERMS_OF_SERVICE")?.body ?? ""),
    };
  } catch {
    return { shipping: "", refund: "", privacy: "", terms: "" };
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

  // Header
  lines.push(`# ${data.shopName || "Store"}: Full Site Information`);
  lines.push("");
  if (data.shopDescription) {
    lines.push(`> ${data.shopDescription}`);
    lines.push("");
  }
  lines.push("This file provides a comprehensive summary of the store for LLM and AI agent reference.");
  lines.push("");

  // Store Info
  lines.push("## Store Information");
  lines.push("");
  if (data.shopDomain) lines.push(`- Website: ${data.shopDomain}`);
  if (data.shopEmail) lines.push(`- Contact Email: ${data.shopEmail}`);
  lines.push(`- Total Products: ${data.products.length}`);
  lines.push(`- Total Collections: ${data.collections.length}`);
  lines.push(`- Total Locations: ${data.locations.length}`);
  lines.push("");

  // Collections
  if (data.collections.length > 0) {
    lines.push("## Collections");
    lines.push("");
    for (const col of data.collections) {
      lines.push(`### ${col.title}`);
      lines.push(`- Collection ID: ${col.handle}`);
      if (col.description) {
        lines.push(`- Description: ${col.description}`);
      }
      lines.push(`- Product Count: ${col.productCount}`);
      if (data.shopDomain) {
        lines.push(`- URL: ${data.shopDomain}/collections/${col.handle}`);
      }
      lines.push("");
    }
  }

  // Products
  if (data.products.length > 0) {
    lines.push("## Products");
    lines.push("");
    lines.push(`Total: ${data.products.length} products`);
    lines.push("");

    for (const p of data.products) {
      lines.push(`### ${p.title}`);
      if (p.handle) {
        lines.push(`- Product ID: ${p.handle}`);
      }
      if (p.description) {
        lines.push(`- Description: ${truncateText(p.description, 500)}`);
      }
      if (p.vendor) {
        lines.push(`- Vendor: ${p.vendor}`);
      }
      if (p.productType) {
        lines.push(`- Category: ${p.productType}`);
      }
      if (p.priceRange) {
        lines.push(`- Price: ${p.priceRange}`);
      }
      if (p.tags.length > 0) {
        lines.push(`- Labels: ${p.tags.join(", ")}`);
      }
      if (p.options.length > 0) {
        lines.push(`- Options: ${p.options.join(", ")}`);
      }
      if (p.imageUrl) {
        lines.push(`- Image: ${p.imageUrl}`);
      }
      if (p.url) {
        lines.push(`- URL: ${p.url}`);
      }
      lines.push("");
    }
  }

  // Brands / Vendors
  const vendors = new Set<string>();
  for (const p of data.products) {
    if (p.vendor) vendors.add(p.vendor);
  }
  if (vendors.size > 0) {
    lines.push("## Brands / Vendors");
    lines.push("");
    for (const v of Array.from(vendors).sort()) {
      lines.push(`- ${v}`);
    }
    lines.push("");
  }

  // Locations
  if (data.locations.length > 0) {
    lines.push("## Locations");
    lines.push("");
    for (const loc of data.locations) {
      lines.push(`- **${loc.name}**: ${loc.address || "(No address)"}`);
    }
    lines.push("");
  }

  // Policies
  const hasPolicies = data.policies.shipping || data.policies.refund || data.policies.privacy || data.policies.terms;
  if (hasPolicies) {
    lines.push("## Policies");
    lines.push("");
    if (data.policies.shipping) {
      lines.push("### Shipping Policy");
      lines.push(truncateText(data.policies.shipping, 2000));
      lines.push("");
    }
    if (data.policies.refund) {
      lines.push("### Refund Policy");
      lines.push(truncateText(data.policies.refund, 2000));
      lines.push("");
    }
    if (data.policies.privacy) {
      lines.push("### Privacy Policy");
      lines.push(truncateText(data.policies.privacy, 2000));
      lines.push("");
    }
    if (data.policies.terms) {
      lines.push("### Terms of Service");
      lines.push(truncateText(data.policies.terms, 2000));
      lines.push("");
    }
  }

  // Footer
  lines.push("---");
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push(`Products included: ${data.products.length}`);
  lines.push("");

  return lines.join("\n");
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}
