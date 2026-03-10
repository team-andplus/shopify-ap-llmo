/**
 * App Proxy 通過時のアクセスを専用ログファイルに 1 行ずつ追記する。
 * DB を使わず、見える化・集計は後からこのファイルを読んで行う。
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const LOG_DIR = "log";
const LOG_FILE = "llmo-access.log";
const RECENT_MAX = 100;

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

export type LlmoAccessLogEntry = {
  t: string;
  shop: string;
  path: string;
  ua: string;
};

export type LlmoAccessLogAggregates = {
  total: number;
  byShop: Record<string, number>;
  byPath: Record<string, number>;
  byDate: Record<string, number>;
  recent: LlmoAccessLogEntry[];
};

const emptyAggregates: LlmoAccessLogAggregates = {
  total: 0,
  byShop: {},
  byPath: {},
  byDate: {},
  recent: [],
};

/**
 * ログファイルを読んで都度集計。ファイルが無い・空の場合は空の集計を返す。
 */
export async function readAndAggregateLlmoAccessLog(): Promise<LlmoAccessLogAggregates> {
  const logPath = getLogPath();
  let raw: string;
  try {
    raw = await readFile(logPath, "utf-8");
  } catch (err: unknown) {
    const code = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : "";
    if (code === "ENOENT") return emptyAggregates;
    console.error("[llmo-access-log] read failed:", err);
    return emptyAggregates;
  }

  const byShop: Record<string, number> = {};
  const byPath: Record<string, number> = {};
  const byDate: Record<string, number> = {};
  const recent: LlmoAccessLogEntry[] = [];
  let total = 0;

  const lines = raw.split(/\n/).filter((s) => s.trim());
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as unknown;
      if (!row || typeof row !== "object") continue;
      const t = typeof (row as LlmoAccessLogEntry).t === "string" ? (row as LlmoAccessLogEntry).t : "";
      const shop = typeof (row as LlmoAccessLogEntry).shop === "string" ? (row as LlmoAccessLogEntry).shop : "";
      const path = typeof (row as LlmoAccessLogEntry).path === "string" ? (row as LlmoAccessLogEntry).path : "";
      const ua = typeof (row as LlmoAccessLogEntry).ua === "string" ? (row as LlmoAccessLogEntry).ua : "";
      const day = t.slice(0, 10);
      byShop[shop] = (byShop[shop] ?? 0) + 1;
      byPath[path] = (byPath[path] ?? 0) + 1;
      byDate[day] = (byDate[day] ?? 0) + 1;
      total += 1;
      recent.push({ t, shop, path, ua });
    } catch {
      // パース失敗行はスキップ
    }
  }

  recent.reverse();
  if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;

  return { total, byShop, byPath, byDate, recent };
}
