-- Imágenes de entidades y enlaces de solo lectura.

-- AlterTable
ALTER TABLE `graph_nodes` ADD COLUMN `imageId` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `graph_images` (
    `id` CHAR(36) NOT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `graphId` CHAR(36) NOT NULL,
    `mime` VARCHAR(20) NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `size` INTEGER NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `data` LONGBLOB NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `graph_images_graphId_createdAt_idx`(`graphId`, `createdAt`),
    INDEX `graph_images_ownerId_idx`(`ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `share_links` (
    `id` CHAR(36) NOT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `graphId` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastViewedAt` DATETIME(3) NULL,
    `viewCount` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `share_links_tokenHash_key`(`tokenHash`),
    INDEX `share_links_graphId_createdAt_idx`(`graphId`, `createdAt`),
    INDEX `share_links_ownerId_idx`(`ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `graph_nodes_imageId_idx` ON `graph_nodes`(`imageId`);

-- AddForeignKey
ALTER TABLE `graph_nodes` ADD CONSTRAINT `graph_nodes_imageId_fkey` FOREIGN KEY (`imageId`) REFERENCES `graph_images`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `graph_images` ADD CONSTRAINT `graph_images_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `graph_images` ADD CONSTRAINT `graph_images_graphId_fkey` FOREIGN KEY (`graphId`) REFERENCES `graphs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `share_links` ADD CONSTRAINT `share_links_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `share_links` ADD CONSTRAINT `share_links_graphId_fkey` FOREIGN KEY (`graphId`) REFERENCES `graphs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Restricciones que Prisma no modela (MySQL >= 8.0.16 las aplica).
ALTER TABLE `graph_images`
  ADD CONSTRAINT `graph_images_dimensions_chk` CHECK (`width` > 0 AND `height` > 0 AND `size` > 0);

-- Un enlace caduca siempre DESPUÉS de crearse.
ALTER TABLE `share_links`
  ADD CONSTRAINT `share_links_expiry_chk` CHECK (`expiresAt` > `createdAt`);
