import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useFetcher } from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { buildLlmsTxtPrompt } from "../lib/llmo-prompt.server";
import {
  createOrUpdateLlmsTxtFile,
  createOrUpdateDocsAiFiles,
  setLlmsTxtUrlMetafield,
  type DocsAiFileEntry,
} from "../lib/llmo-files.server";
import { getDecryptedOpenAiKey, generateLlmsTxtBody } from "../lib/openai.server";
import { encrypt } from "../lib/encrypt.server";
import { getTranslations, getLocaleFromRequest } from "../lib/i18n";

const MAX_DOCS_AI_ROWS = 10;

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
  docsAiFiles: [] as DocsAiFileEntry[],
  openaiApiKeySet: false,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shop = session?.shop ?? "";
    const storeUrl = shop ? `https://${shop}` : "";
    const locale = getLocaleFromRequest(request);

    const settings = shop
      ? await prisma.llmoSettings.findUnique({ where: { shop } })
      : null;

    const docsAiFiles = parseDocsAiFromSettings(settings?.docsAiFiles ?? null);

    return {
      storeUrl,
      locale,
      t: getTranslations(locale),
      settings: settings
        ? {
            siteType: settings.siteType ?? "",
            title: settings.title ?? "",
            roleSummary: settings.roleSummary ?? "",
            sectionsOutline: settings.sectionsOutline ?? "",
            notesForAi: settings.notesForAi ?? "",
            llmsTxtBody: settings.llmsTxtBody ?? "",
            llmsTxtFileUrl: settings.llmsTxtFileUrl ?? "",
            docsAiFiles,
            openaiApiKeySet: !!(settings as { openaiApiKey?: string | null }).openaiApiKey,
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

  if (intent === "getPrompt") {
    const count = Math.min(parseInt(String(formData.get("docsAiCount") || "0"), 10) || 0, MAX_DOCS_AI_ROWS);
    const docsAiFiles: { filename: string; fileUrl?: string | null }[] = [];
    for (let i = 0; i < count; i++) {
      const filename = (formData.get(`docsAiFilename_${i}`) as string)?.trim();
      if (!filename) continue;
      const fileUrl = (formData.get(`docsAiFileUrl_${i}`) as string)?.trim() || null;
      docsAiFiles.push({ filename, fileUrl });
    }
    const prompt = buildLlmsTxtPrompt({
      siteType: (formData.get("siteType") as string) ?? "",
      title: (formData.get("title") as string) ?? "",
      roleSummary: (formData.get("roleSummary") as string) ?? "",
      sectionsOutline: (formData.get("sectionsOutline") as string) ?? "",
      notesForAi: (formData.get("notesForAi") as string) ?? "",
      docsAiFiles: docsAiFiles.length ? docsAiFiles : undefined,
    });
    return Response.json({ prompt });
  }

  if (intent === "generateLlmsTxt") {
    try {
      const count = Math.min(parseInt(String(formData.get("docsAiCount") || "0"), 10) || 0, MAX_DOCS_AI_ROWS);
      const docsAiFiles: { filename: string; fileUrl?: string | null }[] = [];
      for (let i = 0; i < count; i++) {
        const filename = (formData.get(`docsAiFilename_${i}`) as string)?.trim();
        if (!filename) continue;
        const fileUrl = (formData.get(`docsAiFileUrl_${i}`) as string)?.trim() || null;
        docsAiFiles.push({ filename, fileUrl });
      }
      const prompt = buildLlmsTxtPrompt({
        siteType: (formData.get("siteType") as string) ?? "",
        title: (formData.get("title") as string) ?? "",
        roleSummary: (formData.get("roleSummary") as string) ?? "",
        sectionsOutline: (formData.get("sectionsOutline") as string) ?? "",
        notesForAi: (formData.get("notesForAi") as string) ?? "",
        docsAiFiles: docsAiFiles.length ? docsAiFiles : undefined,
      });
      const apiKey = await getDecryptedOpenAiKey(shop);
      if (!apiKey) {
        return Response.json({ error: "API_KEY_REQUIRED" }, { status: 400 });
      }
      const result = await generateLlmsTxtBody(prompt, apiKey);
      if (!result.ok) {
        return Response.json({ error: result.error ?? "OPENAI_ERROR" }, { status: 502 });
      }
      return Response.json({ body: result.body });
    } catch (err) {
      console.error("[ap-llmo] generateLlmsTxt error:", err);
      const message = err instanceof Error ? err.message : String(err);
      return Response.json(
        { error: "GENERATE_FAILED", message: message.slice(0, 200) },
        { status: 500 }
      );
    }
  }

  if (intent === "save") {
    const count = Math.min(parseInt(String(formData.get("docsAiCount") || "0"), 10) || 0, MAX_DOCS_AI_ROWS);
    const docs: DocsAiFileEntry[] = [];
    for (let i = 0; i < count; i++) {
      const filename = (formData.get(`docsAiFilename_${i}`) as string)?.trim() ?? "";
      const content = (formData.get(`docsAiContent_${i}`) as string) ?? "";
      const fileId = (formData.get(`docsAiFileId_${i}`) as string)?.trim() || null;
      const fileUrl = (formData.get(`docsAiFileUrl_${i}`) as string)?.trim() || null;
      docs.push({ filename, content, fileId: fileId || undefined, fileUrl: fileUrl || undefined });
    }
    const uploadedDocs = await createOrUpdateDocsAiFiles(admin, docs);

    const openaiApiKeyRaw = (formData.get("openaiApiKey") as string)?.trim() ?? "";
    const openaiApiKeyEncrypted =
      openaiApiKeyRaw.length > 0
        ? (() => {
            try {
              return encrypt(openaiApiKeyRaw);
            } catch {
              return null;
            }
          })()
        : null;

    const baseCreate = {
      shop,
      siteType: (formData.get("siteType") as string) || null,
      title: (formData.get("title") as string) || null,
      roleSummary: (formData.get("roleSummary") as string) || null,
      sectionsOutline: (formData.get("sectionsOutline") as string) || null,
      notesForAi: (formData.get("notesForAi") as string) || null,
      llmsTxtBody: (formData.get("llmsTxtBody") as string) || null,
      docsAiFiles: JSON.stringify(uploadedDocs),
    };
    const baseUpdate = {
      siteType: (formData.get("siteType") as string) || null,
      title: (formData.get("title") as string) || null,
      roleSummary: (formData.get("roleSummary") as string) || null,
      sectionsOutline: (formData.get("sectionsOutline") as string) || null,
      notesForAi: (formData.get("notesForAi") as string) || null,
      llmsTxtBody: (formData.get("llmsTxtBody") as string) || null,
      docsAiFiles: JSON.stringify(uploadedDocs),
    };

    await prisma.llmoSettings.upsert({
      where: { shop },
      create: {
        ...baseCreate,
        ...(openaiApiKeyEncrypted != null && { openaiApiKey: openaiApiKeyEncrypted }),
      },
      update: {
        ...baseUpdate,
        ...(openaiApiKeyEncrypted != null && { openaiApiKey: openaiApiKeyEncrypted }),
      },
    });
    return redirect(request.url);
  }

  if (intent === "saveFile") {
    try {
      const llmsTxtBody = (formData.get("llmsTxtBody") as string) ?? "";
      const existing = await prisma.llmoSettings.findUnique({
        where: { shop },
      });
      const result = await createOrUpdateLlmsTxtFile(
        admin,
        llmsTxtBody,
        existing?.llmsTxtFileId ?? null
      );

      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: 400 }
        );
      }

      const metafieldOk = await setLlmsTxtUrlMetafield(admin, result.url);
      if (!metafieldOk) {
        console.error("[ap-llmo] metafield set failed");
      }

      await prisma.llmoSettings.upsert({
        where: { shop },
        create: {
          shop,
          llmsTxtBody,
          llmsTxtFileUrl: result.url,
          llmsTxtFileId: result.fileId,
        },
        update: {
          llmsTxtBody,
          llmsTxtFileUrl: result.url,
          llmsTxtFileId: result.fileId,
        },
      });

      return Response.json({
        ok: true,
        url: result.url,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ap-llmo] saveFile error:", err);
      return Response.json(
        { ok: false, error: message },
        { status: 500 }
      );
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
  maxWidth: "400px",
  marginTop: "0.25rem",
  padding: "0.5rem 0.75rem",
  border: "1px solid #c9cccf",
  borderRadius: "6px",
  fontSize: "0.9375rem",
} as const;

const textareaStyle = {
  ...inputStyle,
  minHeight: "120px",
  resize: "vertical" as const,
};

const labelStyle = { display: "block", marginTop: "1rem", fontWeight: 600, fontSize: "0.875rem" };

const emptyDocRow = (): DocsAiFileEntry => ({
  filename: "",
  content: "",
  fileId: null,
  fileUrl: null,
});

export default function AppIndex() {
  const data = useLoaderData<Awaited<ReturnType<typeof loader>>>();
  const t = data.t;
  const fetcher = useFetcher<{ prompt?: string; body?: string; error?: string; message?: string; ok?: boolean; url?: string }>();
  const prompt = fetcher.data?.prompt;
  const lastIntent = (fetcher.formData as FormData | undefined)?.get("intent");
  const isPromptLoading = fetcher.state !== "idle" && lastIntent === "getPrompt";
  const isAiGenerating = fetcher.state !== "idle" && lastIntent === "generateLlmsTxt";
  const fileResult =
    lastIntent === "saveFile"
      ? (fetcher.data as { ok?: boolean; error?: string; url?: string } | undefined)
      : null;
  // 400 などで intent が消えてもエラー本文を表示（generateLlmsTxt は上記ブロックで表示するので除外）
  const anyFetcherError =
    fetcher.state === "idle" &&
    lastIntent !== "generateLlmsTxt" &&
    fetcher.data &&
    typeof (fetcher.data as { error?: string }).error === "string" &&
    !(fetcher.data as { body?: string }).body &&
    !(fetcher.data as { prompt?: string }).prompt
      ? (fetcher.data as { error: string }).error
      : null;
  const llmsTxtBodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.body && llmsTxtBodyRef.current) {
      llmsTxtBodyRef.current.value = fetcher.data.body;
    }
  }, [fetcher.state, fetcher.data?.body]);

  // API Key 未設定などでサーバーがエラーを返したときに alert 表示
  useEffect(() => {
    const intent = (fetcher.formData as FormData | undefined)?.get("intent");
    if (
      fetcher.state === "idle" &&
      intent === "generateLlmsTxt" &&
      fetcher.data?.error === "API_KEY_REQUIRED"
    ) {
      alert(t.aiErrorNoKey);
    }
  }, [fetcher.state, fetcher.formData, fetcher.data?.error, t.aiErrorNoKey]);

  const initialDocs =
    data.settings.docsAiFiles?.length > 0
      ? data.settings.docsAiFiles
      : [emptyDocRow()];
  const [docsRows, setDocsRows] = useState<DocsAiFileEntry[]>(initialDocs);

  const addDocRow = useCallback(() => {
    setDocsRows((prev) => (prev.length >= MAX_DOCS_AI_ROWS ? prev : [...prev, emptyDocRow()]));
  }, []);
  const removeDocRow = useCallback((index: number) => {
    setDocsRows((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const copyPrompt = () => {
    if (prompt) {
      navigator.clipboard.writeText(prompt);
      const btn = document.getElementById("copy-prompt-btn");
      if (btn) {
        const prev = btn.textContent;
        btn.textContent = t.copied;
        setTimeout(() => { btn.textContent = prev; }, 1500);
      }
    }
  };

  const docsAiCount = data.settings.docsAiFiles?.length ?? 0;
  const llmsTxtSet = Boolean(data.settings.llmsTxtFileUrl?.trim());
  const loaderError = (data as { loaderError?: string | null }).loaderError;

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

      <main style={{ minWidth: 0 }}>
      {loaderError && (
        <p style={{ padding: "1rem", marginBottom: "1rem", background: "#fef2f2", color: "#b91c1c", borderRadius: "8px", fontSize: "0.9375rem" }}>
          {t.error}: {loaderError}
        </p>
      )}
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>{t.appTitle}</h1>
      <p style={{ color: "#6d7175", fontSize: "0.9375rem", marginBottom: "1rem" }}>
        {data.locale === "ja" ? "ストアの " : ""}<code>&lt;head&gt;</code>{data.locale === "ja" ? " に、LLM・エージェント向け文書へのリンクを追加するアプリです。" : <> {t.appDesc}<code>&lt;head&gt;</code>.</>}
      </p>

      {/* このアプリの思想 */}
      <section style={{ ...sectionStyle, borderLeft: "4px solid #2c6ecb" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.philosophyTitle}</h2>
          <p style={{ margin: 0, fontSize: "0.9375rem", lineHeight: 1.7 }}>
          {(() => {
            const boldPhrase = data.locale === "en" ? "don't let it tell lies" : "嘘をつかせない";
            const parts = t.philosophyBody.split(boldPhrase);
            return (
              <>
                {parts[0]}
                <strong>{boldPhrase}</strong>
                {parts[1] ?? ""}
              </>
            );
          })()}
        </p>
        <p style={{ margin: "0.75rem 0 0 0", fontSize: "0.875rem", color: "#6d7175", lineHeight: 1.6 }}>
          {t.philosophyNote}{" "}
          <a href="https://www.andplus.co.jp/llms.txt" target="_blank" rel="noopener noreferrer">{t.andplusLlmsRef}</a>
        </p>
      </section>

      {/* 設定フォーム（思想・プロトコル：あんどぷらす llms.txt 参照） */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>{t.llmsTxtSettings}</h2>
        <p style={{ fontSize: "0.8125rem", color: "#6d7175", marginBottom: "0.75rem" }}>
          {t.llmsTxtSettingsNote}{" "}
          <a href="https://www.andplus.co.jp/llms.txt" target="_blank" rel="noopener noreferrer">{t.andplusLlmsRef}</a>
        </p>
        <Form method="post" id="llmo-form">
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="docsAiCount" value={docsRows.length} />

          <label style={labelStyle}>
            {t.siteType}
            <select name="siteType" style={inputStyle} defaultValue={data.settings.siteType}>
              <option value="corporate">{t.siteTypeCorporate}</option>
              <option value="ec">{t.siteTypeEc}</option>
              <option value="corporate_ec">{t.siteTypeCorporateEc}</option>
            </select>
          </label>

          <label style={labelStyle}>
            {t.titleLabel}
            <input
              type="text"
              name="title"
              style={inputStyle}
              defaultValue={data.settings.title}
              placeholder={t.titlePlaceholder}
            />
          </label>

          <label style={labelStyle}>
            {t.roleSummaryLabel}
            <textarea
              name="roleSummary"
              style={textareaStyle}
              defaultValue={data.settings.roleSummary}
              placeholder={t.roleSummaryPlaceholder}
            />
          </label>

          <label style={labelStyle}>
            {t.sectionsOutlineLabel}
            <textarea
              name="sectionsOutline"
              style={textareaStyle}
              defaultValue={data.settings.sectionsOutline}
              placeholder={t.sectionsOutlinePlaceholder}
            />
          </label>

          <label style={labelStyle}>
            {t.notesForAiLabel}
            <textarea
              name="notesForAi"
              style={textareaStyle}
              defaultValue={data.settings.notesForAi}
              placeholder={t.notesForAiPlaceholder}
            />
          </label>

          <label style={labelStyle}>
            {t.openaiApiKeyLabel}
            <input
              type="password"
              name="openaiApiKey"
              style={inputStyle}
              placeholder={t.openaiApiKeyPlaceholder}
              autoComplete="off"
            />
            {data.settings.openaiApiKeySet && (
              <span style={{ display: "block", fontSize: "0.8125rem", color: "#6d7175", marginTop: "0.25rem" }}>
                {t.openaiApiKeySetNote}
              </span>
            )}
          </label>

          {/* docs/ai 用 md：動的に行追加（最大10） */}
          <section style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid #e1e3e5" }}>
            <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.25rem" }}>{t.docsAiSectionTitle}</h3>
            <p style={{ fontSize: "0.8125rem", color: "#6d7175", marginBottom: "0.75rem" }}>{t.docsAiSectionNote}</p>
            {docsRows.map((row, i) => (
              <div key={i} style={{ marginBottom: "1rem", padding: "0.75rem", background: "#fff", borderRadius: "6px", border: "1px solid #e1e3e5" }}>
                <input type="hidden" name={`docsAiFileId_${i}`} value={row.fileId ?? ""} />
                <input type="hidden" name={`docsAiFileUrl_${i}`} value={row.fileUrl ?? ""} />
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
                  <label style={{ ...labelStyle, marginTop: 0, flex: "1 1 auto" }}>
                    {t.docsAiFilename}
                    <input
                      type="text"
                      name={`docsAiFilename_${i}`}
                      style={inputStyle}
                      defaultValue={row.filename}
                      placeholder={t.docsAiFilenamePlaceholder}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeDocRow(i)}
                    style={{ alignSelf: "flex-end", padding: "0.4rem 0.75rem", borderRadius: "6px", border: "1px solid #c9cccf", background: "#fff", cursor: "pointer", fontSize: "0.8125rem" }}
                  >
                    {t.removeRow}
                  </button>
                </div>
                <label style={{ ...labelStyle, marginTop: "0.5rem" }}>
                  {t.docsAiContent}
                  <textarea
                    name={`docsAiContent_${i}`}
                    style={{ ...textareaStyle, minHeight: "80px" }}
                    defaultValue={row.content}
                  />
                </label>
                {row.fileUrl && (
                  <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.75rem", color: "#6d7175" }}>
                    URL: <a href={row.fileUrl} target="_blank" rel="noopener noreferrer">{row.fileUrl}</a>
                  </p>
                )}
              </div>
            ))}
            {docsRows.length < MAX_DOCS_AI_ROWS && (
              <button
                type="button"
                onClick={addDocRow}
                style={{ padding: "0.4rem 0.75rem", borderRadius: "6px", border: "1px dashed #6d7175", background: "#fff", cursor: "pointer", fontSize: "0.875rem", color: "#6d7175" }}
              >
                + {t.addRow}
              </button>
            )}
          </section>

          <label style={labelStyle}>
            {t.llmsTxtBodyLabel}
            <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.8125rem", color: "#6d7175", lineHeight: 1.5 }}>
              {t.llmsTxtBodyHint}
            </p>
            <textarea
              ref={llmsTxtBodyRef}
              name="llmsTxtBody"
              form="llmo-form"
              style={{ ...textareaStyle, minHeight: "200px", marginTop: "0.5rem" }}
              defaultValue={data.settings.llmsTxtBody}
              placeholder={t.llmsTxtBodyPlaceholder}
            />
          </label>

          {fetcher.data?.error && lastIntent === "generateLlmsTxt" && (
            <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#b98900" }}>
              {fetcher.data.error === "API_KEY_REQUIRED"
                ? t.aiErrorNoKey
                : fetcher.data.error === "GENERATE_FAILED"
                  ? fetcher.data.message
                    ? `${t.aiErrorFailed} ${fetcher.data.message}`
                    : t.aiErrorFailed
                  : t.error}
            </p>
          )}

          <div style={{ marginTop: "1.25rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button type="submit" style={{ padding: "0.5rem 1rem", borderRadius: "6px", border: "1px solid #2c6ecb", background: "#2c6ecb", color: "#fff", cursor: "pointer", fontSize: "0.9375rem" }}>
              {t.saveSettings}
            </button>
            <button
              type="button"
              style={{ padding: "0.5rem 1rem", borderRadius: "6px", border: "1px solid #6d7175", background: "#fff", cursor: "pointer", fontSize: "0.9375rem" }}
              onClick={() => {
                const form = document.getElementById("llmo-form") as HTMLFormElement;
                if (!form) return;
                const fd = new FormData(form);
                fd.set("intent", "getPrompt");
                fetcher.submit(fd, { method: "post" });
              }}
              disabled={isPromptLoading}
            >
              {isPromptLoading ? t.generating : t.generatePrompt}
            </button>
            <button
              type="button"
              style={{ padding: "0.5rem 1rem", borderRadius: "6px", border: "1px solid #008060", background: "#008060", color: "#fff", cursor: "pointer", fontSize: "0.9375rem", display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
              onClick={() => {
                if (!data.settings.openaiApiKeySet) {
                  alert(t.aiErrorNoKey);
                  return;
                }
                const form = document.getElementById("llmo-form") as HTMLFormElement;
                if (!form) return;
                const fd = new FormData(form);
                fd.set("intent", "generateLlmsTxt");
                fetcher.submit(fd, { method: "post" });
              }}
              disabled={isAiGenerating}
            >
              {isAiGenerating && (
                <span
                  style={{
                    display: "inline-block",
                    width: "1em",
                    height: "1em",
                    border: "2px solid rgba(255,255,255,0.3)",
                    borderTopColor: "#fff",
                    borderRadius: "50%",
                    animation: "ap-llmo-spin 0.7s linear infinite",
                  }}
                  aria-hidden
                />
              )}
              {isAiGenerating ? t.aiGenerating : t.aiGenerate}
            </button>
            <button
              type="button"
              style={{ padding: "0.5rem 1rem", borderRadius: "6px", border: "1px solid #008060", background: "#008060", color: "#fff", cursor: "pointer", fontSize: "0.9375rem" }}
              onClick={() => {
                const body = llmsTxtBodyRef.current?.value?.trim() ?? "";
                if (!body) {
                  alert(t.saveFileBodyEmpty);
                  return;
                }
                const form = document.getElementById("llmo-form") as HTMLFormElement;
                if (!form) return;
                const fd = new FormData(form);
                fd.set("intent", "saveFile");
                fetcher.submit(fd, { method: "post" });
              }}
            >
              {t.saveFile}
            </button>
          </div>
        </Form>
      </section>

      {/* プロンプト表示・コピー・AI への渡し方案内 */}
      {prompt != null && (
        <section style={{ ...sectionStyle, marginTop: "1rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.generatedPromptTitle}</h2>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, padding: "0.75rem", background: "#fff", border: "1px solid #e1e3e5", borderRadius: "6px", fontSize: "0.8125rem", maxHeight: "300px", overflow: "auto" }}>
            {prompt}
          </pre>
          <button
            id="copy-prompt-btn"
            type="button"
            onClick={copyPrompt}
            style={{ marginTop: "0.5rem", padding: "0.4rem 0.75rem", borderRadius: "6px", border: "1px solid #6d7175", background: "#fff", cursor: "pointer", fontSize: "0.875rem" }}
          >
            {t.copy}
          </button>
          <p style={{ marginTop: "0.75rem", fontSize: "0.8125rem", color: "#6d7175", lineHeight: 1.6 }}>
            {t.promptToAiGuide}
          </p>
        </section>
      )}

      {fileResult?.ok && <p style={{ marginTop: "1rem", color: "#008060", fontSize: "0.9375rem" }}>{t.fileSaved}</p>}
      {(fileResult && !fileResult.ok ? fileResult.error : anyFetcherError) && (
        <p style={{ marginTop: "1rem", color: "#b98900", fontSize: "0.9375rem" }}>
          {t.error}: {fileResult && !fileResult.ok ? fileResult.error : anyFetcherError}
        </p>
      )}

      {data.settings.llmsTxtFileUrl && (
        <p style={{ marginTop: "1rem", fontSize: "0.875rem", color: "#6d7175" }}>
          {t.llmsTxtUrl}: <a href={data.settings.llmsTxtFileUrl} target="_blank" rel="noopener noreferrer">{data.settings.llmsTxtFileUrl}</a>
        </p>
      )}
      </main>

      <aside style={{ position: "sticky", top: "1rem" }}>
        <section style={sectionStyle}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.sidebarStatusTitle}</h2>
          <ul style={{ ...listStyle, margin: 0, fontSize: "0.875rem" }}>
            <li>{llmsTxtSet ? t.statusLlmsTxtSet : t.statusLlmsTxtNotSet}</li>
            <li>{t.statusDocsAiCount.replace("{count}", String(docsAiCount))}</li>
          </ul>
        </section>

        <section style={sectionStyle}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.sidebarRefTitle}</h2>
          <ul style={{ ...listStyle, margin: 0, fontSize: "0.875rem" }}>
            <li>
              <a href="https://www.andplus.co.jp/llms.txt" target="_blank" rel="noopener noreferrer">{t.andplusLlmsRef}</a>
            </li>
            <li>
              <a href="https://www.andplus.co.jp/docs/ai/README.md" target="_blank" rel="noopener noreferrer">{t.andplusDocsAiRef}</a>
            </li>
          </ul>
        </section>

        <section style={sectionStyle}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.guideReadmeTitle}</h2>
          <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.8125rem", color: "#6d7175", lineHeight: 1.5 }}>{t.guideReadmeIntro}</p>
          <ul style={{ ...listStyle, margin: 0, fontSize: "0.8125rem", lineHeight: 1.6 }}>
            <li>{t.guideReadmeWelcome}</li>
            <li>{t.guideReadmePrimary}</li>
            <li>{t.guideReadmeExternal}</li>
            <li>{t.guideReadmeGuidelines}</li>
          </ul>
        </section>

        <section style={sectionStyle}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.whatThisAppDoes}</h2>
          <ul style={listStyle}>
            <li>
              {t.whatThisAppDoesList1.split(/(<head>)/i).map((part, i) =>
                part.toLowerCase() === "<head>" ? <code key={i}>&lt;head&gt;</code> : part
              )}
            </li>
          </ul>
          <ul style={{ ...listStyle, marginTop: "0.5rem" }}>
            <li><strong>llms.txt</strong> — {t.llmsTxtItem}</li>
            <li><strong>llms.full.txt</strong> — {t.llmsFullTxtItem}</li>
            <li><strong>docs/ai/*.md</strong> — {t.docsAiItem}</li>
          </ul>
        </section>

        <section style={sectionStyle}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.setupTitle}</h2>
          <ol style={listStyle}>
            <li>{t.setup1}</li>
            <li>{t.setup2}</li>
            <li>{t.setup3}</li>
          </ol>
        </section>
      </aside>
    </div>
  );
}
