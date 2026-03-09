import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useFetcher } from "react-router";
import { useCallback, useState } from "react";
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
import { getTranslations, parseLocale } from "../lib/i18n";

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const storeUrl = shop ? `https://${shop}` : "";
  const url = new URL(request.url);
  const locale = parseLocale(url.searchParams.get("locale"));

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
        }
      : {
          siteType: "",
          title: "",
          roleSummary: "",
          sectionsOutline: "",
          notesForAi: "",
          llmsTxtBody: "",
          llmsTxtFileUrl: "",
          docsAiFiles: [] as DocsAiFileEntry[],
        },
  };
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

    await prisma.llmoSettings.upsert({
      where: { shop },
      create: {
        shop,
        siteType: (formData.get("siteType") as string) || null,
        title: (formData.get("title") as string) || null,
        roleSummary: (formData.get("roleSummary") as string) || null,
        sectionsOutline: (formData.get("sectionsOutline") as string) || null,
        notesForAi: (formData.get("notesForAi") as string) || null,
        llmsTxtBody: (formData.get("llmsTxtBody") as string) || null,
        docsAiFiles: JSON.stringify(uploadedDocs),
      },
      update: {
        siteType: (formData.get("siteType") as string) || null,
        title: (formData.get("title") as string) || null,
        roleSummary: (formData.get("roleSummary") as string) || null,
        sectionsOutline: (formData.get("sectionsOutline") as string) || null,
        notesForAi: (formData.get("notesForAi") as string) || null,
        llmsTxtBody: (formData.get("llmsTxtBody") as string) || null,
        docsAiFiles: JSON.stringify(uploadedDocs),
      },
    });
    return redirect(request.url);
  }

  if (intent === "saveFile") {
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
  const fetcher = useFetcher<{ prompt?: string }>();
  const prompt = fetcher.data?.prompt;
  const isPromptLoading = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "getPrompt";
  const fileResult = fetcher.formData?.get("intent") === "saveFile" ? fetcher.data as { ok?: boolean; error?: string; url?: string } | undefined : null;

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

  const localeParam = data.locale === "en" ? "?locale=en" : "";

  return (
    <div style={{ padding: "2rem", maxWidth: "720px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>{t.appTitle}</h1>
        <span style={{ fontSize: "0.875rem" }}>
          <a href={localeParam || "?"} style={{ color: "#6d7175", textDecoration: "none" }}>{data.locale === "ja" ? "日本語" : "JA"}</a>
          {" · "}
          <a href={data.locale === "en" ? "?" : "?locale=en"} style={{ color: "#6d7175", textDecoration: "none" }}>{data.locale === "en" ? "English" : "EN"}</a>
        </span>
      </div>
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
            <textarea
              name="llmsTxtBody"
              form="llmo-form"
              style={{ ...textareaStyle, minHeight: "200px" }}
              defaultValue={data.settings.llmsTxtBody}
              placeholder={t.llmsTxtBodyPlaceholder}
            />
          </label>

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
              style={{ padding: "0.5rem 1rem", borderRadius: "6px", border: "1px solid #008060", background: "#008060", color: "#fff", cursor: "pointer", fontSize: "0.9375rem" }}
              onClick={() => {
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

      {/* プロンプト表示・コピー */}
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
        </section>
      )}

      {fileResult?.ok && <p style={{ marginTop: "1rem", color: "#008060", fontSize: "0.9375rem" }}>{t.fileSaved}</p>}
      {fileResult && !fileResult.ok && <p style={{ marginTop: "1rem", color: "#b98900", fontSize: "0.9375rem" }}>{t.error}: {fileResult.error}</p>}

      {data.settings.llmsTxtFileUrl && (
        <p style={{ marginTop: "1rem", fontSize: "0.875rem", color: "#6d7175" }}>
          {t.llmsTxtUrl}: <a href={data.settings.llmsTxtFileUrl} target="_blank" rel="noopener noreferrer">{data.settings.llmsTxtFileUrl}</a>
        </p>
      )}

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.whatThisAppDoes}</h2>
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
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.setupTitle}</h2>
        <ol style={listStyle}>
          <li>{t.setup1}</li>
          <li>{t.setup2}</li>
          <li>{t.setup3}</li>
        </ol>
      </section>
    </div>
  );
}
