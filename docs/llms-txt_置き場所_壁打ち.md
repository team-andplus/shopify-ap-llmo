# llms.txt ってどこにあってもいいの？（壁打ちメモ）

## 結論（仕様の答え）

**「どこにあってもいい」ではない。仕様ではルートが必須。**

代表的な仕様（[ai-visibility.org.uk llms.txt Specification](https://www.ai-visibility.org.uk/specifications/llms-txt/) など）では:

- **S2 File Location**: The llms.txt file **MUST** be placed in the **website's root directory** and accessible at:
  - `https://example.com/llms.txt`
- HTTPS 推奨、200 で返す、認証なしでアクセス可能、`text/plain; charset=utf-8` で配信、などが要件。

つまり **「ルートの /llms.txt に置く」** が約束事。robots.txt や sitemap.xml と同じ「決まった場所で探す」前提。

---

## じゃあ Shopify はどうするか（壁打ち）

Shopify では **ストアルートに任意の .txt を置けない** ので、仕様と現実が噛み合わない。

取りうるスタンスはだいたい 3 つ。

### 1) 「ルートは諦めて、別 URL で配信する。発見は &lt;link&gt; に頼る」

- 実体は **CDN URL** や **/pages/llms** など「ルート以外」に置く。
- **発見**: ストアの &lt;head&gt; に  
  `<link rel="alternate" type="text/plain" href="(実際のURL)" title="..." />`  
  を出す（今のアプリの方向性）。
- LLM やクローラーが「ページの head を見る」実装をしていれば、そこから本当の llms.txt の URL を取得できる。
- **解釈**: 「仕様のルートは理想だが、プラットフォーム制約で無理なので、**正規の URL を head で宣言する**」と読む。

### 2) 「ルートの URL は守る。実体はリダイレクトで飛ばす」

- **URL だけ**は `https://ストアドメイン/llms.txt` にする。
- アクセスされたら **302 で CDN や /pages/llms など実体のある URL に飛ばす**。
- そうすれば「ルートのパスでアクセスできる」という意味では仕様に近づく。
- Shopify では **App Proxy** で `/llms.txt` をアプリに渡し、アプリが 302 か 200（実体をストリーム）を返す、という形が現実的。テーマだけではルートパスを奪うのが難しいので、プロキシ or アプリ側で制御が必要。

### 3) 「仕様は参照しつつ、プラットフォームの範囲でベストエフォート」

- ストアルートに置けない以上、**完全な仕様準拠は難しい**と明記する。
- そのうえで「**実体はこの URL（CDN 等）**」「**head の link で正規 URL を宣言**」とアプリ内で説明する。
- ディレクトリ登録（AI Visibility Directory など）する場合は、「ルートで 200 を返せない」旨を補足しておくか、可能なら (2) でルート URL を用意するか検討。

---

## まとめ（一言）

- **llms.txt は「どこでもいい」ではなく、仕様上は「ルートの /llms.txt」が前提。**
- Shopify ではルートに置けないので、
  - **実体**は CDN やページなど「ルート以外」で配信し、
  - **発見**は &lt;head&gt; の `<link>` で「正しい URL」を案内する、
  という形が現実的。
- 「ルートの URL を守りたい」なら、App Proxy で `/llms.txt` を受け、302 か 200 で実体に誘導する構成を検討する、という選択肢もある。

---

## 補足：302 リダイレクトはアプリの範疇で実現できるか

**「302 を返す処理」はアプリの範疇で実現できる。ただし「store.com/llms.txt でそれが動く」かは別。**

### できること（App Proxy を使う場合）

- **Shopify App Proxy** を有効にすると、**ストアの決まったパス**へのリクエストがアプリに転送される。
- 構成例: `shopify.app.toml` に `[app_proxy]` を追加し、アプリ側に「プロキシ用ルート」を 1 本用意する。
- そのルートで **302 で CDN URL にリダイレクト**するレスポンスを返せば、Shopify の仕様上その 302 はクライアントに伝わる（[About app proxies](https://shopify.dev/docs/apps/build/online-store/app-proxies): "any 30x redirects are followed"）。
- つまり **「プロキシで届いたリクエストに対して 302 を返す」までなら、アプリだけで実現可能。**

### できないこと（App Proxy の制約）

- App Proxy が受けられるストア側の URL は **必ず `prefix` + `subpath` の下**。
  - 例: `prefix = "apps"`, `subpath = "ap-llmo"` なら  
    `https://ストア/apps/ap-llmo/...` だけがアプリに届く。
- **`https://ストア/llms.txt`** のような「ルート直下」のパスを、App Proxy でアプリに渡すことは **できない**。  
  （Shopify がプロキシに振り向けられるのは、設定した prefix/subpath の下だけ。）

### まとめ

| やりたいこと | アプリの範疇で実現できる？ |
|--------------|----------------------------|
| プロキシで届いたリクエストに 302 を返す | ✅ できる（プロキシ用ルートを用意し、302 + Location を返すだけ） |
| **store.com/llms.txt** でその 302 が動く | ❌ できない（ルート直下のパスは App Proxy では取れない） |
| **store.com/apps/ap-llmo/llms.txt** で 302 が動く | ✅ できる（App Proxy を有効にし、`/llms.txt` 相当のパスで 302 を返す） |

つまり **「302 を返す」処理はアプリの範疇で実現できる**が、**「仕様どおり store.com/llms.txt で 302」をアプリだけでやることはできない**。  
可能なのは **「store.com/apps/サブパス/llms.txt にアクセス → アプリが 302 で CDN に飛ばす」** まで。  
ルートの `/llms.txt` を守りたい場合は、ストア側（テーマや別の仕組み）でどうにかする必要があり、現状の Shopify の仕様だけではアプリだけでは実現しない。
