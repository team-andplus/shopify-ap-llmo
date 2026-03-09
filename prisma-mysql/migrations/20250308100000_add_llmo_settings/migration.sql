-- CreateTable (MySQL). ストアごとの LLMO 設定。
CREATE TABLE `LlmoSettings` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `siteType` VARCHAR(191) NULL,
    `storeName` VARCHAR(191) NULL,
    `brandName` VARCHAR(191) NULL,
    `keywords` VARCHAR(191) NULL,
    `prohibitions` TEXT NULL,
    `llmsTxtBody` TEXT NULL,
    `llmsTxtFileUrl` TEXT NULL,
    `llmsTxtFileId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LlmoSettings_shop_key`(`shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
