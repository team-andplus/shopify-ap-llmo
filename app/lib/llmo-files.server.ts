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

/** docs/ai 用の md 1件（filename, content と Files API 反映後の fileId, fileUrl） */
export type DocsAiFileEntry = {
  filename: string;
  content: string;
  fileId?: string | null;
  fileUrl?: string | null;
};

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
      if (!staged.ok) return { ok: false, error: staged.error };

      const uploaded = await uploadToStagedUrl(staged.value.url, staged.value.parameters, buffer);
      if (!uploaded.ok) return { ok: false, error: uploaded.error };

      const updated = await fileUpdate(admin, existingFileId, staged.value.resourceUrl);
      if (!updated.ok) return { ok: false, error: updated.error };
      return { ok: true, url: updated.url, fileId: updated.id };
    }

    // 新規作成: stagedUpload → fileCreate
    const staged = await getStagedUploadTarget(admin, fileSize);
    if (!staged.ok) return { ok: false, error: staged.error };

    const uploaded = await uploadToStagedUrl(staged.value.url, staged.value.parameters, buffer);
    if (!uploaded.ok) return { ok: false, error: uploaded.error };

    const created = await fileCreate(admin, staged.value.resourceUrl);
    if (!created.ok) return { ok: false, error: created.error };
    return { ok: true, url: created.url, fileId: created.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

/**
 * docs/ai 用の Markdown ファイルを Shopify Files に 1 件作成または更新する。
 * filename は .md 付き（例: README.md）。既存の fileId があれば fileUpdate。
 */
export async function createOrUpdateMdFile(
  admin: AdminApiContext,
  filename: string,
  content: string,
  existingFileId: string | null
): Promise<CreateLlmsTxtFileResult> {
  const trimmed = content.trim();
  if (!trimmed) {
    return { ok: false, error: "Content is empty." };
  }
  const buffer = Buffer.from(trimmed, "utf-8");
  const fileSize = buffer.length;

  try {
    const staged = await getStagedUploadTargetForFile(
      admin,
      filename,
      "text/markdown",
      fileSize
    );
    if (!staged.ok) return { ok: false, error: staged.error };

    const uploaded = await uploadToStagedUrl(
      staged.value.url,
      staged.value.parameters,
      buffer,
      "text/markdown; charset=utf-8",
      filename
    );
    if (!uploaded.ok) return { ok: false, error: uploaded.error };

    if (existingFileId) {
      const updated = await fileUpdate(admin, existingFileId, staged.value.resourceUrl);
      if (!updated.ok) return { ok: false, error: updated.error };
      return { ok: true, url: updated.url, fileId: updated.id };
    }
    const created = await fileCreate(admin, staged.value.resourceUrl);
    if (!created.ok) return { ok: false, error: created.error };
    return { ok: true, url: created.url, fileId: created.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

/**
 * docs/ai 用の md 一覧を Files API で作成・更新し、fileId/fileUrl を付与した配列を返す。
 * filename が空の行はスキップ。失敗した行は fileId/fileUrl を null のまま返す。
 */
export async function createOrUpdateDocsAiFiles(
  admin: AdminApiContext,
  docs: DocsAiFileEntry[]
): Promise<DocsAiFileEntry[]> {
  const result: DocsAiFileEntry[] = [];
  for (const doc of docs) {
    const name = (doc.filename ?? "").trim();
    if (!name) {
      result.push({ ...doc, fileId: null, fileUrl: null });
      continue;
    }
    const res = await createOrUpdateMdFile(
      admin,
      name,
      doc.content ?? "",
      doc.fileId ?? null
    );
    if (res.ok) {
      result.push({
        filename: name,
        content: doc.content ?? "",
        fileId: res.fileId,
        fileUrl: res.url,
      });
    } else {
      result.push({
        ...doc,
        filename: name,
        fileId: null,
        fileUrl: null,
      });
    }
  }
  return result;
}

type StagedTarget = { url: string; resourceUrl: string; parameters: { name: string; value: string }[] };

async function getStagedUploadTarget(
  admin: AdminApiContext,
  fileSize: number
): Promise<{ ok: true; value: StagedTarget } | { ok: false; error: string }> {
  return getStagedUploadTargetForFile(admin, LLMS_TXT_FILENAME, "text/plain", fileSize);
}

async function getStagedUploadTargetForFile(
  admin: AdminApiContext,
  filename: string,
  mimeType: string,
  fileSize: number
): Promise<{ ok: true; value: StagedTarget } | { ok: false; error: string }> {
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
          filename,
          mimeType,
          resource: "FILE",
          httpMethod: "POST", // POST + multipart/form-data でアップロードする
          fileSize: String(fileSize), // UnsignedInt64 は文字列で渡す
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
    const msg = create.userErrors.map((e) => e.message).join("; ");
    console.error("[llmo-files] stagedUploadsCreate userErrors:", create.userErrors);
    return { ok: false, error: msg || "ステージドアップロードの取得に失敗しました。" };
  }
  const target = create?.stagedTargets?.[0];
  if (!target?.url || !target.resourceUrl) {
    return { ok: false, error: "ステージドアップロードの取得に失敗しました。" };
  }
  return {
    ok: true,
    value: { url: target.url, resourceUrl: target.resourceUrl, parameters: target.parameters ?? [] },
  };
}

async function uploadToStagedUrl(
  url: string,
  parameters: { name: string; value: string }[],
  body: Buffer,
  contentType = "text/plain; charset=utf-8",
  filename = LLMS_TXT_FILENAME
): Promise<{ ok: true } | { ok: false; error: string }> {
  const formData = new FormData();
  parameters.forEach((p) => formData.append(p.name, p.value));
  formData.append("file", new Blob([body], { type: contentType }), filename);

  const res = await fetch(url, {
    method: "POST",
    body: formData,
  });

  if (res.ok) return { ok: true };
  const text = await res.text();
  const msg = text.slice(0, 200) || `HTTP ${res.status}`;
  console.error("[llmo-files] staged upload POST failed:", res.status, msg);
  return { ok: false, error: `アップロード失敗 (${res.status}): ${msg}` };
}

async function fileCreate(
  admin: AdminApiContext,
  originalSource: string
): Promise<{ ok: true; id: string; url: string } | { ok: false; error: string }> {
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
    errors?: Array<{ message: string }>;
  };

  const gqlErrors = json.errors;
  if (gqlErrors?.length) {
    const msg = gqlErrors.map((e) => e.message).join("; ");
    console.error("[llmo-files] fileCreate GraphQL errors:", gqlErrors);
    return { ok: false, error: msg };
  }

  const fc = json.data?.fileCreate;
  if (fc?.userErrors?.length) {
    const msg = fc.userErrors.map((e) => e.message || e.code || e.field).join("; ");
    console.error("[llmo-files] fileCreate userErrors:", fc.userErrors);
    return { ok: false, error: msg || "ファイルの作成に失敗しました。" };
  }
  const file = fc?.files?.[0];
  if (!file?.id || !file?.url) {
    console.error("[llmo-files] fileCreate no file in response:", JSON.stringify({ files: fc?.files, originalSourceLength: originalSource?.length }));
    return { ok: false, error: "ファイルの作成に失敗しました。（レスポンスにファイルが含まれていません。ステージドアップロードの resourceUrl を確認してください。）" };
  }
  return { ok: true, id: file.id, url: file.url };
}

async function fileUpdate(
  admin: AdminApiContext,
  fileId: string,
  originalSource: string
): Promise<{ ok: true; id: string; url: string } | { ok: false; error: string }> {
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
    const msg = fu.userErrors.map((e) => e.message || e.code || e.field).join("; ");
    console.error("[llmo-files] fileUpdate userErrors:", fu.userErrors);
    return { ok: false, error: msg || "ファイルの更新に失敗しました。" };
  }
  const file = fu?.files?.[0];
  if (!file?.id || !file?.url) {
    return { ok: false, error: "ファイルの更新に失敗しました。" };
  }
  return { ok: true, id: file.id, url: file.url };
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
