<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Dynamic SMS, campaign batch processing, provider response persistence, manual payment methods
 * and top-up requests, provider sender catalog (docs/19-dynamic-sms-and-billing-audit.md §5).
 *
 * Additive only: new nullable/defaulted columns, enum values appended at the end (metadata-only in
 * MySQL 8 / MariaDB 10.4), new tables and indexes. Every step checks first, so a run interrupted
 * half-way can simply be re-run. Plain SQL, no SKIP LOCKED / CHECK / generated columns.
 *
 * down() removes the new tables/columns but refuses while rows use the new enum values (it would
 * otherwise silently corrupt them).
 */
return new class extends Migration
{
    private function addColumn(string $table, string $column, string $definition): void
    {
        if (! Schema::hasColumn($table, $column)) {
            DB::statement("ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definition}");
        }
    }

    private function addIndex(string $table, string $name, string $columns, bool $unique = false): void
    {
        $exists = DB::selectOne('SELECT 1 AS x FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1', [$table, $name]);
        if (! $exists) {
            DB::statement('CREATE '.($unique ? 'UNIQUE ' : '')."INDEX `{$name}` ON `{$table}`({$columns})");
        }
    }

    /** DROP INDEX IF EXISTS is MariaDB-only: check first (MySQL 8 too). */
    private function dropIndex(string $table, string $name): void
    {
        if (DB::selectOne('SELECT 1 AS x FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1', [$table, $name])) {
            DB::statement("DROP INDEX `{$name}` ON `{$table}`");
        }
    }

    private function columnType(string $table, string $column): string
    {
        return (string) DB::selectOne('SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [$table, $column])?->t;
    }

    public function up(): void
    {
        // ─── campaigns ───
        $this->addColumn('campaigns', 'kind', "ENUM('STANDARD', 'DYNAMIC') NOT NULL DEFAULT 'STANDARD'");
        $this->addColumn('campaigns', 'batchSize', 'INTEGER NOT NULL DEFAULT 100');
        $this->addColumn('campaigns', 'currentBatch', 'INTEGER NOT NULL DEFAULT 0');
        $this->addColumn('campaigns', 'unknownCount', 'INTEGER NOT NULL DEFAULT 0');
        $this->addColumn('campaigns', 'dynamicConfig', 'JSON NULL');
        $this->addColumn('campaigns', 'pausedById', 'CHAR(36) NULL');
        $this->addColumn('campaigns', 'resumedAt', 'DATETIME(3) NULL');
        $this->addColumn('campaigns', 'cancelledById', 'CHAR(36) NULL');
        $this->addColumn('campaigns', 'cancelReason', 'VARCHAR(500) NULL');
        $this->addColumn('campaigns', 'lastBatchAt', 'DATETIME(3) NULL');

        // ─── messages ───
        if (! str_contains($this->columnType('messages', 'status'), "'UNKNOWN'")) {
            DB::statement("ALTER TABLE `messages` MODIFY `status` ENUM('QUEUED', 'SUBMITTED', 'DELIVERED', 'FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'UNKNOWN') NOT NULL DEFAULT 'QUEUED'");
        }
        if (! str_contains($this->columnType('message_events', 'status'), "'UNKNOWN'")) {
            DB::statement("ALTER TABLE `message_events` MODIFY `status` ENUM('QUEUED', 'SUBMITTED', 'DELIVERED', 'FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'UNKNOWN') NOT NULL");
        }
        $this->addColumn('messages', 'batchNumber', 'INTEGER NULL');
        $this->addColumn('messages', 'providerStatusCode', 'VARCHAR(64) NULL');
        $this->addColumn('messages', 'providerResponse', 'JSON NULL');
        $this->addColumn('messages', 'providerRequestedAt', 'DATETIME(3) NULL');
        $this->addColumn('messages', 'providerRespondedAt', 'DATETIME(3) NULL');
        $this->addIndex('messages', 'messages_campaignId_batchNumber_idx', '`campaignId`, `batchNumber`');
        $this->addIndex('messages', 'messages_organizationId_senderValue_createdAt_idx', '`organizationId`, `senderValue`, `createdAt`');
        $this->addIndex('messages', 'messages_status_updatedAt_idx', '`status`, `updatedAt`');

        // ─── payments ───
        if (! str_contains($this->columnType('payments', 'status'), "'UNDER_REVIEW'")) {
            DB::statement("ALTER TABLE `payments` MODIFY `status` ENUM('PENDING', 'AWAITING_VERIFICATION', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'UNDER_REVIEW') NOT NULL DEFAULT 'PENDING'");
        }
        $this->addColumn('payments', 'paymentMethodId', 'CHAR(36) NULL');
        $this->addIndex('payments', 'payments_paymentMethodId_idx', '`paymentMethodId`');
        $this->addIndex('payments', 'payments_provider_manualReference_idx', '`provider`, `manualReference`');

        // ─── new tables ───
        if (! Schema::hasTable('payment_methods')) {
            DB::statement("CREATE TABLE `payment_methods` (
                `id` CHAR(36) NOT NULL,
                `type` ENUM('BKASH', 'NAGAD', 'ROCKET', 'BANK', 'OTHER') NOT NULL,
                `displayName` VARCHAR(120) NOT NULL,
                `accountNumber` VARCHAR(64) NOT NULL,
                `accountName` VARCHAR(120) NULL,
                `accountType` VARCHAR(40) NULL,
                `bankName` VARCHAR(120) NULL,
                `branchName` VARCHAR(120) NULL,
                `routingNumber` VARCHAR(40) NULL,
                `instructions` TEXT NULL,
                `qrImage` JSON NULL,
                `minAmount` DECIMAL(14, 4) NULL,
                `maxAmount` DECIMAL(14, 4) NULL,
                `requireProof` BOOLEAN NOT NULL DEFAULT false,
                `requireSenderNumber` BOOLEAN NOT NULL DEFAULT true,
                `active` BOOLEAN NOT NULL DEFAULT true,
                `sortOrder` INTEGER NOT NULL DEFAULT 0,
                `createdById` CHAR(36) NULL,
                `updatedById` CHAR(36) NULL,
                `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                `updatedAt` DATETIME(3) NOT NULL,
                `deletedAt` DATETIME(3) NULL,
                INDEX `payment_methods_active_sortOrder_idx`(`active`, `sortOrder`),
                PRIMARY KEY (`id`)
            ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        }
        if (! Schema::hasTable('campaign_uploads')) {
            DB::statement("CREATE TABLE `campaign_uploads` (
                `id` CHAR(36) NOT NULL,
                `organizationId` CHAR(36) NOT NULL,
                `createdById` CHAR(36) NULL,
                `fileKey` VARCHAR(255) NOT NULL,
                `fileName` VARCHAR(191) NOT NULL,
                `sizeBytes` INTEGER NOT NULL,
                `headers` JSON NOT NULL,
                `rowCount` INTEGER NOT NULL,
                `status` ENUM('READY', 'USED', 'EXPIRED') NOT NULL DEFAULT 'READY',
                `campaignId` CHAR(36) NULL,
                `expiresAt` DATETIME(3) NOT NULL,
                `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                `updatedAt` DATETIME(3) NOT NULL,
                INDEX `campaign_uploads_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
                INDEX `campaign_uploads_status_expiresAt_idx`(`status`, `expiresAt`),
                PRIMARY KEY (`id`)
            ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        }
        if (! Schema::hasTable('provider_sender_ids')) {
            DB::statement("CREATE TABLE `provider_sender_ids` (
                `id` CHAR(36) NOT NULL,
                `provider` VARCHAR(40) NOT NULL,
                `value` VARCHAR(191) NOT NULL,
                `type` ENUM('MASKING', 'NON_MASKING') NOT NULL,
                `providerStatus` VARCHAR(64) NULL,
                `source` ENUM('SYNC', 'MANUAL') NOT NULL DEFAULT 'MANUAL',
                `active` BOOLEAN NOT NULL DEFAULT true,
                `note` VARCHAR(255) NULL,
                `lastSyncedAt` DATETIME(3) NULL,
                `createdById` CHAR(36) NULL,
                `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                `updatedAt` DATETIME(3) NOT NULL,
                UNIQUE INDEX `provider_sender_ids_provider_value_key`(`provider`, `value`),
                PRIMARY KEY (`id`)
            ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        }
    }

    public function down(): void
    {
        $inUse = DB::scalar("SELECT (SELECT COUNT(*) FROM messages WHERE status = 'UNKNOWN') + (SELECT COUNT(*) FROM payments WHERE status = 'UNDER_REVIEW') + (SELECT COUNT(*) FROM campaigns WHERE kind = 'DYNAMIC')");
        if ((int) $inUse > 0) {
            throw new RuntimeException('Rows use UNKNOWN / UNDER_REVIEW / DYNAMIC values; resolve them before rolling back this migration.');
        }
        Schema::dropIfExists('provider_sender_ids');
        Schema::dropIfExists('campaign_uploads');
        Schema::dropIfExists('payment_methods');
        foreach (['payments_provider_manualReference_idx', 'payments_paymentMethodId_idx'] as $i) {
            $this->dropIndex('payments', $i);
        }
        foreach (['messages_campaignId_batchNumber_idx', 'messages_organizationId_senderValue_createdAt_idx', 'messages_status_updatedAt_idx'] as $i) {
            $this->dropIndex('messages', $i);
        }
        DB::statement("ALTER TABLE `payments` MODIFY `status` ENUM('PENDING', 'AWAITING_VERIFICATION', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED') NOT NULL DEFAULT 'PENDING'");
        DB::statement("ALTER TABLE `message_events` MODIFY `status` ENUM('QUEUED', 'SUBMITTED', 'DELIVERED', 'FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED') NOT NULL");
        DB::statement("ALTER TABLE `messages` MODIFY `status` ENUM('QUEUED', 'SUBMITTED', 'DELIVERED', 'FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED'");
        foreach (['payments' => ['paymentMethodId'], 'messages' => ['batchNumber', 'providerStatusCode', 'providerResponse', 'providerRequestedAt', 'providerRespondedAt'],
            'campaigns' => ['kind', 'batchSize', 'currentBatch', 'unknownCount', 'dynamicConfig', 'pausedById', 'resumedAt', 'cancelledById', 'cancelReason', 'lastBatchAt']] as $table => $cols) {
            foreach ($cols as $c) {
                if (Schema::hasColumn($table, $c)) {
                    DB::statement("ALTER TABLE `{$table}` DROP COLUMN `{$c}`");
                }
            }
        }
    }
};
