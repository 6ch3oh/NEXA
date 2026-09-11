package com.xingshu.nexa.mobile.capture.notification

import android.content.Context
import com.xingshu.nexa.mobile.capture.parser.AlipayNotificationParser
import com.xingshu.nexa.mobile.capture.parser.BankNotificationParser
import com.xingshu.nexa.mobile.capture.parser.NotificationParserRegistry
import com.xingshu.nexa.mobile.capture.parser.NotificationProcessingCoordinator
import com.xingshu.nexa.mobile.capture.parser.WeChatNotificationParser
import com.xingshu.nexa.mobile.data.local.NexaDatabaseFactory
import com.xingshu.nexa.mobile.data.repository.RoomNotificationRepository
import com.xingshu.nexa.mobile.data.repository.RoomNotificationSourceRepository
import com.xingshu.nexa.mobile.data.repository.RoomSyncQueueRepository
import com.xingshu.nexa.mobile.data.repository.RoomTransactionRepository
import com.xingshu.nexa.mobile.data.sync.background.WorkManagerBackgroundSyncScheduler
import com.xingshu.nexa.mobile.data.sync.security.AndroidMobileSecurityFactory
import java.util.UUID
import kotlinx.coroutines.runBlocking

internal class NotificationCaptureRuntimeFactory(
    private val verifiedSources: VerifiedNotificationSources = VerifiedNotificationSources.PRODUCTION,
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val idGenerator: (String) -> String = { prefix -> "$prefix-${UUID.randomUUID()}" },
) {
    fun create(context: Context): NotificationCaptureRuntime {
        val database = NexaDatabaseFactory.create(context)
        val deviceIdentityProvider = AndroidMobileSecurityFactory.create(context).deviceIdentityProvider
        val deviceId = runBlocking { deviceIdentityProvider.deviceId().value }
        val sequencePreferences = context.getSharedPreferences(
            "nexa.mobile.notification-sequence.v1",
            Context.MODE_PRIVATE,
        )
        val sequenceLock = Any()
        val notificationRepository = RoomNotificationRepository(database.rawNotificationEventDao())
        val transactionRepository = RoomTransactionRepository(
            dao = database.parsedTransactionDao(),
            clock = clock,
            transactionIdGenerator = { idGenerator("transaction") },
        )
        val backgroundSyncScheduler = WorkManagerBackgroundSyncScheduler.create(context)
        val syncQueueRepository = RoomSyncQueueRepository(
            dao = database.syncQueueDao(),
            clock = clock,
            queueIdFactory = { eventType, eventId ->
                "queue-v1:${eventType.name.length}:${eventType.name}:${eventId.length}:$eventId"
            },
            queueAvailableTrigger = backgroundSyncScheduler,
        )
        val sourceRepository = RoomNotificationSourceRepository(database.notificationSourceDao())
        val parserRegistry = NotificationParserRegistry(
            listOf(
                WeChatNotificationParser(verifiedSources.weChatPackages),
                AlipayNotificationParser(verifiedSources.alipayPackages),
                BankNotificationParser(verifiedSources.bankPackages),
            ),
        )
        val coordinator = NotificationProcessingCoordinator(
            database = database,
            notificationRepository = notificationRepository,
            transactionRepository = transactionRepository,
            syncQueueRepository = syncQueueRepository,
            parserRegistry = parserRegistry,
            eventIdGenerator = { idGenerator("event") },
        )
        return NotificationCaptureRuntime(
            snapshotFactory = AndroidNotificationSnapshotFactory(
                clock = clock,
                deviceId = { deviceId },
                sequenceProvider = { now ->
                    synchronized(sequenceLock) {
                        val floor = now.coerceAtMost(Long.MAX_VALUE / 1_000L) * 1_000L
                        val next = maxOf(sequencePreferences.getLong("last_sequence", 0L) + 1L, floor)
                        check(sequencePreferences.edit().putLong("last_sequence", next).commit()) {
                            "Unable to persist notification sequence"
                        }
                        next
                    }
                },
            ),
            sourceMetadataResolver = AndroidNotificationSourceMetadataResolver(context),
            capturePolicyGate = NotificationCapturePolicyGate(sourceRepository),
            coordinator = coordinator,
        )
    }
}

internal data class NotificationCaptureRuntime(
    val snapshotFactory: AndroidNotificationSnapshotFactory,
    val sourceMetadataResolver: AndroidNotificationSourceMetadataResolver,
    val capturePolicyGate: NotificationCapturePolicyGate,
    val coordinator: NotificationProcessingCoordinator,
)

internal class VerifiedNotificationSources(
    weChatPackages: Set<String> = emptySet(),
    alipayPackages: Set<String> = emptySet(),
    bankPackages: Set<String> = emptySet(),
) {
    val weChatPackages: Set<String> = weChatPackages.toSet()
    val alipayPackages: Set<String> = alipayPackages.toSet()
    val bankPackages: Set<String> = bankPackages.toSet()
    val allPackages: Set<String> =
        this.weChatPackages + this.alipayPackages + this.bankPackages

    init {
        require(allPackages.all(String::isNotBlank)) {
            "Verified notification package names must be non-blank"
        }
    }

    companion object {
        val EMPTY = VerifiedNotificationSources()

        val PRODUCTION = VerifiedNotificationSources(
            weChatPackages = setOf("com.tencent.mm"),
            alipayPackages = setOf("com.eg.android.AlipayGphone"),
            bankPackages = setOf("com.icbc"),
        )
    }
}
