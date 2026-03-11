/**
 * OpenAI API の呼び出し。llms.txt 生成などで利用。
 * API Key はストアごとに DB に暗号化保存（ユーザー設定）。
 */

import prisma from "../db.server";
import { decrypt } from "./encrypt.server";

const CHAT_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

export type GenerateResult =
  | { ok: true; body: string }
  | { ok: false; error: string };

/**
 * ストアの OpenAI API Key を復号して返す。未設定なら null。
 * openaiApiKey 列がまだない DB の場合は null を返す（API Key は任意）。
 */
export async function getDecryptedOpenAiKey(shop: string): Promise<string | null> {
  try {
    const settings = await prisma.llmoSettings.findUnique({
      where: { shop },
      select: { openaiApiKey: true },
    });
    const raw = settings?.openaiApiKey;
    if (!raw?.trim()) return null;
    return decrypt(raw);
  } catch {
    return null;
  }
}

/**
 * プロンプトを OpenAI Chat Completions に送り、llms.txt 本文を生成する。
 */
export async function generateLlmsTxtBody(
  prompt: string,
  apiKey: string,
  model: string = DEFAULT_MODEL
): Promise<GenerateResult> {
  const systemContent =
    "You are an expert at writing llms.txt for LLM-oriented documentation. Output only the file content in plain text (Markdown). No commentary or explanation. Be fact-based, avoid exaggeration and fabrication.";

  const body = {
    model,
    messages: [
      { role: "system" as const, content: systemContent },
      { role: "user" as const, content: prompt },
    ],
    max_tokens: 2000,
  };

  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    let message = `OpenAI API error: ${res.status}`;
    try {
      const j = JSON.parse(err) as { error?: { message?: string } };
      if (j.error?.message) message = j.error.message;
    } catch {
      if (err) message = err.slice(0, 200);
    }
    return { ok: false, error: message };
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return { ok: false, error: "OpenAI returned no content." };
  }

  return { ok: true, body: content };
}

/**
 * 現在の llms.txt 本文と「修正したい点」から、対話的に再生成する。
 */
export async function generateLlmsTxtBodyRefinement(
  currentBody: string,
  refinementNote: string,
  apiKey: string,
  model: string = DEFAULT_MODEL
): Promise<GenerateResult> {
  const systemContent =
    "You are an expert at editing llms.txt for LLM-oriented documentation. Given the current content and the user's refinement request, output only the revised full text of the file. No commentary or explanation. Be fact-based, avoid exaggeration and fabrication.";

  const userContent =
    `【現在の llms.txt 本文】\n\n${currentBody}\n\n【ユーザーからの修正希望】\n${refinementNote}\n\n上記の希望に沿って、本文を修正した全文のみを出力してください。`;

  const body = {
    model,
    messages: [
      { role: "system" as const, content: systemContent },
      { role: "user" as const, content: userContent },
    ],
    max_tokens: 2000,
  };

  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    let message = `OpenAI API error: ${res.status}`;
    try {
      const j = JSON.parse(err) as { error?: { message?: string } };
      if (j.error?.message) message = j.error.message;
    } catch {
      if (err) message = err.slice(0, 200);
    }
    return { ok: false, error: message };
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return { ok: false, error: "OpenAI returned no content." };
  }

  return { ok: true, body: content };
}

/**
 * llms.full.txt の生データを AI で要約・整形する。
 * 冗長な部分を削り、読みやすく整えるが、誇張や情報の追加はしない。
 */
export async function refineLlmsFullTxt(
  rawText: string,
  apiKey: string,
  model: string = DEFAULT_MODEL
): Promise<GenerateResult> {
  const systemContent =
    "You are an expert at editing llms.full.txt for LLM-oriented site documentation. Given raw store data, output a concise, well-organized summary. Maintain the heading structure and list format. Be fact-based: do NOT add information, exaggerate, or fabricate. Remove redundancy and improve readability. Output only the revised text, no commentary.";

  const userContent = `以下は Shopify ストアから取得した生データです。これを llms.full.txt 用に整理・要約してください。見出し（##）とリスト（-）の構造を維持し、冗長な部分を削って読みやすくしてください。情報の追加や誇張は禁止です。

---
${rawText}
---

上記を整理・要約した llms.full.txt の全文のみを出力してください。`;

  const reqBody = {
    model,
    messages: [
      { role: "system" as const, content: systemContent },
      { role: "user" as const, content: userContent },
    ],
    max_tokens: 4000,
  };

  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(reqBody),
  });

  if (!res.ok) {
    const err = await res.text();
    let message = `OpenAI API error: ${res.status}`;
    try {
      const j = JSON.parse(err) as { error?: { message?: string } };
      if (j.error?.message) message = j.error.message;
    } catch {
      if (err) message = err.slice(0, 200);
    }
    return { ok: false, error: message };
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const refined = data.choices?.[0]?.message?.content?.trim();
  if (!refined) {
    return { ok: false, error: "OpenAI returned no content." };
  }

  return { ok: true, body: refined };
}
