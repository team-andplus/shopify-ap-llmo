-- 思想・プロトコルに則した項目へ変更（あんどぷらす llms.txt 参照）
ALTER TABLE `LlmoSettings` ADD COLUMN `title` VARCHAR(191) NULL;
ALTER TABLE `LlmoSettings` ADD COLUMN `roleSummary` TEXT NULL;
ALTER TABLE `LlmoSettings` ADD COLUMN `sectionsOutline` TEXT NULL;
ALTER TABLE `LlmoSettings` ADD COLUMN `notesForAi` TEXT NULL;

UPDATE `LlmoSettings` SET `title` = COALESCE(`storeName`, `brandName`) WHERE `storeName` IS NOT NULL OR `brandName` IS NOT NULL;
UPDATE `LlmoSettings` SET `notesForAi` = `prohibitions` WHERE `prohibitions` IS NOT NULL;

ALTER TABLE `LlmoSettings` DROP COLUMN `storeName`;
ALTER TABLE `LlmoSettings` DROP COLUMN `brandName`;
ALTER TABLE `LlmoSettings` DROP COLUMN `keywords`;
ALTER TABLE `LlmoSettings` DROP COLUMN `prohibitions`;
