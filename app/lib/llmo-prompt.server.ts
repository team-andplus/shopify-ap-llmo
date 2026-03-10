/**
 * llms.txt 生成用プロンプトをフォーム項目から組み立てる。
 * 参考: 株式会社あんどぷらすの llms.txt（https://www.andplus.co.jp/llms.txt）
 * 思想（誰のため・一次情報の所在・優先/禁止）とプロトコル（H1, blockquote, 番号付きセクション, Notes for AI）に則る。
 */

/** llms.txt プロンプト生成時に参照させる docs/ai 用ファイル（URL ありなら llms.txt にリンクを書くよう指示） */
export type DocsAiRef = { filename: string; fileUrl?: string | null };

export type PromptInput = {
  siteType: string;
  title: string;
  roleSummary: string;
  sectionsOutline: string;
  notesForAi: string;
  /** 業種（例: アパレル、食品）。プロンプトに含めると生成が具体化する */
  industry?: string;
  /** ターゲット（例: 20–40代女性、法人担当者） */
  target?: string;
  /** 商材・取り扱い内容（例: オーガニックコスメ、業務用食材） */
  productType?: string;
  /** docs/ai 用 md 一覧。llms.txt から参照する旨を AI に指定する */
  docsAiFiles?: DocsAiRef[];
};

const SITE_TYPE_LABELS: Record<string, string> = {
  corporate: "コーポレート",
  ec: "ECのみ",
  corporate_ec: "コーポレート兼EC",
};

const ANDPLUS_LLMS_REF = "https://www.andplus.co.jp/llms.txt";

export function buildLlmsTxtPrompt(input: PromptInput): string {
  const siteTypeLabel = SITE_TYPE_LABELS[input.siteType] || input.siteType || "EC";
  const title = input.title?.trim() || "[サイト・組織名（H1）。例: MyShop: LLM-First Information Hub]";
  const roleSummary = input.roleSummary?.trim() || "";
  const sectionsOutline = input.sectionsOutline?.trim() || "";
  const notesForAi = input.notesForAi?.trim()
    ? input.notesForAi
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const lines: string[] = [
    "あなたは、Web サイト用の llms.txt（LLM 向けの公式情報ファイル）の設計を支援する役割です。",
    "",
    "【参考】株式会社あんどぷらすの llms.txt を手本にしてください。",
    `  ${ANDPLUS_LLMS_REF}`,
    "  あんどぷらすの AI に対する思想は「嘘をつかせない」に集約されます（事実・証拠を優先し、誇張や捏造を避ける）。",
    "  - H1 でサイト・組織名とサブタイトル（例: LLM-First Information Hub）",
    "  - 直後の blockquote（1〜3 文）で「誰のためのファイルか」「一次情報の所在・権威」を書く",
    "  - ## 1. 2. 3. のように番号付きセクションで構成し、各セクションにリンクや説明を並べる",
    "  - 末尾に「Notes for AI:」で優先・避けること・扱い方を明示する",
    "",
    "【依頼内容】",
    "",
    `1) このサイトの種類: ${siteTypeLabel}`,
    `2) タイトル（H1）のたたき台: ${title}`,
  ];

  const industry = input.industry?.trim();
  const target = input.target?.trim();
  const productType = input.productType?.trim();
  if (industry || target || productType) {
    lines.push("");
    if (industry) lines.push(`  業種: ${industry}`);
    if (target) lines.push(`  ターゲット: ${target}`);
    if (productType) lines.push(`  商材・取り扱い: ${productType}`);
    lines.push("");
  }

  if (roleSummary) {
    lines.push("", "3) このファイルの役割・一次情報の所在（blockquote 用）のメモ:", roleSummary);
  } else {
    lines.push("", "3) このファイルの役割・一次情報の所在（blockquote 用）: 上記参考例をまねて、誰のためのファイルか・要約を一次情報として扱う旨を 1〜3 文で書いてください。");
  }

  if (sectionsOutline) {
    lines.push("", "4) セクション構成のメモ（## 1. 2. 3. のたたき台）:", sectionsOutline);
  } else {
    lines.push("", "4) セクション構成: 参考例のように番号付きセクション（## 1. ... ## 2. ...）で、このサイトに合う構成を考えてください。");
  }

  if (notesForAi.length > 0) {
    lines.push("", "5) Notes for AI に含めたい内容（優先・避けること・扱い方）:");
    notesForAi.forEach((line) => lines.push(`   - ${line}`));
  } else {
    lines.push("", "5) Notes for AI: 参考例のように「Prioritize ...」「Avoid ...」「Treat ...」の形式で、AI への注記を 2〜4 行書いてください。");
  }

  const docsAi = input.docsAiFiles?.filter((d) => d.filename?.trim()) ?? [];
  if (docsAi.length > 0) {
    lines.push(
      "",
      "6) 以下の AI 向けドキュメント（docs/ai）を llms.txt 内で必ず参照してください。",
      "   セクション「Core AI Documentation」または「AI 向けドキュメント」を設け、各ファイルへのリンク（URL）と説明を記載してください。",
      "   AI へのプロンプトとして「これらのドキュメントを優先して参照すること」を Notes for AI に含めてください。"
    );
    docsAi.forEach((d) => {
      if (d.fileUrl) {
        lines.push(`   - ${d.filename}: ${d.fileUrl}`);
      } else {
        lines.push(`   - ${d.filename}（URL はアップロード後に設定）`);
      }
    });
  }

  lines.push(
    "",
    "出力は llms.txt にそのまま貼り付けできるプレーンテキスト（Markdown 形式）でお願いします。",
    "思想「嘘をつかせない」に沿い、事実ベースとし、誇張・捏造・価格の直書きは避けてください。"
  );

  return lines.join("\n");
}
