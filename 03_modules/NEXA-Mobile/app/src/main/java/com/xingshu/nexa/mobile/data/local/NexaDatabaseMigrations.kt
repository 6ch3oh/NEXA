package com.xingshu.nexa.mobile.data.local

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

object NexaDatabaseMigrations {
    internal val MIGRATION_1_2_STATEMENTS: List<String> = listOf(
        """
        CREATE TABLE IF NOT EXISTS `raw_notification_events` (
            `event_id` TEXT NOT NULL,
            `source_package` TEXT NOT NULL,
            `source_channel` TEXT,
            `notification_key` TEXT,
            `title` TEXT,
            `body` TEXT,
            `raw_text` TEXT NOT NULL DEFAULT '',
            `posted_at` INTEGER NOT NULL,
            `captured_at` INTEGER NOT NULL,
            `event_fingerprint` TEXT NOT NULL,
            `parse_status` TEXT NOT NULL DEFAULT 'PENDING',
            `parser_version` TEXT,
            `payload_version` INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY(`event_id`)
        )
        """.trimIndent(),
        """
        CREATE TABLE IF NOT EXISTS `parsed_transactions` (
            `transaction_id` TEXT NOT NULL,
            `transaction_fingerprint` TEXT NOT NULL,
            `transaction_type` TEXT NOT NULL,
            `amount_minor` INTEGER NOT NULL,
            `currency` TEXT NOT NULL DEFAULT 'CNY',
            `merchant` TEXT,
            `counterparty` TEXT,
            `payment_channel` TEXT NOT NULL,
            `account_hint` TEXT,
            `transaction_time` INTEGER,
            `source_event_id` TEXT NOT NULL,
            `confidence` INTEGER NOT NULL,
            `raw_reference` TEXT,
            `parser_version` TEXT NOT NULL,
            `payload_version` INTEGER NOT NULL DEFAULT 1,
            `parsed_at` INTEGER NOT NULL,
            PRIMARY KEY(`transaction_id`),
            FOREIGN KEY(`source_event_id`)
                REFERENCES `raw_notification_events`(`event_id`)
                ON UPDATE NO ACTION
                ON DELETE RESTRICT
        )
        """.trimIndent(),
        """
        CREATE TABLE IF NOT EXISTS `sync_queue` (
            `queue_id` TEXT NOT NULL,
            `event_id` TEXT NOT NULL,
            `event_type` TEXT NOT NULL,
            `state` TEXT NOT NULL DEFAULT 'QUEUED',
            `attempt_count` INTEGER NOT NULL DEFAULT 0,
            `next_attempt_at` INTEGER NOT NULL,
            `lease_expires_at` INTEGER,
            `batch_id` TEXT,
            `last_error_code` TEXT,
            `created_at` INTEGER NOT NULL,
            `updated_at` INTEGER NOT NULL,
            `acknowledged_at` INTEGER,
            PRIMARY KEY(`queue_id`)
        )
        """.trimIndent(),
        """
        CREATE UNIQUE INDEX IF NOT EXISTS
        `index_raw_notification_events_event_fingerprint`
        ON `raw_notification_events` (`event_fingerprint`)
        """.trimIndent(),
        """
        CREATE INDEX IF NOT EXISTS
        `index_raw_notification_events_notification_key`
        ON `raw_notification_events` (`notification_key`)
        """.trimIndent(),
        """
        CREATE INDEX IF NOT EXISTS
        `index_raw_notification_events_source_package_posted_at`
        ON `raw_notification_events` (`source_package`, `posted_at`)
        """.trimIndent(),
        """
        CREATE INDEX IF NOT EXISTS
        `index_raw_notification_events_parse_status_captured_at`
        ON `raw_notification_events` (`parse_status`, `captured_at`)
        """.trimIndent(),
        """
        CREATE UNIQUE INDEX IF NOT EXISTS
        `index_parsed_transactions_transaction_fingerprint`
        ON `parsed_transactions` (`transaction_fingerprint`)
        """.trimIndent(),
        """
        CREATE INDEX IF NOT EXISTS
        `index_parsed_transactions_source_event_id`
        ON `parsed_transactions` (`source_event_id`)
        """.trimIndent(),
        """
        CREATE INDEX IF NOT EXISTS
        `index_parsed_transactions_transaction_time`
        ON `parsed_transactions` (`transaction_time`)
        """.trimIndent(),
        """
        CREATE INDEX IF NOT EXISTS
        `index_parsed_transactions_transaction_type`
        ON `parsed_transactions` (`transaction_type`)
        """.trimIndent(),
        """
        CREATE UNIQUE INDEX IF NOT EXISTS
        `index_sync_queue_event_type_event_id`
        ON `sync_queue` (`event_type`, `event_id`)
        """.trimIndent(),
        """
        CREATE INDEX IF NOT EXISTS
        `index_sync_queue_state_next_attempt_at`
        ON `sync_queue` (`state`, `next_attempt_at`)
        """.trimIndent(),
        """
        CREATE INDEX IF NOT EXISTS
        `index_sync_queue_batch_id`
        ON `sync_queue` (`batch_id`)
        """.trimIndent(),
        """
        CREATE INDEX IF NOT EXISTS
        `index_sync_queue_lease_expires_at`
        ON `sync_queue` (`lease_expires_at`)
        """.trimIndent(),
    )

    val MIGRATION_1_2: Migration = object : Migration(1, 2) {
        override fun migrate(database: SupportSQLiteDatabase) {
            MIGRATION_1_2_STATEMENTS.forEach(database::execSQL)
        }
    }

    internal val MIGRATION_2_3_STATEMENTS: List<String> = listOf(
        """
        CREATE TABLE IF NOT EXISTS `notification_sources` (
            `package_name` TEXT NOT NULL,
            `source_scope` TEXT NOT NULL,
            `channel_id` TEXT NOT NULL,
            `app_label` TEXT,
            `channel_display_name` TEXT,
            `first_seen_at` INTEGER NOT NULL,
            `last_seen_at` INTEGER NOT NULL,
            `policy` TEXT NOT NULL,
            PRIMARY KEY(`package_name`, `source_scope`, `channel_id`)
        )
        """.trimIndent(),
        """
        CREATE TABLE IF NOT EXISTS `notification_capture_settings` (
            `id` INTEGER NOT NULL,
            `global_enabled` INTEGER NOT NULL,
            `updated_at` INTEGER NOT NULL,
            PRIMARY KEY(`id`)
        )
        """.trimIndent(),
        """
        CREATE INDEX IF NOT EXISTS `index_notification_sources_last_seen_at`
        ON `notification_sources` (`last_seen_at`)
        """.trimIndent(),
        """
        CREATE INDEX IF NOT EXISTS `index_notification_sources_policy_package_name`
        ON `notification_sources` (`policy`, `package_name`)
        """.trimIndent(),
        """
        INSERT OR IGNORE INTO `notification_capture_settings`
            (`id`, `global_enabled`, `updated_at`)
        VALUES (1, 1, 0)
        """.trimIndent(),
        """
        INSERT OR IGNORE INTO `notification_sources`
            (`package_name`, `source_scope`, `channel_id`, `app_label`,
             `channel_display_name`, `first_seen_at`, `last_seen_at`, `policy`)
        VALUES ('com.tencent.mm', 'APP', '', NULL, NULL, 0, 0, 'ALLOW')
        """.trimIndent(),
        """
        INSERT OR IGNORE INTO `notification_sources`
            (`package_name`, `source_scope`, `channel_id`, `app_label`,
             `channel_display_name`, `first_seen_at`, `last_seen_at`, `policy`)
        VALUES ('com.eg.android.AlipayGphone', 'APP', '', NULL, NULL, 0, 0, 'ALLOW')
        """.trimIndent(),
        """
        INSERT OR IGNORE INTO `notification_sources`
            (`package_name`, `source_scope`, `channel_id`, `app_label`,
             `channel_display_name`, `first_seen_at`, `last_seen_at`, `policy`)
        SELECT `source_package`, 'APP', '', NULL, NULL,
               MIN(`captured_at`), MAX(`captured_at`),
               CASE WHEN `source_package` IN
                    ('com.tencent.mm', 'com.eg.android.AlipayGphone')
                    THEN 'ALLOW' ELSE 'INHERIT' END
        FROM `raw_notification_events`
        WHERE `source_package` <> ''
        GROUP BY `source_package`
        """.trimIndent(),
        """
        UPDATE `notification_sources`
        SET `first_seen_at` = (
                SELECT MIN(`captured_at`) FROM `raw_notification_events`
                WHERE `source_package` = `notification_sources`.`package_name`
            ),
            `last_seen_at` = (
                SELECT MAX(`captured_at`) FROM `raw_notification_events`
                WHERE `source_package` = `notification_sources`.`package_name`
            ),
            `policy` = CASE WHEN `package_name` IN
                ('com.tencent.mm', 'com.eg.android.AlipayGphone')
                THEN 'ALLOW' ELSE `policy` END
        WHERE `source_scope` = 'APP'
          AND EXISTS (
              SELECT 1 FROM `raw_notification_events`
              WHERE `source_package` = `notification_sources`.`package_name`
          )
        """.trimIndent(),
        """
        INSERT OR IGNORE INTO `notification_sources`
            (`package_name`, `source_scope`, `channel_id`, `app_label`,
             `channel_display_name`, `first_seen_at`, `last_seen_at`, `policy`)
        SELECT `source_package`, 'CHANNEL', `source_channel`, NULL, NULL,
               MIN(`captured_at`), MAX(`captured_at`), 'INHERIT'
        FROM `raw_notification_events`
        WHERE `source_package` <> ''
          AND `source_channel` IS NOT NULL AND `source_channel` <> ''
        GROUP BY `source_package`, `source_channel`
        """.trimIndent(),
        """
        INSERT OR IGNORE INTO `notification_sources`
            (`package_name`, `source_scope`, `channel_id`, `app_label`,
             `channel_display_name`, `first_seen_at`, `last_seen_at`, `policy`)
        SELECT `source_package`, 'NULL_CHANNEL', '', NULL, NULL,
               MIN(`captured_at`), MAX(`captured_at`), 'INHERIT'
        FROM `raw_notification_events`
        WHERE `source_package` <> ''
          AND (`source_channel` IS NULL OR `source_channel` = '')
        GROUP BY `source_package`
        """.trimIndent(),
    )

    val MIGRATION_2_3: Migration = object : Migration(2, 3) {
        override fun migrate(database: SupportSQLiteDatabase) {
            MIGRATION_2_3_STATEMENTS.forEach(database::execSQL)
        }
    }

    internal val MIGRATION_3_4_STATEMENTS: List<String> = listOf(
        "ALTER TABLE `raw_notification_events` ADD COLUMN `notification_id` INTEGER",
        "ALTER TABLE `raw_notification_events` ADD COLUMN `big_text` TEXT",
        "ALTER TABLE `raw_notification_events` ADD COLUMN `sub_text` TEXT",
        "ALTER TABLE `raw_notification_events` ADD COLUMN `category` TEXT",
        "ALTER TABLE `raw_notification_events` ADD COLUMN `group_key` TEXT",
        "ALTER TABLE `raw_notification_events` ADD COLUMN `ingestion_time` INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE `raw_notification_events` ADD COLUMN `content_hash` TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE `raw_notification_events` ADD COLUMN `source_device` TEXT",
        "ALTER TABLE `raw_notification_events` ADD COLUMN `sensitivity` TEXT NOT NULL DEFAULT 'NORMAL'",
        "UPDATE `raw_notification_events` SET `ingestion_time` = `captured_at` WHERE `ingestion_time` = 0",
        "UPDATE `raw_notification_events` SET `content_hash` = `event_fingerprint` WHERE `content_hash` = ''",
    )

    val MIGRATION_3_4: Migration = object : Migration(3, 4) {
        override fun migrate(database: SupportSQLiteDatabase) {
            MIGRATION_3_4_STATEMENTS.forEach(database::execSQL)
        }
    }

    internal val MIGRATION_4_5_STATEMENTS: List<String> = listOf(
        "ALTER TABLE `raw_notification_events` ADD COLUMN `app_label` TEXT",
        "ALTER TABLE `raw_notification_events` ADD COLUMN `summary_text` TEXT",
        "ALTER TABLE `raw_notification_events` ADD COLUMN `device_id` TEXT",
        "ALTER TABLE `raw_notification_events` ADD COLUMN `event_type` TEXT NOT NULL DEFAULT 'POSTED'",
        "ALTER TABLE `raw_notification_events` ADD COLUMN `notification_when` INTEGER",
        "ALTER TABLE `raw_notification_events` ADD COLUMN `listener_received_at` INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE `raw_notification_events` ADD COLUMN `notification_flags` INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE `raw_notification_events` ADD COLUMN `ongoing` INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE `raw_notification_events` ADD COLUMN `removed_at` INTEGER",
        "ALTER TABLE `raw_notification_events` ADD COLUMN `sequence_number` INTEGER NOT NULL DEFAULT 0",
        "UPDATE `raw_notification_events` SET `listener_received_at` = `captured_at` WHERE `listener_received_at` = 0",
        "CREATE INDEX IF NOT EXISTS `index_raw_notification_events_device_id_sequence_number` ON `raw_notification_events` (`device_id`, `sequence_number`)",
        "CREATE INDEX IF NOT EXISTS `index_raw_notification_events_event_type_posted_at` ON `raw_notification_events` (`event_type`, `posted_at`)",
    )

    val MIGRATION_4_5: Migration = object : Migration(4, 5) {
        override fun migrate(database: SupportSQLiteDatabase) {
            MIGRATION_4_5_STATEMENTS.forEach(database::execSQL)
        }
    }
}
