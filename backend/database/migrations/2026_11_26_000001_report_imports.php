<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Report import (docs/24-report-import.md): staff import SMS delivery reports from a CSV into a
 * customer's message log.
 *
 * Additive only: the IMPORT value is appended to messages.source (metadata-only in MySQL 8 /
 * MariaDB 10.4) and one new table records each import. Every step checks first, so an interrupted
 * run can simply be re-run. down() refuses while imported messages exist.
 */
return new class extends Migration
{
    private function columnType(string $table, string $column): string
    {
        return (string) DB::selectOne('SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [$table, $column])?->t;
    }

    public function up(): void
    {
        if (! str_contains($this->columnType('messages', 'source'), "'IMPORT'")) {
            DB::statement("ALTER TABLE `messages` MODIFY `source` ENUM('API', 'CAMPAIGN', 'DASHBOARD', 'SYSTEM', 'IMPORT') NOT NULL");
        }

        if (! Schema::hasTable('report_imports')) {
            DB::statement("CREATE TABLE `report_imports` (
                `id` CHAR(36) NOT NULL,
                `organizationId` CHAR(36) NOT NULL,
                `createdById` CHAR(36) NULL,
                `fileName` VARCHAR(160) NOT NULL,
                `fileSha256` CHAR(64) NOT NULL,
                `rowCount` INTEGER NOT NULL DEFAULT 0,
                `importedCount` INTEGER NOT NULL DEFAULT 0,
                `skippedCount` INTEGER NOT NULL DEFAULT 0,
                `segments` INTEGER NOT NULL DEFAULT 0,
                `totalCost` DECIMAL(14, 4) NOT NULL DEFAULT 0,
                `charged` BOOLEAN NOT NULL DEFAULT false,
                `walletTransactionId` CHAR(36) NULL,
                `firstSentAt` DATETIME(3) NULL,
                `lastSentAt` DATETIME(3) NULL,
                `note` VARCHAR(500) NULL,
                `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                `updatedAt` DATETIME(3) NOT NULL,
                UNIQUE INDEX `report_imports_organizationId_fileSha256_key`(`organizationId`, `fileSha256`),
                INDEX `report_imports_createdAt_idx`(`createdAt`),
                PRIMARY KEY (`id`)
            ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        }
    }

    public function down(): void
    {
        if ((int) DB::scalar("SELECT COUNT(*) FROM messages WHERE source = 'IMPORT'") > 0) {
            throw new RuntimeException('Imported messages exist (source = IMPORT); delete them before rolling back this migration.');
        }
        Schema::dropIfExists('report_imports');
        DB::statement("ALTER TABLE `messages` MODIFY `source` ENUM('API', 'CAMPAIGN', 'DASHBOARD', 'SYSTEM') NOT NULL");
    }
};
