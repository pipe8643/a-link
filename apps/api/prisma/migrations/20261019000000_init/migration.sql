-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `displayName` VARCHAR(120) NOT NULL DEFAULT '',
    `passwordHash` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `absoluteExpiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `userAgent` VARCHAR(255) NULL,

    UNIQUE INDEX `sessions_tokenHash_key`(`tokenHash`),
    INDEX `sessions_userId_revokedAt_idx`(`userId`, `revokedAt`),
    INDEX `sessions_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_reset_tokens` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `password_reset_tokens_tokenHash_key`(`tokenHash`),
    INDEX `password_reset_tokens_userId_idx`(`userId`),
    INDEX `password_reset_tokens_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `folders` (
    `id` CHAR(36) NOT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `parentId` CHAR(36) NULL,
    `name` VARCHAR(200) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `folders_ownerId_parentId_idx`(`ownerId`, `parentId`),
    INDEX `folders_ownerId_name_idx`(`ownerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `graphs` (
    `id` CHAR(36) NOT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `folderId` CHAR(36) NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` VARCHAR(2000) NOT NULL DEFAULT '',
    `graphDataVersion` INTEGER NOT NULL DEFAULT 1,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `viewState` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `graphs_ownerId_deletedAt_updatedAt_idx`(`ownerId`, `deletedAt`, `updatedAt`),
    INDEX `graphs_ownerId_folderId_idx`(`ownerId`, `folderId`),
    INDEX `graphs_ownerId_name_idx`(`ownerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `graph_nodes` (
    `id` CHAR(36) NOT NULL,
    `graphId` CHAR(36) NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `label` VARCHAR(200) NOT NULL,
    `description` VARCHAR(2000) NOT NULL DEFAULT '',
    `notes` VARCHAR(8000) NOT NULL DEFAULT '',
    `tags` JSON NOT NULL,
    `metadata` JSON NOT NULL,
    `positionX` DOUBLE NULL,
    `positionY` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `graph_nodes_graphId_type_idx`(`graphId`, `type`),
    INDEX `graph_nodes_graphId_label_idx`(`graphId`, `label`),
    UNIQUE INDEX `graph_nodes_graphId_id_key`(`graphId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `graph_edges` (
    `id` CHAR(36) NOT NULL,
    `graphId` CHAR(36) NOT NULL,
    `sourceNodeId` CHAR(36) NOT NULL,
    `targetNodeId` CHAR(36) NOT NULL,
    `relationshipType` VARCHAR(40) NOT NULL,
    `label` VARCHAR(200) NOT NULL DEFAULT '',
    `metadata` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `graph_edges_graphId_idx`(`graphId`),
    INDEX `graph_edges_graphId_sourceNodeId_idx`(`graphId`, `sourceNodeId`),
    INDEX `graph_edges_graphId_targetNodeId_idx`(`graphId`, `targetNodeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `export_files` (
    `id` CHAR(36) NOT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `graphId` CHAR(36) NOT NULL,
    `folderId` CHAR(36) NULL,
    `name` VARCHAR(200) NOT NULL,
    `format` ENUM('PNG', 'JPEG', 'PDF', 'PPTX') NOT NULL,
    `storageKey` VARCHAR(255) NOT NULL,
    `fileSize` INTEGER NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `export_files_storageKey_key`(`storageKey`),
    INDEX `export_files_ownerId_createdAt_idx`(`ownerId`, `createdAt`),
    INDEX `export_files_graphId_idx`(`graphId`),
    INDEX `export_files_ownerId_folderId_idx`(`ownerId`, `folderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `actorId` CHAR(36) NULL,
    `action` VARCHAR(80) NOT NULL,
    `resourceType` VARCHAR(40) NOT NULL,
    `resourceId` CHAR(36) NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `metadata` JSON NULL,

    INDEX `audit_logs_actorId_timestamp_idx`(`actorId`, `timestamp`),
    INDEX `audit_logs_resourceType_resourceId_idx`(`resourceType`, `resourceId`),
    INDEX `audit_logs_timestamp_idx`(`timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `folders` ADD CONSTRAINT `folders_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `folders` ADD CONSTRAINT `folders_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `folders`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `graphs` ADD CONSTRAINT `graphs_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `graphs` ADD CONSTRAINT `graphs_folderId_fkey` FOREIGN KEY (`folderId`) REFERENCES `folders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `graph_nodes` ADD CONSTRAINT `graph_nodes_graphId_fkey` FOREIGN KEY (`graphId`) REFERENCES `graphs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `graph_edges` ADD CONSTRAINT `graph_edges_graphId_fkey` FOREIGN KEY (`graphId`) REFERENCES `graphs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `graph_edges` ADD CONSTRAINT `graph_edges_graphId_sourceNodeId_fkey` FOREIGN KEY (`graphId`, `sourceNodeId`) REFERENCES `graph_nodes`(`graphId`, `id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `graph_edges` ADD CONSTRAINT `graph_edges_graphId_targetNodeId_fkey` FOREIGN KEY (`graphId`, `targetNodeId`) REFERENCES `graph_nodes`(`graphId`, `id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `export_files` ADD CONSTRAINT `export_files_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `export_files` ADD CONSTRAINT `export_files_graphId_fkey` FOREIGN KEY (`graphId`) REFERENCES `graphs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `export_files` ADD CONSTRAINT `export_files_folderId_fkey` FOREIGN KEY (`folderId`) REFERENCES `folders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

