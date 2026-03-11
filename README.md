# shopify-ap-llmo（LLMO アプリ）

**AI/LLM 向け文書（llms.txt / .ai-context / docs/ai）を管理し、ストアの `<head>` にリンクを追加する Shopify アプリ**

---

## 概要

- **目的**: ストアの `<head>` に、LLM・AI エージェント向けの文書へのリンクを追加する
- **思想**: 「嘘をつかせない」— 事実・証拠を優先し、誇張や捏造を避けることで、AI がストア情報を適切に解釈・生成できるようにする
- **配布**: Shopify App Store（予定）

---

## 料金プラン

**1プランのみ（Free なし）**

| プラン | 価格 | トライアル |
|--------|------|-----------|
| **LLMO Pro** | $15/月 | 7日間無料 |

### 含まれる機能

- llms.txt / .ai-context 編集・AI生成
- llms.full.txt 自動生成・毎日更新
- docs/ai 5件
- sitemap-ai.xml
- 全 head リンク自動設置
- AI ボットログ（500件）
- 週次レポートメール

※ OpenAI API Key はユーザー持ち込み

詳細は `docs/料金とプラン方針.md` を参照。

---

## 機能一覧

### 1. AI 向け文書の生成・管理

| ファイル | 役割 | 作成方法 |
|----------|------|----------|
| **llms.txt** | 思想・プロトコル。AI にどう解釈してほしいか、優先順位・禁止事項・一次情報の所在 | AI 生成 + 対話的編集 |
| **llms.full.txt** | サイト情報全部。コレクション・商品・ロケーション・ポリシー等を自動収集 | 自動生成（AI 整形オプション有り） |
| **.ai-context** | AI 解釈ガイドライン。AI がストアを解釈する際のルール・制約を定義 | AI 生成 + 対話的編集 |
| **docs/ai/README.md** | 補足文書。AI 向けドキュメントの索引 | ユーザー定義（Markdown） |
| **sitemap-ai.xml** | AI 向けサイトマップ。上記文書の URL を XML 形式で提供 | 自動生成（App Proxy 経由） |

### 2. テーマ App Extension（LLMO head）

ストアの `<head>` に以下のリンクを追加：

```html
<link rel="llms" href="https://shop.myshopify.com/llms.txt" />
<link rel="llms-full" href="https://shop.myshopify.com/llms.full.txt" />
<link rel="ai-context" href="https://shop.myshopify.com/.ai-context" />
<link rel="ai-docs" href="https://shop.myshopify.com/docs/ai/README.md" />
<link rel="sitemap" type="application/xml" href="https://shop.myshopify.com/apps/llmo/sitemap-ai.xml" />
```

各リンクはテーマブロック設定で個別にオン/オフ可能。

### 3. URL リダイレクト + App Proxy（アクセスログ）

**フロー:**
```
/llms.txt → URL Redirect → /apps/llmo/llms.txt → App Proxy（ログ記録）→ CDN
```

- クリーンな URL（`/llms.txt`）でアクセス可能
- App Proxy を経由することでアクセスログを記録
- `.ai-context` は CDN の Content-Disposition 問題を回避するため、App Proxy が直接コンテンツをサーブ

### 4. AI ボット検出・表示

アクセスログから AI ボット（クローラー）を自動検出し、別セクションで表示。

**検出対象ボット:**

| ボット名 | サービス |
|----------|----------|
| GPTBot | OpenAI |
| ChatGPT-User | OpenAI (Browse) |
| OAI-SearchBot | OpenAI (Search) |
| PerplexityBot | Perplexity |
| ClaudeBot / Claude-Web | Anthropic |
| Google-Extended | Google (Gemini/Bard) |
| Amazonbot | Amazon |
| Applebot-Extended | Apple Intelligence |
| Bytespider | ByteDance |
| CCBot | Common Crawl |
| cohere-ai | Cohere |
| Diffbot | Diffbot |
| YouBot | You.com |

新しい AI ボットを追加する場合は `app/lib/llmo-access-log.server.ts` の `AI_BOT_PATTERNS` に追記。

### 5. アクセスログ集計

- **総リクエスト数**
- **ストア別**集計
- **パス別**集計（llms.txt, .ai-context 等）
- **日付別**集計
- **AI ボット別**集計（サービス別、ボット名別）
- **直近アクセス一覧**（AI ボットは緑色でハイライト）

---

## セットアップ

### 前提

- Node.js 20.19+ または 22.12+
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli) インストール済み
- Shopify Partners でアプリを作成済み

### 初回セットアップ

```bash
cd shopify-ap-llmo
git submodule update --init --recursive
npm install

# 環境変数（.env）を作成
cp .env.example .env
# または本番用: cp .env.example ../common/shopify-ap-llmo.env

# DB 初期化（ローカルは SQLite）
npm run setup
```

### 開発

```bash
# 本番デプロイしてから確認する運用
npm run build:prod
npm run deploy
```

### 本番デプロイ

```bash
# サーバーで
cd /var/www/apps.andplus.tech/andplus-apps/shopify-ap-llmo
git pull
source ../common/shopify-ap-llmo.env && npm run build:prod
pm2 restart shopify-ap-llmo
```

---

## ファイル構成

```
shopify-ap-llmo/
├── app/
│   ├── routes/
│   │   ├── app._index.tsx      # メイン管理画面
│   │   ├── app.access-log.tsx  # アクセスログ画面
│   │   └── app-proxy.$.tsx     # App Proxy ハンドラ
│   └── lib/
│       ├── llmo-files.server.ts       # Shopify Files API / URL Redirect
│       ├── llmo-access-log.server.ts  # アクセスログ記録・集計・AI ボット検出
│       ├── openai.server.ts           # OpenAI API（llms.txt / .ai-context 生成）
│       └── i18n.ts                    # 日本語・英語対応
├── extensions/
│   └── andplus-llmo-theme/
│       └── blocks/
│           └── llmo-head.liquid  # テーマ App Extension（<head> リンク追加）
├── prisma/
│   └── schema.prisma             # SQLite（開発用）
├── prisma-mysql/
│   └── schema.prisma             # MySQL（本番用）
└── log/
    └── llmo-access.log           # アクセスログファイル（NDJSON）
```

---

## データベーススキーマ（LlmoSettings）

| カラム | 型 | 説明 |
|--------|-----|------|
| shop | String | ストア識別子（myshopify.com ドメイン） |
| siteType | String? | サイト種類（corporate / ec / corporate_ec） |
| title | String? | llms.txt タイトル |
| roleSummary | String? | llms.txt 役割・一次情報の所在 |
| sectionsOutline | String? | セクション構成メモ |
| notesForAi | String? | Notes for AI |
| llmsTxtBody | String? | llms.txt 本文 |
| llmsTxtFileId | String? | Shopify Files ID |
| llmsTxtFileUrl | String? | CDN URL |
| llmsFullTxtFileId | String? | llms.full.txt Files ID |
| llmsFullTxtFileUrl | String? | llms.full.txt CDN URL |
| llmsFullTxtGeneratedAt | DateTime? | 最終生成日時 |
| aiContextBody | String? | .ai-context 本文 |
| aiContextFileId | String? | .ai-context Files ID |
| aiContextFileUrl | String? | .ai-context CDN URL |
| aiContextGeneratedAt | DateTime? | 最終生成日時 |
| docsAiFiles | String? | docs/ai/*.md 一覧（JSON） |
| openaiApiKey | String? | OpenAI API Key（暗号化推奨） |

---

## 関連ドキュメント

- **docs/llms-txt設置の2案_具体.md** - llms.txt 設置方針
- **docs/NGINX.md** - Nginx 設定例
- **docs/common-rules-setup.md** - 共通ルールのセットアップ

---

## ライセンス・お問い合わせ

- **開発**: ANDPLUS Inc.
- **お問い合わせ**: https://www.andplus.co.jp/contact
