/**
 * 定時処理: llms.full.txt の自動再生成 + ログローテーション
 * - 毎日 JST 3:00 AM (UTC 18:00) に実行
 * - PM2 で常駐させることで cron が動作する
 */

import cron from "node-cron";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { fetchStoreData, formatStoreDataAsText } from "./llmo-full.server";
import { createOrUpdateLlmsFullTxtFile } from "./llmo-files.server";

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

  // 毎日 UTC 18:00 (JST 3:00 AM) に実行
  cron.schedule("0 18 * * *", async () => {
    console.log("[cron] Daily job started at", new Date().toISOString());
    try {
      await regenerateAllLlmsFullTxt();
      await rotateAccessLog();
      console.log("[cron] Daily job completed");
    } catch (err) {
      console.error("[cron] Daily job failed:", err);
    }
  });

  console.log("[cron] Scheduled daily job at UTC 18:00 (JST 3:00 AM)");
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
