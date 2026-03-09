/**
 * llms.txt 生成用プロンプトをフォーム項目から機械生成する
 */

export type PromptInput = {
  siteType: string;
  storeName: string;
  brandName: string;
  keywords: string;
  prohibitions: string;
};

const SITE_TYPE_LABELS: Record<string, string> = {
  corporate: "コーポレート",
  ec: "ECのみ",
  corporate_ec: "コーポレート兼EC",
};

export function buildLlmsTxtPrompt(input: PromptInput): string {
  const siteTypeLabel = SITE_TYPE_LABELS[input.siteType] || input.siteType || "EC";
  const storeName = input.storeName?.trim() || "[ストア名を入力]";
  const brandName = input.brandName?.trim() || storeName;
  const keywords = input.keywords?.trim() || "";
  const prohibitions = input.prohibitions?.trim()
    ? input.prohibitions
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    : ["価格・在庫の推測・捏造をしない", "在庫切れの可能性は「サイトで確認すること」と伝える"];

  const lines: string[] = [
    "あなたは、Web サイト用の llms.txt（LLM 向けの公式情報ファイル）の設計を支援する役割です。",
    "",
    "【依頼内容】",
    "",
    `1) このサイトは「${siteTypeLabel}」です。ストア名・ブランド: ${brandName}。`,
    "",
    "2) 上記を踏まえ、llms.txt の「思想・プロトコル」に沿った本文を 1 本書いてください。",
    "   - 必須: # サイト名（H1）、> 1〜3 文の要約（blockquote）、## Contact の概要",
    "   - 推奨: ## Services、## What We Do Not Do、## Key Information など",
    "   - 事実ベースで、誇張や価格の直書きは避ける",
    "",
    "3) 禁止事項として以下を反映してください:",
    ...prohibitions.map((p) => `   - ${p}`),
  ];

  if (keywords) {
    lines.push("", "4) 補足・キーワード:", `   ${keywords}`);
  }

  lines.push("", "出力は llms.txt にそのまま貼り付けできるプレーンテキスト（Markdown 形式）でお願いします。");

  return lines.join("\n");
}
