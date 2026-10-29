-- Membrete personal del visor HTML y de PowerPoint (una imagen por cuenta).

CREATE TABLE `user_letterheads` (
    `userId` CHAR(36) NOT NULL,
    `mime` VARCHAR(20) NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `size` INTEGER NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `data` LONGBLOB NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_letterheads` ADD CONSTRAINT `user_letterheads_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
