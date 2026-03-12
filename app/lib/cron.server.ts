/**
 * 定時処理: llms.full.txt の自動再生成 + ログローテーション + 週次レポート
 * - 毎日 JST 2:00 AM (UTC 17:00) に実行
 * - 毎週月曜 JST 9:00 AM (UTC 0:00) に週次レポートを送信
 * - PM2 で常駐させることで cron が動作する
 */

import cron from "node-cron";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { fetchStoreData, formatStoreDataAsText } from "./llmo-full.server";
import { createOrUpdateLlmsFullTxtFile } from "./llmo-files.server";
import { sendEmail } from "./email.server";
import { AI_BOT_PATTERNS } from "./llmo-access-log.server";

const LOG_DIR = "log";
const LOG_FILE = "llmo-access.log";
const LOG_MAX_ENTRIES = 5000;

let cronInitialized = false;

/**
 * cron ジョブを開始する。サーバー起動時に 1 回だけ呼び出す。
 */
export function initCronJobs(): void {
  if (cronInitialized) {
    console.log("[cron] Already initialized, skipping");
    return;
  }
  cronInitialized = true;

  // 毎日 UTC 17:00 (JST 2:00 AM) に実行
  cron.schedule("0 17 * * *", async () => {
    console.log("[cron] Daily job started at", new Date().toISOString());
    try {
      await regenerateAllLlmsFullTxt();
      await rotateAccessLog();
      console.log("[cron] Daily job completed");
    } catch (err) {
      console.error("[cron] Daily job failed:", err);
    }
  });

  // 毎週月曜 UTC 0:00 (JST 9:00 AM) に週次レポートを送信
  cron.schedule("0 0 * * 1", async () => {
    console.log("[cron] Weekly report job started at", new Date().toISOString());
    try {
      await sendWeeklyReports();
      console.log("[cron] Weekly report job completed");
    } catch (err) {
      console.error("[cron] Weekly report job failed:", err);
    }
  });

  console.log("[cron] Scheduled daily job at UTC 17:00 (JST 2:00 AM)");
  console.log("[cron] Scheduled weekly report at UTC 0:00 Monday (JST 9:00 AM)");
}

/**
 * 全ストアの llms.full.txt を再生成する
 */
async function regenerateAllLlmsFullTxt(): Promise<void> {
  console.log("[cron] Regenerating llms.full.txt for all stores...");

  // LlmoSettings のある全ストアを取得
  const stores = await prisma.llmoSettings.findMany({
    select: {
      shop: true,
      llmsFullTxtFileId: true,
    },
  });

  console.log(`[cron] Found ${stores.length} stores to process`);

  for (const store of stores) {
    try {
      console.log(`[cron] Processing store: ${store.shop}`);

      // unauthenticated.admin() でオフラインセッションから Admin API を取得
      const { admin } = await unauthenticated.admin(store.shop);

      // 全商品を取得（fullFetch = true）
      const storeData = await fetchStoreData(admin, true);
      const fullTxtBody = formatStoreDataAsText(storeData);

      // Files API でアップロード
      const result = await createOrUpdateLlmsFullTxtFile(
        admin,
        fullTxtBody,
        store.llmsFullTxtFileId
      );

      if (result.ok) {
        // DB を更新
        await prisma.llmoSettings.update({
          where: { shop: store.shop },
          data: {
            llmsFullTxtFileUrl: result.url,
            llmsFullTxtFileId: result.fileId,
            llmsFullTxtGeneratedAt: new Date(),
          },
        });
        console.log(`[cron] Updated llms.full.txt for ${store.shop}`);
      } else {
        console.error(`[cron] Failed to update llms.full.txt for ${store.shop}:`, result.error);
      }
    } catch (err) {
      console.error(`[cron] Error processing store ${store.shop}:`, err);
    }
  }

  console.log("[cron] Finished regenerating llms.full.txt for all stores");
}

/**
 * ログファイルを読み込み、最新 LOG_MAX_ENTRIES 件のみ残す
 */
async function rotateAccessLog(): Promise<void> {
  const logPath = join(process.cwd(), LOG_DIR, LOG_FILE);

  try {
    const raw = await readFile(logPath, "utf-8");
    const lines = raw.split("\n").filter((line) => line.trim());

    if (lines.length <= LOG_MAX_ENTRIES) {
      console.log(`[cron] Log rotation: ${lines.length} entries, no rotation needed`);
      return;
    }

    // 最新 LOG_MAX_ENTRIES 件のみ残す（ファイルは古い順に追記されているので末尾を残す）
    const newLines = lines.slice(-LOG_MAX_ENTRIES);
    await writeFile(logPath, newLines.join("\n") + "\n", "utf-8");

    const removed = lines.length - LOG_MAX_ENTRIES;
    console.log(`[cron] Log rotation: removed ${removed} old entries, kept ${LOG_MAX_ENTRIES}`);
  } catch (err: unknown) {
    const code = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : "";
    if (code === "ENOENT") {
      console.log("[cron] Log rotation: log file does not exist, skipping");
      return;
    }
    console.error("[cron] Log rotation failed:", err);
  }
}

/**
 * 手動実行用（管理画面やテストから呼び出し可能）
 */
export async function runDailyJobManually(): Promise<{ success: boolean; message: string }> {
  try {
    console.log("[cron] Manual job started at", new Date().toISOString());
    await regenerateAllLlmsFullTxt();
    await rotateAccessLog();
    console.log("[cron] Manual job completed");
    return { success: true, message: "Daily job completed successfully" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron] Manual job failed:", err);
    return { success: false, message };
  }
}

// ===============================
// 週次レポート
// ===============================

interface LogEntry {
  timestamp: string;
  shop: string;
  path: string;
  userAgent: string;
  ip?: string;
}

interface WeeklyStats {
  totalAccess: number;
  aiBotAccess: number;
  byBot: Record<string, number>;
  byPath: Record<string, number>;
}

/**
 * 週次レポートを全ストアに送信する
 */
async function sendWeeklyReports(): Promise<void> {
  console.log("[cron] Sending weekly reports...");

  // レポート有効なストアを取得
  const stores = await prisma.llmoSettings.findMany({
    where: { reportEnabled: true, reportEmail: { not: null } },
    select: { shop: true, reportEmail: true, locale: true },
  });

  if (stores.length === 0) {
    console.log("[cron] No stores with report enabled");
    return;
  }

  // ログファイルを読み込み
  const logPath = join(process.cwd(), LOG_DIR, LOG_FILE);
  let logEntries: LogEntry[] = [];

  try {
    const raw = await readFile(logPath, "utf-8");
    const lines = raw.split("\n").filter((line) => line.trim());
    logEntries = lines.map((line) => {
      try {
        return JSON.parse(line) as LogEntry;
      } catch {
        return null;
      }
    }).filter((e): e is LogEntry => e !== null);
  } catch {
    console.log("[cron] Log file not found, skipping reports");
    return;
  }

  // 過去7日間のエントリを抽出
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  for (const store of stores) {
    try {
      const storeEntries = logEntries.filter(
        (e) => e.shop === store.shop && new Date(e.timestamp) >= weekAgo
      );

      const stats = aggregateStats(storeEntries);
      const isJa = store.locale === "ja";
      const html = generateReportHtml(store.shop, stats, isJa);

      await sendEmail({
        to: store.reportEmail!,
        subject: isJa
          ? `🤖 AI があなたのストアを訪問しました - ${store.shop}`
          : `🤖 AI systems visited your store this week - ${store.shop}`,
        html,
      });

      console.log(`[cron] Sent weekly report to ${store.reportEmail} for ${store.shop}`);
    } catch (err) {
      console.error(`[cron] Failed to send report for ${store.shop}:`, err);
    }
  }
}

/**
 * ログエントリを集計する
 */
function aggregateStats(entries: LogEntry[]): WeeklyStats {
  const stats: WeeklyStats = {
    totalAccess: entries.length,
    aiBotAccess: 0,
    byBot: {},
    byPath: {},
  };

  for (const entry of entries) {
    // パス別集計
    stats.byPath[entry.path] = (stats.byPath[entry.path] || 0) + 1;

    // AI Bot 判定
    for (const bot of AI_BOT_PATTERNS) {
      if (entry.userAgent.includes(bot.pattern)) {
        stats.aiBotAccess++;
        stats.byBot[bot.name] = (stats.byBot[bot.name] || 0) + 1;
        break;
      }
    }
  }

  return stats;
}

/**
 * レポート HTML を生成する
 */
function generateReportHtml(shop: string, stats: WeeklyStats, isJa: boolean): string {
  const t = isJa ? {
    title: "📊 週次 AI アクセスレポート",
    store: "ストア",
    period: "期間",
    last7days: "過去7日間",
    totalAccess: "総アクセス数",
    aiBotAccess: "AI Bot アクセス",
    aiBotTitle: "🤖 AI Bot 別アクセス",
    botName: "Bot 名",
    count: "回数",
    noAiBotAccess: "AI Bot からのアクセスはありませんでした。",
    fileAccessTitle: "📄 ファイル別アクセス",
    path: "パス",
    noAccess: "アクセスなし",
    footer1: "このメールは AP LLMO (AI 文書管理アプリ) から自動送信されています。",
    footer2: "レポート設定はアプリ管理画面から変更できます。",
  } : {
    title: "📊 Weekly AI Access Report",
    store: "Store",
    period: "Period",
    last7days: "Last 7 days",
    totalAccess: "Total Access",
    aiBotAccess: "AI Bot Access",
    aiBotTitle: "🤖 AI Bot Access by Bot",
    botName: "Bot Name",
    count: "Count",
    noAiBotAccess: "No AI bot access during this period.",
    fileAccessTitle: "📄 Access by File",
    path: "Path",
    noAccess: "No access",
    footer1: "This email is automatically sent by AP LLMO (AI Document Management App).",
    footer2: "You can change report settings in the app dashboard.",
  };

  const botRows = Object.entries(stats.byBot)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `<tr><td>${name}</td><td style="text-align:right">${count}</td></tr>`)
    .join("");

  const pathRows = Object.entries(stats.byPath)
    .sort((a, b) => b[1] - a[1])
    .map(([path, count]) => `<tr><td>${path}</td><td style="text-align:right">${count}</td></tr>`)
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    h1 { color: #1a1a2e; font-size: 1.5rem; border-bottom: 2px solid #4a4e69; padding-bottom: 0.5rem; }
    h2 { color: #4a4e69; font-size: 1.1rem; margin-top: 1.5rem; }
    .summary { background: #f8f9fa; padding: 1rem; border-radius: 8px; margin: 1rem 0; }
    .summary-item { display: flex; justify-content: space-between; padding: 0.25rem 0; }
    .summary-value { font-weight: bold; color: #1a1a2e; }
    .highlight { color: #2ecc71; }
    table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; }
    th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f8f9fa; font-weight: 600; }
    .footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #eee; font-size: 0.85rem; color: #666; }
  </style>
</head>
<body>
  <h1>${t.title}</h1>
  <p><strong>${t.store}:</strong> ${shop}</p>
  <p><strong>${t.period}:</strong> ${t.last7days}</p>

  <div class="summary">
    <div class="summary-item">
      <span>${t.totalAccess}:</span>
      <span class="summary-value">${stats.totalAccess}</span>
    </div>
    <div class="summary-item">
      <span>${t.aiBotAccess}:</span>
      <span class="summary-value ${stats.aiBotAccess > 0 ? 'highlight' : ''}">${stats.aiBotAccess}</span>
    </div>
  </div>

  ${Object.keys(stats.byBot).length > 0 ? `
  <h2>${t.aiBotTitle}</h2>
  <table>
    <thead><tr><th>${t.botName}</th><th style="text-align:right">${t.count}</th></tr></thead>
    <tbody>${botRows}</tbody>
  </table>
  ` : `<p>${t.noAiBotAccess}</p>`}

  <h2>${t.fileAccessTitle}</h2>
  <table>
    <thead><tr><th>${t.path}</th><th style="text-align:right">${t.count}</th></tr></thead>
    <tbody>${pathRows || `<tr><td colspan="2">${t.noAccess}</td></tr>`}</tbody>
  </table>

  <div class="footer">
    <p>${t.footer1}</p>
    <p>${t.footer2}</p>
  </div>
</body>
</html>
  `.trim();
}
