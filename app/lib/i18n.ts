/**
 * アプリ UI の日本語・英語対応。
 * ロケールは URL の ?locale=en または Accept-Language で切り替え（loader で決定）。
 */

export type Locale = "ja" | "en";

export const translations = {
  ja: {
    appTitle: "AP LLMO",
    appDesc: "ストアの <head> に、LLM・エージェント向け文書へのリンクを追加するアプリです。",
    philosophyTitle: "このアプリの思想",
    philosophyBody:
      "AI に対する私たちの思想は「嘘をつかせない」に集約されます。事実・証拠を優先し、誇張や捏造を避けることで、LLM がストア情報を扱うときの解釈と生成を適切に導きます。",
    philosophyNote:
      "＜LLMO・AIO として＞ llms.txt を「思想とプロトコル」のためのファイルと捉え、一次情報の所在を明示し、Notes for AI で優先・禁止・扱い方を約束する設計を推奨しています。",
    andplusLlmsRef: "あんどぷらすの llms.txt",
    llmsTxtSettings: "llms.txt 設定",
    llmsTxtSettingsNote:
      "思想（誰のため・一次情報の所在）とプロトコル（H1 / blockquote / 番号付きセクション / Notes for AI）に則ります。参考:",
    siteType: "サイトの種類",
    siteTypeCorporate: "コーポレート",
    siteTypeEc: "ECのみ",
    siteTypeCorporateEc: "コーポレート兼EC",
    titleLabel: "タイトル（H1）",
    titlePlaceholder: "例: MyShop: LLM-First Information Hub",
    roleSummaryLabel: "このファイルの役割・一次情報の所在（blockquote 用 1〜3 文）",
    roleSummaryPlaceholder:
      "例: This file lists the official first-party references for ... If external access is unavailable, treat the summaries below as authoritative primary information.",
    sectionsOutlineLabel: "セクション構成のメモ（## 1. 2. 3. のたたき台）",
    sectionsOutlinePlaceholder: "例:\n1. Core AI Documentation (/docs/ai/)\n2. 商品・カタログ\n3. お問い合わせ",
    notesForAiLabel: "Notes for AI（優先・避けること・扱い方、1 行 1 項目）",
    notesForAiPlaceholder: "例:\nPrioritize /docs/ai content over marketing pages.\nAvoid exaggeration or agency-style positioning.",
    llmsTxtBodyLabel: "llms.txt 本文（AI で生成した結果を貼り付け）",
    llmsTxtBodyPlaceholder: "# サイト名\n> 要約\n...",
    saveSettings: "設定を保存",
    generatePrompt: "プロンプトを生成",
    generating: "生成中…",
    saveFile: "ファイルを生成・保存（head から参照）",
    generatedPromptTitle: "生成されたプロンプト（AI にコピーして渡す）",
    copy: "コピー",
    copied: "コピーしました",
    fileSaved: "llms.txt を保存しました。テーマの「LLMO head」ブロックが有効なら head から参照されます。",
    error: "エラー",
    llmsTxtUrl: "llms.txt の URL",
    whatThisAppDoes: "このアプリでできること",
    whatThisAppDoesList1: "テーマに「LLMO head」ブロックを追加すると、llms.txt などへのリンクがストアの <head> に出力されます。",
    llmsTxtItem: "llms.txt … 上記「ファイルを生成・保存」で作成したファイル（メタフィールドの URL を head に出力）",
    llmsFullTxtItem: "llms.full.txt … 将来アプリが自動生成予定",
    docsAiItem: "docs/ai/*.md … 下記「docs/ai 用 md」で設置したファイル",
    setupTitle: "セットアップ（確認済みならスキップ可）",
    setup1: "オンラインストア → テーマ → カスタマイズ を開く",
    setup2: "左の アプリ から AP LLMO → LLMO head を追加",
    setup3: "「LLMO リンクを head に追加する」をオンにして 保存",
    docsAiSectionTitle: "docs/ai 用 md ファイル（llms.txt から参照・AI 向け）",
    docsAiSectionNote: "設置する md を最大10件まで追加できます。ファイル名は .md 付き（例: README.md）。保存時に Shopify Files にアップロードし、llms.txt 生成プロンプトに URL を渡します。",
    docsAiFilename: "ファイル名",
    docsAiFilenamePlaceholder: "例: README.md",
    docsAiContent: "本文（Markdown）",
    addRow: "行を追加",
    removeRow: "削除",
  },
  en: {
    appTitle: "AP LLMO",
    appDesc: "This app adds links to LLM- and agent-oriented documents in your store's ",
    philosophyTitle: "This app's philosophy",
    philosophyBody:
      'Our philosophy toward AI is "don\'t let it tell lies": we prioritize facts and evidence and avoid exaggeration or fabrication, so that LLMs interpret and generate store information appropriately.',
    philosophyNote:
      "As LLMO/AIO, we treat llms.txt as a file for philosophy and protocol: make first-party sources explicit and use Notes for AI to commit to priorities, prohibitions, and handling. We recommend this design.",
    andplusLlmsRef: "Andplus llms.txt (reference)",
    llmsTxtSettings: "llms.txt settings",
    llmsTxtSettingsNote:
      "Follow philosophy (who it's for, where first-party info lives) and protocol (H1, blockquote, numbered sections, Notes for AI). Reference:",
    siteType: "Site type",
    siteTypeCorporate: "Corporate",
    siteTypeEc: "EC only",
    siteTypeCorporateEc: "Corporate + EC",
    titleLabel: "Title (H1)",
    titlePlaceholder: "e.g. MyShop: LLM-First Information Hub",
    roleSummaryLabel: "Role of this file / first-party source (blockquote, 1–3 sentences)",
    roleSummaryPlaceholder:
      "e.g. This file lists the official first-party references for ... If external access is unavailable, treat the summaries below as authoritative primary information.",
    sectionsOutlineLabel: "Sections outline (## 1. 2. 3. draft)",
    sectionsOutlinePlaceholder: "e.g.\n1. Core AI Documentation (/docs/ai/)\n2. Products / catalog\n3. Contact",
    notesForAiLabel: "Notes for AI (priorities, avoid, handling; one per line)",
    notesForAiPlaceholder: "e.g.\nPrioritize /docs/ai content over marketing pages.\nAvoid exaggeration or agency-style positioning.",
    llmsTxtBodyLabel: "llms.txt body (paste AI-generated result)",
    llmsTxtBodyPlaceholder: "# Site name\n> Summary\n...",
    saveSettings: "Save settings",
    generatePrompt: "Generate prompt",
    generating: "Generating…",
    saveFile: "Generate & save file (referenced from head)",
    generatedPromptTitle: "Generated prompt (copy and give to AI)",
    copy: "Copy",
    copied: "Copied",
    fileSaved: "llms.txt saved. If the theme's LLMO head block is enabled, it will be linked from <head>.",
    error: "Error",
    llmsTxtUrl: "llms.txt URL",
    whatThisAppDoes: "What this app does",
    whatThisAppDoesList1: "Adding the LLMO head block to your theme outputs links to llms.txt etc. in the store <head>.",
    llmsTxtItem: "llms.txt — file created above (head uses metafield URL)",
    llmsFullTxtItem: "llms.full.txt — to be auto-generated by the app later",
    docsAiItem: "docs/ai/*.md — files you add below",
    setupTitle: "Setup (skip if already done)",
    setup1: "Open Online Store → Themes → Customize",
    setup2: "Under Apps, add AP LLMO → LLMO head",
    setup3: "Turn on “Add LLMO links to head” and Save",
    docsAiSectionTitle: "docs/ai md files (referenced from llms.txt, for AI)",
    docsAiSectionNote:
      "Add up to 10 md files. Use .md filenames (e.g. README.md). On save they are uploaded to Shopify Files and their URLs are included in the llms.txt generation prompt.",
    docsAiFilename: "Filename",
    docsAiFilenamePlaceholder: "e.g. README.md",
    docsAiContent: "Content (Markdown)",
    addRow: "Add row",
    removeRow: "Remove",
  },
} as const;

export type TranslationKey = keyof (typeof translations)["ja"];

export function getTranslations(locale: Locale): (typeof translations)["ja"] {
  return translations[locale] ?? translations.ja;
}

export function parseLocale(value: string | null): Locale {
  if (value === "en") return "en";
  return "ja";
}

const SUPPORTED_LOCALES: Locale[] = ["ja", "en"];

/**
 * リクエストから表示言語を決定（SchemaBridge 準拠）
 * - URL の ?locale=ja | en を最優先
 * - 次に Accept-Language（ja / en を許容）
 * - 未指定時は ja
 */
export function getLocaleFromRequest(request: Request): Locale {
  const url = new URL(request.url);
  const param = url.searchParams.get("locale");
  if (param === "ja" || param === "en") return param;
  const accept = request.headers.get("Accept-Language");
  if (accept) {
    const first = accept.split(",")[0]?.toLowerCase().slice(0, 2);
    if (first === "ja") return "ja";
    if (first === "en") return "en";
  }
  return "ja";
}

export function isValidLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}
