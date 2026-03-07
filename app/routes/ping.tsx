/**
 * 403 切り分け用: 認証なしで 200 を返す。
 * トンネルURL/ping が 200 → アプリは動いている。403 は /app の認証まわり。
 * トンネルURL/ping が 403 → トンネル or サーバー設定の可能性。
 */
import type { LoaderFunctionArgs } from "react-router";
import { addDocumentResponseHeaders } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const res = new Response("ok", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
  addDocumentResponseHeaders(request, res.headers);
  return res;
};

export default function Ping() {
  return null;
}
