/**
 * App Proxy 通過時のアクセスを専用ログファイルに 1 行ずつ追記する。
 * DB を使わず、見える化・集計は後からこのファイルを読んで行う。
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const LOG_DIR = "log";
const LOG_FILE = "llmo-access.log";
const RECENT_MAX = 100;

/**
 * AI ボット判定用のリスト
 * 新しい AI ボットを追加する場合はここに追記してください。
 * - pattern: User-Agent に含まれる文字列（大文字小文字を区別しない）
 * - name: 表示名
 * - service: サービス名
 */
export const AI_BOT_PATTERNS: Array<{ pattern: string; name: string; service: string }> = [
  { pattern: "GPTBot", name: "GPTBot", service: "OpenAI" },
  { pattern: "ChatGPT-User", name: "ChatGPT-User", service: "OpenAI (Browse)" },
  { pattern: "OAI-SearchBot", name: "OAI-SearchBot", service: "OpenAI (Search)" },
  { pattern: "PerplexityBot", name: "PerplexityBot", service: "Perplexity" },
  { pattern: "Claude-Web", name: "Claude-Web", service: "Anthropic" },
  { pattern: "ClaudeBot", name: "ClaudeBot", service: "Anthropic" },
  { pattern: "Google-Extended", name: "Google-Extended", service: "Google (Gemini/Bard)" },
  { pattern: "Amazonbot", name: "Amazonbot", service: "Amazon" },
  { pattern: "Applebot-Extended", name: "Applebot-Extended", service: "Apple Intelligence" },
  { pattern: "Bytespider", name: "Bytespider", service: "ByteDance" },
  { pattern: "CCBot", name: "CCBot", service: "Common Crawl" },
  { pattern: "cohere-ai", name: "cohere-ai", service: "Cohere" },
  { pattern: "anthropic-ai", name: "anthropic-ai", service: "Anthropic" },
  { pattern: "Diffbot", name: "Diffbot", service: "Diffbot" },
  { pattern: "YouBot", name: "YouBot", service: "You.com" },
];

/**
 * User-Agent から AI ボット情報を判定
 * @returns AI ボット情報、または null（AI ボットでない場合）
 */
export function detectAiBot(userAgent: string): { name: string; service: string } | null {
  if (!userAgent) return null;
  const uaLower = userAgent.toLowerCase();
  for (const bot of AI_BOT_PATTERNS) {
    if (uaLower.includes(bot.pattern.toLowerCase())) {
      return { name: bot.name, service: bot.service };
    }
  }
  return null;
}

function getLogPath(): string {
  return join(process.cwd(), LOG_DIR, LOG_FILE);
}

/**
 * 1 リクエスト分を NDJSON で追記。呼び出し元は await せず fire-and-forget でよい。
 */
export function writeLlmoAccessLog(
  shop: string,
  path: string,
  userAgent: string | null,
  ip: string | null = null
): void {
  const line =
    JSON.stringify({
      t: new Date().toISOString(),
      shop,
      path,
      ua: userAgent ?? "",
      ip: ip ?? "",
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
  ip: string;
  aiBot?: { name: string; service: string } | null;
};

export type AiBotAccess = {
  t: string;
  shop: string;
  path: string;
  ip: string;
  botName: string;
  botService: string;
};

export type LlmoAccessLogAggregates = {
  total: number;
  byShop: Record<string, number>;
  byPath: Record<string, number>;
  byDate: Record<string, number>;
  recent: LlmoAccessLogEntry[];
  /** 集計対象の日付範囲（ログに含まれる最小・最大日付） */
  dateRange: { min: string; max: string } | null;
  /** 直近アクセス・AIボット直近の最大表示件数 */
  recentMax: number;
  // AI ボット関連
  aiBotTotal: number;
  aiBotByService: Record<string, number>;
  aiBotByBot: Record<string, number>;
  aiBotRecent: AiBotAccess[];
};

const emptyAggregates: LlmoAccessLogAggregates = {
  total: 0,
  byShop: {},
  byPath: {},
  byDate: {},
  recent: [],
  dateRange: null,
  recentMax: RECENT_MAX,
  aiBotTotal: 0,
  aiBotByService: {},
  aiBotByBot: {},
  aiBotRecent: [],
};

/** 集計期間: 直近7日 / 30日 / 90日 / 全期間 */
export type AggregatePeriod = "7d" | "30d" | "90d" | "all";

function getDateCutoff(period: AggregatePeriod): string | null {
  if (period === "all") return null;
  const d = new Date();
  const n = period === "7d" ? 6 : period === "30d" ? 29 : 89;
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * ログファイルを読んで都度集計。ファイルが無い・空の場合は空の集計を返す。
 * shopFilter を渡すとそのストアの行だけ集計（管理画面用。未指定なら全件＝内部用）。
 * period を渡すとその期間内の日付だけ集計（7d=直近7日, 30d=直近30日, 90d=直近90日, all=全期間）。
 */
export async function readAndAggregateLlmoAccessLog(
  shopFilter?: string | null,
  period: AggregatePeriod = "all"
): Promise<LlmoAccessLogAggregates> {
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

  // AI ボット用
  const aiBotByService: Record<string, number> = {};
  const aiBotByBot: Record<string, number> = {};
  const aiBotRecent: AiBotAccess[] = [];
  let aiBotTotal = 0;

  const filterShop = shopFilter ?? undefined;
  const dateCutoff = getDateCutoff(period);

  const lines = raw.split(/\n/).filter((s) => s.trim());
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as unknown;
      if (!row || typeof row !== "object") continue;
      const t = typeof (row as LlmoAccessLogEntry).t === "string" ? (row as LlmoAccessLogEntry).t : "";
      const shop = typeof (row as LlmoAccessLogEntry).shop === "string" ? (row as LlmoAccessLogEntry).shop : "";
      const path = typeof (row as LlmoAccessLogEntry).path === "string" ? (row as LlmoAccessLogEntry).path : "";
      const ua = typeof (row as LlmoAccessLogEntry).ua === "string" ? (row as LlmoAccessLogEntry).ua : "";
      const ip = typeof (row as LlmoAccessLogEntry).ip === "string" ? (row as LlmoAccessLogEntry).ip : "";
      if (filterShop !== undefined && shop !== filterShop) continue;

      const day = t.slice(0, 10);
      if (dateCutoff !== null && day < dateCutoff) continue;

      byShop[shop] = (byShop[shop] ?? 0) + 1;
      byPath[path] = (byPath[path] ?? 0) + 1;
      byDate[day] = (byDate[day] ?? 0) + 1;
      total += 1;

      // AI ボット判定
      const aiBot = detectAiBot(ua);
      recent.push({ t, shop, path, ua, ip, aiBot });

      if (aiBot) {
        aiBotTotal += 1;
        aiBotByService[aiBot.service] = (aiBotByService[aiBot.service] ?? 0) + 1;
        aiBotByBot[aiBot.name] = (aiBotByBot[aiBot.name] ?? 0) + 1;
        aiBotRecent.push({
          t,
          shop,
          path,
          ip,
          botName: aiBot.name,
          botService: aiBot.service,
        });
      }
    } catch {
      // パース失敗行はスキップ
    }
  }

  recent.reverse();
  if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;

  aiBotRecent.reverse();
  if (aiBotRecent.length > RECENT_MAX) aiBotRecent.length = RECENT_MAX;

  const dates = Object.keys(byDate).filter(Boolean).sort();
  const dateRange =
    dates.length > 0 ? { min: dates[0]!, max: dates[dates.length - 1]! } : null;

  return {
    total,
    byShop,
    byPath,
    byDate,
    recent,
    dateRange,
    recentMax: RECENT_MAX,
    aiBotTotal,
    aiBotByService,
    aiBotByBot,
    aiBotRecent,
  };
}
