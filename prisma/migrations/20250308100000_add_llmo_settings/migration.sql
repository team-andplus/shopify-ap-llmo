-- CreateTable (SQLite). ストアごとの LLMO 設定。
CREATE TABLE "LlmoSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "siteType" TEXT,
    "storeName" TEXT,
    "brandName" TEXT,
    "keywords" TEXT,
    "prohibitions" TEXT,
    "llmsTxtBody" TEXT,
    "llmsTxtFileUrl" TEXT,
    "llmsTxtFileId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex (shop で一意、1 ストア 1 行)
CREATE UNIQUE INDEX "LlmoSettings_shop_key" ON "LlmoSettings"("shop");
