# 壁打ち：OpenAI API を使った生成支援機能

llms.txt / llms.full.txt / docs/ai の md 群について、OpenAI API で「生成支援」を入れるときの構想。まず壁打ちレベルで整理する。

---

## 前提

- **Basic プラン**で利用可能（Free では「プロンプトをコピーして外部で生成」のまま）。
- **API Key**: トークンコストをユーザー負担にするなら、**ユーザーが設定した OpenAI API Key** をストアごとに保持。アプリ側でキーを持たない場合は、設定画面で入力・保存（暗号化推奨）。
- **思想**: 「嘘をつかせない」に沿い、プロンプトでは事実ベース・誇張回避を明示する。

---

## 1. llms.txt の生成支援

### 現状

- フォーム入力 → 「プロンプトを生成」→ コピー → ユーザーが ChatGPT 等に貼って生成 → 結果を「llms.txt 本文」に貼り付け → 保存。

### OpenAI 連携のイメージ

- **入力**: 既存フォーム（siteType, title, roleSummary, sectionsOutline, notesForAi, docsAiFiles の URL 等）。既存の `buildLlmsTxtPrompt` で組み立てたプロンプトをそのまま user message に。
- **システムプロンプト**: 「You are an expert at writing llms.txt. Output only the file content in plain text (Markdown). No commentary. Be fact-based, avoid exaggeration.」
- **呼び出し**: OpenAI Chat Completions（例: gpt-4o-mini または gpt-4o）に 1 回だけ送る → 返ってきた `content` を「llms.txt 本文」のテキストエリアにセット。
- **UI**: 「プロンプトを生成」の隣に「**AI で生成**」ボタン（Basic のみ）。押下 → プロンプト組み立て → API 呼び出し → 結果を本文欄に反映。ユーザーは編集してから「ファイルを生成・保存」可能。

### 検討点

- モデル: コストと品質のバランス。gpt-4o-mini で十分なら低コスト。長文・構成を重視するなら gpt-4o。
- 上書き確認: 既に本文がある場合「上書きしますか？」か、常に追記／別タブ表示など。まずは「そのままセット」でよい。

---

## 2. llms.full.txt の生成支援

### 役割

- ストアの構造化データ（コレクション・商品・FAQ・ロケーション・ブランド・配送支払い等）を 1 本のテキストにまとめ、AI がストアを解釈しやすくする。
- **毎日自動生成**（Basic の価値の核）。手動で「今すぐ生成」もあってもよい。

### 処理の流れ（イメージ）

1. **データ取得**: GraphQL 等でコレクション一覧・商品一覧・メタオブジェクト（FAQ）・ロケーション・ポリシー等を取得し、プレーンテキストに整形（見出し・リスト形式）。
2. **OpenAI で補正（任意）**: そのテキストを API に渡し、「冗長を削り、事実ベースで、見出しとリストを維持した llms.full.txt 用の要約に整えて。誇張は入れない。」のようなプロンプトで 1 回要約・整形。
3. **保存**: 結果を Files API で `llms.full.txt` としてアップロード。既存の theme extension が参照する URL をメタフィールドに保存（または llms.txt と同様のメタフィールドで full 用 URL を保持）。

### OpenAI の位置づけ

- **生データの羅列だけ**でも llms.full.txt としては成立する。AI 補正は「読みやすさ・長さの最適化」の付加価値。
- Basic の差別化として「**毎日自動生成 ＋ AI 補正**」を打ち出すなら、上記の「データ取得 → OpenAI 補正 → 保存」を日次ジョブで実行（Basic ストアのみ）。

### 検討点

- 入力トークン: 商品・コレクションが多いと長い。プロンプトで「要約して 4000 トークン以内で」など上限を指定する。または段階的に要約（ first pass で各セクション要約 → 結合して最終 1 本）もあり。
- 日次ジョブ: 自サーバー cron や Trigger.dev 等で、Basic の shop 一覧を取得し、各ストア用の認証付きエンドポイントを叩く。その中でデータ取得 → OpenAI → 保存。

---

## 3. docs/ai の md 群の生成支援

### 必要性

- **必須ではない**。llms.txt と llms.full.txt を先に実装し、必要であれば後から追加でよい。
- README.md は「索引」として重要なので、README 用の下書き生成があると、知識のない人にも書きやすい。

### イメージ

- **README.md**
  - 入力: ストア名・組織名、他に設置する md のファイル名リスト（例: company.md, tech.md）、目的の一言。
  - プロンプト例: 「Create a README.md for an AI documentation directory. Structure: Welcome message, Primary references (Start Here) listing these files: ..., External resources, Interpretation guidelines for AI. Company: ... Be fact-based.」
  - 出力を docs/ai の「README.md」行の本文にセット。
- **その他の md（company.md, tech.md 等）**
  - ファイル名に応じたテンプレプロンプト。「company.md: 会社の正式名称、事業内容、強みを 300 字程度で。事実ベースで。」
  - 各行に「**AI で下書き**」ボタン（Basic のみ）→ その行の filename と既存 content を元にプロンプトを組み、API 呼び出し → 返答を content にセット。ユーザーが編集して保存。

### UI

- docs/ai 用 md の各行に「AI で下書き」を追加。README は 1 行目でよく使うので、README 用のプロンプトを少し丁寧に作る。
- 一括「全行の下書きを生成」は、トークンと UI が重くなるので後回しでよい。

---

## 4. API Key の扱い

| 方式 | メリット | デメリット |
|------|----------|------------|
| **ユーザーが設定** | トークンコストがユーザー負担。アプリ単価にトークンを含めなくてよい。 | 設定手順の説明が必要。キー漏れ・運用の責任分界。 |
| **アプリ側で 1 キー** | ユーザーは何も設定しない。 | トークンコストをアプリが負い、Basic 料金に上乗せする必要。 |

**方針（壁打ち）**: まずは **ユーザーが OpenAI API Key を設定**する形で設計。Basic プラン設定画面で「OpenAI API Key（任意）」を入力し、ストアごとに DB に保存（暗号化推奨）。未設定で「AI で生成」を押したら「API Key を設定してください」と案内。

---

## 5. エラー・制限

- **API Key 未設定**: 「Basic プランで OpenAI API Key を設定してください。」＋ 設定へのリンク。
- **レート制限・タイムアウト**: メッセージ表示。「しばらくしてから再試行」で十分。
- **トークン**: llms.txt は 1 回の短い応答。llms.full.txt は入力が長いので、モデルと max_tokens を指定し、プロンプトで「要約して ○○ 字以内」を明示。

---

## 6. 実装の優先順位（案）

| 順 | 機能 | 理由 |
|----|------|------|
| 1 | **llms.txt の AI 生成** | 1 画面で完結。価値が分かりやすい。既存プロンプトをそのまま API に渡せる。 |
| 2 | **llms.full.txt の自動生成 ＋ AI 補正** | Basic の核。データ取得ロジックと日次ジョブが必要。 |
| 3 | **docs/ai の README 下書き** | 必要であれば。README 1 本から始め、他 md は「AI で下書き」を後から。 |

---

## まとめ（一言）

- **llms.txt**: 既存プロンプト → OpenAI 1 回 → 本文に反映。「AI で生成」ボタンで Basic のみ。
- **llms.full.txt**: データ取得 → （任意）OpenAI で要約・整形 → Files に保存。日次で Basic のみ。手動「今すぐ生成」も検討。
- **md 群**: 必須ではない。README の下書きから、必要なら行ごと「AI で下書き」を追加。
- **API Key**: ユーザー設定・ストアごと保存（暗号化）。未設定時は案内表示。
