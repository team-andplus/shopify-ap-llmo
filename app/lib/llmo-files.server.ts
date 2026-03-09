/**
 * llms.txt を Shopify Files API で作成・更新し、メタフィールドに URL を保存する。
 * 要: write_files, write_metafields スコープ（optional_scopes に追加すること）
 */

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const LLMS_TXT_FILENAME = "llms.txt";
const METAFIELD_NAMESPACE = "llmo";
const METAFIELD_KEY_LLMS_TXT_URL = "llms_txt_url";

export type CreateLlmsTxtFileResult =
  | { ok: true; url: string; fileId: string }
  | { ok: false; error: string };

/**
 * テキストを Shopify Files にアップロードし、file の URL と id を返す。
 * 既存の fileId がある場合は fileUpdate で上書きする（同一 URL 維持）。
 */
export async function createOrUpdateLlmsTxtFile(
  admin: AdminApiContext,
  body: string,
  existingFileId: string | null
): Promise<CreateLlmsTxtFileResult> {
  const content = body.trim();
  if (!content) {
    return { ok: false, error: "本文が空です。" };
  }

  const buffer = Buffer.from(content, "utf-8");
  const fileSize = buffer.length;

  try {
    if (existingFileId) {
      // 既存ファイルを更新: stagedUpload → fileUpdate
      const staged = await getStagedUploadTarget(admin, fileSize);
      if (!staged) return { ok: false, error: "ステージドアップロードの取得に失敗しました。" };

      const uploaded = await uploadToStagedUrl(staged.url, staged.parameters, buffer);
      if (!uploaded) return { ok: false, error: "ファイルのアップロードに失敗しました。" };

      const updated = await fileUpdate(admin, existingFileId, staged.resourceUrl);
      if (!updated) return { ok: false, error: "ファイルの更新に失敗しました。" };
      return { ok: true, url: updated.url, fileId: updated.id };
    }

    // 新規作成: stagedUpload → fileCreate
    const staged = await getStagedUploadTarget(admin, fileSize);
    if (!staged) return { ok: false, error: "ステージドアップロードの取得に失敗しました。" };

    const uploaded = await uploadToStagedUrl(staged.url, staged.parameters, buffer);
    if (!uploaded) return { ok: false, error: "ファイルのアップロードに失敗しました。" };

    const created = await fileCreate(admin, staged.resourceUrl);
    if (!created) return { ok: false, error: "ファイルの作成に失敗しました。" };
    return { ok: true, url: created.url, fileId: created.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

async function getStagedUploadTarget(
  admin: AdminApiContext,
  fileSize: number
): Promise<{ url: string; resourceUrl: string; parameters: { name: string; value: string }[] } | null> {
  const mutation = `#graphql
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }`;
  const res = await admin.graphql(mutation, {
    variables: {
      input: [
        {
          filename: LLMS_TXT_FILENAME,
          mimeType: "text/plain",
          resource: "FILE",
          httpMethod: "PUT",
          fileSize,
        },
      ],
    },
  });

  const json = (await res.json()) as {
    data?: {
      stagedUploadsCreate?: {
        stagedTargets?: Array<{
          url: string;
          resourceUrl: string;
          parameters: { name: string; value: string }[];
        }>;
        userErrors?: { field: string; message: string }[];
      };
    };
  };

  const create = json.data?.stagedUploadsCreate;
  if (create?.userErrors?.length) {
    console.error("[llmo-files] stagedUploadsCreate userErrors:", create.userErrors);
    return null;
  }
  const target = create?.stagedTargets?.[0];
  if (!target?.url || !target.resourceUrl) return null;
  return {
    url: target.url,
    resourceUrl: target.resourceUrl,
    parameters: target.parameters ?? [],
  };
}

async function uploadToStagedUrl(
  url: string,
  parameters: { name: string; value: string }[],
  body: Buffer
): Promise<boolean> {
  const parsed = new URL(url);
  parameters.forEach((p) => parsed.searchParams.set(p.name, p.value));
  const res = await fetch(parsed.toString(), {
    method: "PUT",
    body: new Uint8Array(body),
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
  return res.ok;
}

async function fileCreate(
  admin: AdminApiContext,
  originalSource: string
): Promise<{ id: string; url: string } | null> {
  const mutation = `#graphql
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          ... on GenericFile {
            id
            url
          }
        }
        userErrors { field message code }
      }
    }`;
  const res = await admin.graphql(mutation, {
    variables: {
      files: [{ contentType: "FILE", originalSource }],
    },
  });

  const json = (await res.json()) as {
    data?: {
      fileCreate?: {
        files?: Array<{ id: string; url: string }>;
        userErrors?: { field: string; message: string; code?: string }[];
      };
    };
  };

  const fc = json.data?.fileCreate;
  if (fc?.userErrors?.length) {
    console.error("[llmo-files] fileCreate userErrors:", fc.userErrors);
    return null;
  }
  const file = fc?.files?.[0];
  if (!file?.id || !file?.url) return null;
  return { id: file.id, url: file.url };
}

async function fileUpdate(
  admin: AdminApiContext,
  fileId: string,
  originalSource: string
): Promise<{ id: string; url: string } | null> {
  const mutation = `#graphql
    mutation fileUpdate($files: [FileUpdateInput!]!) {
      fileUpdate(files: $files) {
        files {
          ... on GenericFile {
            id
            url
          }
        }
        userErrors { field message code }
      }
    }`;
  const res = await admin.graphql(mutation, {
    variables: {
      files: [{ id: fileId, originalSource }],
    },
  });

  const json = (await res.json()) as {
    data?: {
      fileUpdate?: {
        files?: Array<{ id: string; url: string }>;
        userErrors?: { field: string; message: string; code?: string }[];
      };
    };
  };

  const fu = json.data?.fileUpdate;
  if (fu?.userErrors?.length) {
    console.error("[llmo-files] fileUpdate userErrors:", fu.userErrors);
    return null;
  }
  const file = fu?.files?.[0];
  if (!file?.id || !file?.url) return null;
  return { id: file.id, url: file.url };
}

/**
 * ショップのメタフィールドに llms.txt の URL を保存する（テーマの head から参照するため）
 */
export async function setLlmsTxtUrlMetafield(
  admin: AdminApiContext,
  url: string
): Promise<boolean> {
  const shopId = await getShopGid(admin);
  if (!shopId) return false;

  const mutation = `#graphql
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key namespace value }
        userErrors { field message code }
      }
    }`;
  const res = await admin.graphql(mutation, {
    variables: {
      metafields: [
        {
          namespace: METAFIELD_NAMESPACE,
          key: METAFIELD_KEY_LLMS_TXT_URL,
          type: "single_line_text_field",
          value: url,
          ownerId: shopId,
        },
      ],
    },
  });

  const json = (await res.json()) as {
    data?: {
      metafieldsSet?: {
        userErrors?: { field: string; message: string; code?: string }[];
      };
    };
  };

  const set = json.data?.metafieldsSet;
  if (set?.userErrors?.length) {
    console.error("[llmo-files] metafieldsSet userErrors:", set.userErrors);
    return false;
  }
  return true;
}

async function getShopGid(admin: AdminApiContext): Promise<string | null> {
  const query = `#graphql
    query { shop { id } }
  `;
  const res = await admin.graphql(query);
  const json = (await res.json()) as { data?: { shop?: { id: string } } };
  return json.data?.shop?.id ?? null;
}
