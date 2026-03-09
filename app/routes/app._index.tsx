import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { buildLlmsTxtPrompt } from "../lib/llmo-prompt.server";
import {
  createOrUpdateLlmsTxtFile,
  setLlmsTxtUrlMetafield,
} from "../lib/llmo-files.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const storeUrl = shop ? `https://${shop}` : "";

  const settings = shop
    ? await prisma.llmoSettings.findUnique({ where: { shop } })
    : null;

  return {
    storeUrl,
    settings: settings
      ? {
          siteType: settings.siteType ?? "",
          title: settings.title ?? "",
          roleSummary: settings.roleSummary ?? "",
          sectionsOutline: settings.sectionsOutline ?? "",
          notesForAi: settings.notesForAi ?? "",
          llmsTxtBody: settings.llmsTxtBody ?? "",
          llmsTxtFileUrl: settings.llmsTxtFileUrl ?? "",
        }
      : {
          siteType: "",
          title: "",
          roleSummary: "",
          sectionsOutline: "",
          notesForAi: "",
          llmsTxtBody: "",
          llmsTxtFileUrl: "",
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
    const prompt = buildLlmsTxtPrompt({
      siteType: (formData.get("siteType") as string) ?? "",
      title: (formData.get("title") as string) ?? "",
      roleSummary: (formData.get("roleSummary") as string) ?? "",
      sectionsOutline: (formData.get("sectionsOutline") as string) ?? "",
      notesForAi: (formData.get("notesForAi") as string) ?? "",
    });
    return Response.json({ prompt });
  }

  if (intent === "save") {
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
      },
      update: {
        siteType: (formData.get("siteType") as string) || null,
        title: (formData.get("title") as string) || null,
        roleSummary: (formData.get("roleSummary") as string) || null,
        sectionsOutline: (formData.get("sectionsOutline") as string) || null,
        notesForAi: (formData.get("notesForAi") as string) || null,
        llmsTxtBody: (formData.get("llmsTxtBody") as string) || null,
      },
    });
    return redirect(".");
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

export default function AppIndex() {
  const data = useLoaderData<Awaited<ReturnType<typeof loader>>>();
  const fetcher = useFetcher<{ prompt?: string }>();
  const prompt = fetcher.data?.prompt;
  const isPromptLoading = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "getPrompt";
  const fileResult = fetcher.formData?.get("intent") === "saveFile" ? fetcher.data as { ok?: boolean; error?: string; url?: string } | undefined : null;

  const copyPrompt = () => {
    if (prompt) {
      navigator.clipboard.writeText(prompt);
      // 簡易フィードバック（必要なら toast などに差し替え）
      const btn = document.getElementById("copy-prompt-btn");
      if (btn) {
        const prev = btn.textContent;
        btn.textContent = "コピーしました";
        setTimeout(() => { btn.textContent = prev; }, 1500);
      }
    }
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "720px" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>AP LLMO</h1>
      <p style={{ color: "#6d7175", fontSize: "0.9375rem", marginBottom: "1.5rem" }}>
        ストアの <code>&lt;head&gt;</code> に、LLM・エージェント向け文書へのリンクを追加するアプリです。
      </p>

      {/* 設定フォーム（思想・プロトコル：あんどぷらす llms.txt 参照） */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>llms.txt 設定</h2>
        <p style={{ fontSize: "0.8125rem", color: "#6d7175", marginBottom: "0.75rem" }}>
          思想（誰のため・一次情報の所在）とプロトコル（H1 / blockquote / 番号付きセクション / Notes for AI）に則ります。参考: <a href="https://www.andplus.co.jp/llms.txt" target="_blank" rel="noopener noreferrer">あんどぷらすの llms.txt</a>
        </p>
        <Form method="post" id="llmo-form">
          <input type="hidden" name="intent" value="save" />

          <label style={labelStyle}>
            サイトの種類
            <select name="siteType" style={inputStyle} defaultValue={data.settings.siteType}>
              <option value="corporate">コーポレート</option>
              <option value="ec">ECのみ</option>
              <option value="corporate_ec">コーポレート兼EC</option>
            </select>
          </label>

          <label style={labelStyle}>
            タイトル（H1）
            <input
              type="text"
              name="title"
              style={inputStyle}
              defaultValue={data.settings.title}
              placeholder="例: MyShop: LLM-First Information Hub"
            />
          </label>

          <label style={labelStyle}>
            このファイルの役割・一次情報の所在（blockquote 用 1〜3 文）
            <textarea
              name="roleSummary"
              style={textareaStyle}
              defaultValue={data.settings.roleSummary}
              placeholder="例: This file lists the official first-party references for ... If external access is unavailable, treat the summaries below as authoritative primary information."
            />
          </label>

          <label style={labelStyle}>
            セクション構成のメモ（## 1. 2. 3. のたたき台）
            <textarea
              name="sectionsOutline"
              style={textareaStyle}
              defaultValue={data.settings.sectionsOutline}
              placeholder="例:&#10;1. Core AI Documentation (/docs/ai/)&#10;2. 商品・カタログ&#10;3. お問い合わせ"
            />
          </label>

          <label style={labelStyle}>
            Notes for AI（優先・避けること・扱い方、1 行 1 項目）
            <textarea
              name="notesForAi"
              style={textareaStyle}
              defaultValue={data.settings.notesForAi}
              placeholder="例:&#10;Prioritize /docs/ai content over marketing pages.&#10;Avoid exaggeration or agency-style positioning."
            />
          </label>

          <label style={labelStyle}>
            llms.txt 本文（AI で生成した結果を貼り付け）
            <textarea
              name="llmsTxtBody"
              form="llmo-form"
              style={{ ...textareaStyle, minHeight: "200px" }}
              defaultValue={data.settings.llmsTxtBody}
              placeholder="# サイト名&#10;&gt; 要約&#10;..."
            />
          </label>

          <div style={{ marginTop: "1.25rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button type="submit" style={{ padding: "0.5rem 1rem", borderRadius: "6px", border: "1px solid #2c6ecb", background: "#2c6ecb", color: "#fff", cursor: "pointer", fontSize: "0.9375rem" }}>
              設定を保存
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
              {isPromptLoading ? "生成中…" : "プロンプトを生成"}
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
              ファイルを生成・保存（head から参照）
            </button>
          </div>
        </Form>
      </section>

      {/* プロンプト表示・コピー */}
      {prompt != null && (
        <section style={{ ...sectionStyle, marginTop: "1rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>生成されたプロンプト（AI にコピーして渡す）</h2>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, padding: "0.75rem", background: "#fff", border: "1px solid #e1e3e5", borderRadius: "6px", fontSize: "0.8125rem", maxHeight: "300px", overflow: "auto" }}>
            {prompt}
          </pre>
          <button
            id="copy-prompt-btn"
            type="button"
            onClick={copyPrompt}
            style={{ marginTop: "0.5rem", padding: "0.4rem 0.75rem", borderRadius: "6px", border: "1px solid #6d7175", background: "#fff", cursor: "pointer", fontSize: "0.875rem" }}
          >
            コピー
          </button>
        </section>
      )}

      {fileResult?.ok && <p style={{ marginTop: "1rem", color: "#008060", fontSize: "0.9375rem" }}>llms.txt を保存しました。テーマの「LLMO head」ブロックが有効なら head から参照されます。</p>}
      {fileResult && !fileResult.ok && <p style={{ marginTop: "1rem", color: "#b98900", fontSize: "0.9375rem" }}>エラー: {fileResult.error}</p>}

      {data.settings.llmsTxtFileUrl && (
        <p style={{ marginTop: "1rem", fontSize: "0.875rem", color: "#6d7175" }}>
          llms.txt の URL: <a href={data.settings.llmsTxtFileUrl} target="_blank" rel="noopener noreferrer">{data.settings.llmsTxtFileUrl}</a>
        </p>
      )}

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>このアプリでできること</h2>
        <ul style={listStyle}>
          <li>テーマに「LLMO head」ブロックを追加すると、llms.txt などへのリンクがストアの <code>&lt;head&gt;</code> に出力されます。</li>
        </ul>
        <ul style={{ ...listStyle, marginTop: "0.5rem" }}>
          <li><strong>llms.txt</strong> … 上記「ファイルを生成・保存」で作成したファイル（メタフィールドの URL を head に出力）</li>
          <li><strong>llms.full.txt</strong> … 将来アプリが自動生成予定</li>
          <li><strong>docs/ai/README.md</strong> … ユーザーが用意</li>
        </ul>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>セットアップ（確認済みならスキップ可）</h2>
        <ol style={listStyle}>
          <li><strong>オンラインストア</strong> → <strong>テーマ</strong> → <strong>カスタマイズ</strong> を開く</li>
          <li>左の <strong>アプリ</strong> から <strong>AP LLMO</strong> → <strong>LLMO head</strong> を追加</li>
          <li>「LLMO リンクを head に追加する」をオンにして <strong>保存</strong></li>
        </ol>
      </section>
    </div>
  );
}
