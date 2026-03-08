# shopify-ap-llmo（LLMO アプリ）

**このディレクトリは「AI向け文書（llms.txt / docs/ai）の head 追加アプリ」用です。**  
構造化データアプリ（`shopify-schemabridge`）とは別アプリです。

---

## 概要

- **目的**: ストアの `<head>` に、LLM・エージェント向けの文書へのパスを追加する。
- **思想**: 中身はユーザー定義。自動生成に頼りきらず、考え方と壁打ちプロンプトを示して、好きな AI で作成してもらう（「正しい LLMO 講座」的なスタンス）。
- **配布**: 単独アプリ。無料で配布し、自律探索が当たり前になってきたら有料化を検討。導入支援は 10〜20 万で提供。

---

## 想定する head 追加先（4 種）

| ファイル／パス | 役割 | 作成 |
|----------------|------|------|
| **llms.txt** | LLM に渡す本文。サイトの意図・概要など。 | ユーザー定義（自動生成しない） |
| **llms.full.txt** | サイト全体の要約・一覧など。 | アプリが自動生成 |
| **docs/ai/README.md** | 考え方 ＋ 壁打ちプロンプト。 | ユーザー定義 |
| **docs/ai/〇〇.md** | 必要に応じた考え方・壁打ちプロンプト。 | ユーザー定義 |

---

## 初回セットアップ（Cursor ルール・開発ルール）

共通ルール（andplus-dev-rules）をサブモジュールで参照する。手順は **docs/common-rules-setup.md** を参照。

- サブモジュール取得: `git submodule update --init --recursive`
- Cursor がルールを読むため: `.cursor/rules` を `../_rules/.cursor/rules` へのシンボリックリンクにする

---

## 技術・運用メモ

- **リポジトリ**: `andplus-apps` の直下に `shopify-ap-llmo` として配置（本 README の場所）。同一親ディレクトリ内の他アプリ（`shopify-ap-schema`）と混同しないこと。
- **サーバー・ドメイン**: andplus.tech 上の既存サーバーに載せる想定。カスタムアプリと共用で追加コストは最小限。
- **想定ユーザー**: 新しもの好きのサイトオーナー、制作会社。制作会社が使う場合、思想の真似は想定内。お客様への支援（思想の伴走）で差別化。

---

## 関連（壁打ちメモ）

- 無料だから使ってみる層が増え、LLM・エージェントの普及に微力ながら貢献できる。
- 同じ考え方が広がっても、思想を持っていない会社は使いこなせない。土俵が揃ったとき、思想と支援で差別化できる。
- 金銭的価値を実感できる世界線はまだ数年先。いまは布石とポジション取り。

---

## 開発の始め方

### 前提

- Node.js 20.19+ または 22.12+
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli) インストール済み
- Shopify Partners でアプリを作成し、`shopify.app.toml` の `client_id` を取得済み

### 初回セットアップ

```bash
cd shopify-ap-llmo
git submodule update --init --recursive
ln -s ../_rules/.cursor/rules .cursor/rules   # 共通ルールを使う場合

npm install
```

**環境変数（.env）**: 並列ディレクトリの **common** に置く想定（schemabridge と同様）。

- 本番: `andplus-apps` と並列の `common/shopify-ap-llmo.env` に置く。`npm run start` が `DOTENV_CONFIG_PATH=../common/shopify-ap-llmo.env` で読む。
- 開発: プロジェクト直下に `.env` を置くか、`common/shopify-ap-llmo.env` を用意する。`shopify app dev` は直下の `.env` を読む。

```bash
# 例: common にコピーして編集（本番サーバーで common を共有する場合）
cp .env.example ../common/shopify-ap-llmo.env
# または開発だけなら直下に
cp .env.example .env

# .env を編集: SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SCOPES
# DATABASE_URL は .env.example のまま（SQLite）でよい。MySQL は不要。

# DB 初期化（ローカルは SQLite。ファイルが自動作成される）
npm run setup
```

### 開発サーバー・確認の流れ

schemabridge と同様、**Partners のアプリ URL は本番のまま**運用する。確認時は **本番にデプロイしてから**、管理画面でアプリを開く。

- ビルド・デプロイ: `npm run build:prod` → `npm run deploy`（または CI でデプロイ）
- 本番サーバーで `npm run start` 等でアプリを起動しておく
- ストアの管理画面からアプリを開いて動作確認

ローカルで `shopify app dev` する場合はトンネル URL が変わるため、そのときだけ Partners の URL をトンネルに合わせる必要がある（通常の開発フローでは本番デプロイで確認）。

### 403 が続くとき（ローカル）

**インストール後に 403** になる場合、Partners のアプリ URL が本番（`https://apps.andplus.tech/...`）のため、**本番サーバーが未起動だと 403** になる。schemabridge と同様に、**本番にデプロイしてから**アプリを開いて確認する運用にする。

---

トンネルでローカル開発する場合など、403 の他の原因として **CLI のトンネル**がブロックしていることがある。次を順に試す。

1. **URL リセット**  
   ```bash
   npm run dev -- --reset
   ```  
   表示された新しい URL を Partners に再設定してからアプリを開き直す。

2. **localhost で開く**（トンネルを使わない）  
   ```bash
   npm run dev:localhost
   ```  
   ブラウザで表示された URL（`https://localhost:...`）を Partners のアプリ URL に設定。証明書の警告が出たら「詳細」→「安全でなくても開く」で進む。

3. **ngrok を使う**  
   ngrok を別ターミナルで起動し、  
   ```bash
   npm run dev -- --tunnel-url https://あなたのngrokのURL
   ```  
   Partners のアプリ URL をその ngrok URL に設定。

4. **Cloudflare の設定と競合している場合**  
   `~/.cloudflared/config.yaml` があると CLI のトンネルと競合することがある。一時的にリネームしてから `npm run dev` を試す。

### ビルド・デプロイ

```bash
npm run build:prod   # 本番 URL でビルド
npm run deploy       # Shopify に extension と app をデプロイ
```

本番では **common/shopify-ap-llmo.env** で `SHOPIFY_APP_URL` を `https://apps.andplus.tech/andplus-apps/shopify-ap-llmo/` にし、`DATABASE_URL` で MySQL を指定。ビルド・DB マイグレーションは `npm run setup:prod`（prisma-mysql 使用）で実行する。

**Nginx**: 本番サーバーで `https://apps.andplus.tech/andplus-apps/shopify-ap-llmo/` を Node にプロキシする **location の追加**が必要。設定例は **docs/NGINX.md** を参照。

### 構成

- **app/** … React Router + Shopify App（OAuth・webhook・管理画面 1 ページ）
- **extensions/andplus-llmo-theme/** … Theme app extension。ストアの `<head>` に llms.txt / docs/ai への link を追加するブロック「LLMO head」

### 動かして確認（初回チェック）

「リンクを出す」ところまで動くか確認する手順。

1. **ストアにアプリをインストール**
   - Partners のアプリから「テストストアを追加」するか、既存ストアの管理画面で「アプリ」→「カスタムアプリを追加」→ 対象アプリをインストール。

2. **テーマで「LLMO head」ブロックを有効にする**
   - 管理画面で **オンラインストア** → **テーマ** → **カスタマイズ** を開く。
   - 左の「アプリ」または「アプリの埋め込み」などから **AP LLMO** を選び、**LLMO head** ブロックを追加する（head 用ブロックはテーマによっては「ヘッダー」や「theme.liquid の head」などで追加できる場所が案内される）。
   - ブロック設定で「LLMO リンクを head に追加する」がオンになっていることを確認し、**保存**。

3. **ストアの `<head>` に link が出力されているか確認**
   - ストアフロント（トップページなど）をブラウザで開く。
   - 右クリック → **ページのソースを表示**（または開発者ツールの Elements で `<head>` 内）を開く。
   - 次のような `<link>` が含まれているか確認する:
     - `rel="alternate" type="text/plain" href="https://ストアのURL/llms.txt"`
     - `href=".../llms.full.txt"`
     - `href=".../docs/ai/README.md"`

ここまで確認できれば「リンクを出す」ところは完了。llms.txt などの**中身**はまだ 404 でよい（リンクの出力だけ確認）。

---
