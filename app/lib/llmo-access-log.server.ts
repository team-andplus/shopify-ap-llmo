/**
 * App Proxy 通過時のアクセスを専用ログファイルに 1 行ずつ追記する。
 * DB を使わず、見える化・集計は後からこのファイルを読んで行う。
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const LOG_DIR = "log";
const LOG_FILE = "llmo-access.log";

function getLogPath(): string {
  return join(process.cwd(), LOG_DIR, LOG_FILE);
}

/**
 * 1 リクエスト分を NDJSON で追記。呼び出し元は await せず fire-and-forget でよい。
 */
export function writeLlmoAccessLog(
  shop: string,
  path: string,
  userAgent: string | null
): void {
  const line =
    JSON.stringify({
      t: new Date().toISOString(),
      shop,
      path,
      ua: userAgent ?? "",
    }) + "\n";
  const logPath = getLogPath();
  mkdir(join(process.cwd(), LOG_DIR), { recursive: true })
    .then(() => appendFile(logPath, line))
    .catch((err) => {
      console.error("[llmo-access-log] write failed:", err?.message ?? err);
    });
}
