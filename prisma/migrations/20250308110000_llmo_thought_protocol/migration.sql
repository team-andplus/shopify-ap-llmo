-- 思想・プロトコルに則した項目へ変更（あんどぷらす llms.txt 参照）
-- SQLite: 新カラム追加 → 既存データを新カラムへコピー → 旧カラム削除（3.35+）

ALTER TABLE "LlmoSettings" ADD COLUMN "title" TEXT;
ALTER TABLE "LlmoSettings" ADD COLUMN "roleSummary" TEXT;
ALTER TABLE "LlmoSettings" ADD COLUMN "sectionsOutline" TEXT;
ALTER TABLE "LlmoSettings" ADD COLUMN "notesForAi" TEXT;

-- 既存データの移行
UPDATE "LlmoSettings" SET "title" = COALESCE("storeName", "brandName") WHERE "storeName" IS NOT NULL OR "brandName" IS NOT NULL;
UPDATE "LlmoSettings" SET "notesForAi" = "prohibitions" WHERE "prohibitions" IS NOT NULL;

ALTER TABLE "LlmoSettings" DROP COLUMN "storeName";
ALTER TABLE "LlmoSettings" DROP COLUMN "brandName";
ALTER TABLE "LlmoSettings" DROP COLUMN "keywords";
ALTER TABLE "LlmoSettings" DROP COLUMN "prohibitions";
