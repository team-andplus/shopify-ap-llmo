import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const storeUrl = shop ? `https://${shop}` : "";
  return { storeUrl };
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

export default function AppIndex() {
  const data = useLoaderData<{ storeUrl?: string }>();
  const storeUrl = data?.storeUrl ?? "";

  return (
    <div style={{ padding: "2rem", maxWidth: "720px" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>AP LLMO</h1>
      <p style={{ color: "#6d7175", fontSize: "0.9375rem", marginBottom: "1.5rem" }}>
        ストアの <code>&lt;head&gt;</code> に、LLM・エージェント向け文書へのリンクを追加するアプリです。
      </p>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>このアプリでできること</h2>
        <ul style={listStyle}>
          <li>テーマに「LLMO head」ブロックを追加すると、次の4つのリンクがストアの <code>&lt;head&gt;</code> に出力されます。</li>
        </ul>
        <ul style={{ ...listStyle, marginTop: "0.5rem" }}>
          <li><strong>llms.txt</strong> … LLM に渡す本文（サイトの意図・概要）。<em>ユーザーが作成</em></li>
          <li><strong>llms.full.txt</strong> … サイト全体の要約・一覧。<em>将来アプリが自動生成予定</em></li>
          <li><strong>docs/ai/README.md</strong> … 考え方・壁打ちプロンプト。<em>ユーザーが作成</em></li>
          <li><strong>docs/ai/〇〇.md</strong> … その他の考え方・プロンプト。<em>ユーザーが作成</em></li>
        </ul>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>セットアップ（確認済みならスキップ可）</h2>
        <ol style={listStyle}>
          <li><strong>オンラインストア</strong> → <strong>テーマ</strong> → <strong>カスタマイズ</strong> を開く</li>
          <li>左の <strong>アプリ</strong>（またはアプリの埋め込み）から <strong>AP LLMO</strong> → <strong>LLMO head</strong> を追加</li>
          <li>「LLMO リンクを head に追加する」をオンにして <strong>保存</strong></li>
        </ol>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>リンク先のファイルの用意</h2>
        <p style={{ margin: "0 0 0.5rem 0" }}>
          llms.txt や docs/ai/README.md は<strong>ストア側で用意</strong>します。例:
        </p>
        <ul style={listStyle}>
          <li><strong>ファイル</strong>: 管理画面の <strong>コンテンツ</strong> → <strong>ファイル</strong> に llms.txt をアップロードし、URL を <code>{storeUrl ? `${storeUrl}/llms.txt` : "https://あなたのストア.myshopify.com/llms.txt"}</code> のようにアクセスできるようにする（パスはテーマやルーティングで調整が必要な場合あり）</li>
          <li><strong>ページ</strong>: <strong>オンラインストア</strong> → <strong>ページ</strong> で「llms」などのハンドルでページを作成し、本文をテキストで書く方法もあります</li>
        </ul>
        <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.875rem", color: "#6d7175" }}>
          考え方と壁打ちプロンプトは <code>docs/ai/README.md</code> にまとめることを推奨します。
        </p>
      </section>

      <section style={{ ...sectionStyle, background: "transparent", paddingLeft: 0 }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>動作確認</h2>
        <p style={{ margin: 0, fontSize: "0.9375rem" }}>
          ストアフロントを開き、<strong>ページのソースを表示</strong>して <code>&lt;head&gt;</code> 内に <code>llms.txt</code> / <code>llms.full.txt</code> / <code>docs/ai/README.md</code> への <code>&lt;link&gt;</code> が出ていれば設定は完了です。リンク先が 404 でも、まずはリンクの出力確認までで問題ありません。
        </p>
      </section>
    </div>
  );
}
