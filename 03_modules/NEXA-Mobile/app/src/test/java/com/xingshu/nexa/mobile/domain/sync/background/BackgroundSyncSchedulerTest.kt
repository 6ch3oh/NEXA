package com.xingshu.nexa.mobile.domain.sync.background

import com.xingshu.nexa.mobile.domain.sync.SyncCoordinatorResult
import com.xingshu.nexa.mobile.domain.sync.SyncProcessingResult
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BackgroundSyncSchedulerTest {
    @Test
    fun `queue trigger schedules unique network work and records network wait`() {
        val offlineStatus = InMemoryBackgroundStatusStore()
        val offlineBackend = RecordingWorkBackend()
        BackgroundSyncScheduler(offlineStatus, { false }, offlineBackend).onQueueAvailable()

        assertEquals(BackgroundSyncState.WAITING_FOR_NETWORK, offlineStatus.read().state)
        assertEquals(1, offlineBackend.immediate)
        assertEquals(1, offlineBackend.periodic)

        val onlineStatus = InMemoryBackgroundStatusStore()
        val onlineBackend = RecordingWorkBackend()
        BackgroundSyncScheduler(onlineStatus, { true }, onlineBackend).onQueueAvailable()

        assertEquals(BackgroundSyncState.SCHEDULED, onlineStatus.read().state)
        assertEquals(1, onlineBackend.immediate)
        assertEquals(1, onlineBackend.periodic)
    }

    @Test
    fun `known terminal configuration failure suppresses scheduling until resumed`() {
        val status = InMemoryBackgroundStatusStore(
            BackgroundSyncStatus(
                BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE,
                "CONFIG_REQUIRED",
            ),
        )
        val backend = RecordingWorkBackend()
        val scheduler = BackgroundSyncScheduler(status, { true }, backend)

        scheduler.onQueueAvailable()
        assertEquals(0, backend.immediate)
        assertEquals(0, backend.periodic)

        scheduler.resumeAfterConfigurationChange()
        assertEquals(BackgroundSyncState.SCHEDULED, status.read().state)
        assertEquals(0, backend.immediate)
        assertEquals(1, backend.keptImmediate)
        assertEquals(0, backend.replacedImmediate)
        assertEquals(1, backend.periodic)
    }

    @Test
    fun `real target change updates desired state and keeps active recovery work`() {
        val status = InMemoryBackgroundStatusStore(
            BackgroundSyncStatus(BackgroundSyncState.RETRY_PENDING, "NETWORK_IO"),
        )
        val backend = RecordingWorkBackend()

        BackgroundSyncScheduler(status, { true }, backend).reconnect(
            ReconnectWorkDecision.UPDATE_DESIRED_KEEP,
        )

        assertEquals(BackgroundSyncState.SCHEDULED, status.read().state)
        assertEquals(0, backend.immediate)
        assertEquals(1, backend.keptImmediate)
        assertEquals(0, backend.replacedImmediate)
        assertEquals(1, backend.periodic)
    }

    @Test
    fun `identical reconnect keeps enqueued or running immediate work`() {
        val status = InMemoryBackgroundStatusStore(
            BackgroundSyncStatus(BackgroundSyncState.RUNNING),
        )
        val backend = RecordingWorkBackend()

        BackgroundSyncScheduler(status, { true }, backend).reconnect(ReconnectWorkDecision.KEEP)

        assertEquals(BackgroundSyncState.RUNNING, status.read().state)
        assertEquals(0, backend.immediate)
        assertEquals(1, backend.keptImmediate)
        assertEquals(0, backend.replacedImmediate)
        assertEquals(1, backend.periodic)
    }

    @Test
    fun `configuration change keeps immediate work and preserves periodic work`() {
        val status = InMemoryBackgroundStatusStore()
        val backend = RecordingWorkBackend()

        BackgroundSyncScheduler(status, { true }, backend).resumeAfterConfigurationChange()

        assertEquals(0, backend.immediate)
        assertEquals(1, backend.keptImmediate)
        assertEquals(0, backend.replacedImmediate)
        assertEquals(1, backend.periodic)
    }

    @Test
    fun `explicit recovery wake bypasses stale backoff without replacing active work`() {
        val status = InMemoryBackgroundStatusStore(
            BackgroundSyncStatus(BackgroundSyncState.RETRY_PENDING, "NETWORK_IO"),
        )
        val backend = RecordingWorkBackend()

        BackgroundSyncScheduler(status, { true }, backend).wakeImmediately()

        assertEquals(BackgroundSyncState.SCHEDULED, status.read().state)
        assertEquals(1, backend.freshImmediate)
        assertEquals(0, backend.replacedImmediate)
        assertEquals(1, backend.periodic)
    }

    @Test
    fun `application safety scheduling failure becomes terminal configuration status`() {
        val status = InMemoryBackgroundStatusStore()
        val backend = object : BackgroundSyncWorkBackend {
            override fun enqueueImmediateNetworkWork() = Unit
            override fun ensurePeriodicNetworkWork() {
                error("fixture scheduling failure")
            }
        }

        BackgroundSyncScheduler(status, { true }, backend).ensurePeriodicWork()

        assertEquals(BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE, status.read().state)
        assertEquals("WORK_SCHEDULING_FAILED", status.read().reasonCode)
    }

    @Test
    fun `worker round calls coordinator exactly once and becomes idle`() = runBlocking {
        val status = InMemoryBackgroundStatusStore()
        var calls = 0
        val execution = BackgroundSyncExecution(
            coordinatorProvider = {
                SyncCoordinatorRun {
                    calls += 1
                    SyncCoordinatorResult(selected = 0, leased = 0, recoveredLeases = 0)
                }
            },
            statusStore = status,
        )

        val outcome = execution.runOnce()

        assertEquals(1, calls)
        assertTrue(outcome is BackgroundSyncExecutionOutcome.Completed)
        assertEquals(BackgroundSyncState.IDLE, status.read().state)
        assertEquals(BackgroundWorkerCompletion.SUCCESS, outcome.workerCompletion())
    }

    @Test
    fun `replay drain checkpoints bounded batches until the queue is empty`() = runBlocking {
        val status = InMemoryBackgroundStatusStore()
        var calls = 0
        val execution = BackgroundSyncExecution(
            coordinatorProvider = {
                SyncCoordinatorRun {
                    calls += 1
                    when (calls) {
                        1 -> SyncCoordinatorResult(
                            selected = 50,
                            leased = 50,
                            recoveredLeases = 2,
                            replayEnqueued = 50,
                            processing = SyncProcessingResult(acknowledged = 45, duplicates = 5),
                        )
                        2 -> SyncCoordinatorResult(
                            selected = 50,
                            leased = 50,
                            recoveredLeases = 0,
                            replayEnqueued = 50,
                            processing = SyncProcessingResult(acknowledged = 50),
                        )
                        else -> SyncCoordinatorResult(
                            selected = 0,
                            leased = 0,
                            recoveredLeases = 0,
                        )
                    }
                }
            },
            statusStore = status,
        )

        val outcome = execution.runBatches(10) as BackgroundSyncExecutionOutcome.Completed

        assertEquals(3, calls)
        assertEquals(100, outcome.coordinatorResult.leased)
        assertEquals(100, outcome.coordinatorResult.replayEnqueued)
        assertEquals(95, outcome.coordinatorResult.processing.acknowledged)
        assertEquals(5, outcome.coordinatorResult.processing.duplicates)
        assertEquals(BackgroundSyncState.IDLE, outcome.state)
    }

    @Test
    fun `replay drain stays scheduled when its bounded window still has a full batch`() =
        runBlocking {
            var calls = 0
            val execution = BackgroundSyncExecution(
                coordinatorProvider = {
                    SyncCoordinatorRun {
                        calls += 1
                        SyncCoordinatorResult(
                            selected = 50,
                            leased = 50,
                            recoveredLeases = 0,
                            replayEnqueued = 50,
                            processing = SyncProcessingResult(acknowledged = 50),
                        )
                    }
                },
                statusStore = InMemoryBackgroundStatusStore(),
            )

            val outcome = execution.runBatches(3) as BackgroundSyncExecutionOutcome.Completed

            assertEquals(3, calls)
            assertEquals(150, outcome.coordinatorResult.leased)
            assertEquals(BackgroundSyncState.SCHEDULED, outcome.state)
        }

    @Test
    fun `domain retry stays retry pending while WorkManager completes successfully`() = runBlocking {
        val status = InMemoryBackgroundStatusStore()
        val execution = BackgroundSyncExecution(
            coordinatorProvider = {
                SyncCoordinatorRun {
                    SyncCoordinatorResult(
                        selected = 1,
                        leased = 1,
                        recoveredLeases = 0,
                        processing = SyncProcessingResult(retryScheduled = 1),
                    )
                }
            },
            statusStore = status,
        )

        val outcome = execution.runOnce()

        assertEquals(BackgroundSyncState.RETRY_PENDING, status.read().state)
        assertEquals(BackgroundWorkerCompletion.SUCCESS, outcome.workerCompletion())
    }

    @Test
    fun `configuration failure is terminal and does not request WorkManager retry`() = runBlocking {
        val status = InMemoryBackgroundStatusStore()
        val execution = BackgroundSyncExecution(
            coordinatorProvider = {
                throw BackgroundSyncConfigurationException("SYNC_CONNECTION_CONFIGURATION_REQUIRED")
            },
            statusStore = status,
        )

        val outcome = execution.runOnce()

        assertTrue(outcome is BackgroundSyncExecutionOutcome.TerminalConfigurationFailure)
        assertEquals(BackgroundSyncState.TERMINAL_CONFIGURATION_FAILURE, status.read().state)
        assertEquals(BackgroundWorkerCompletion.FAILURE, outcome.workerCompletion())
    }

    @Test
    fun `concurrent worker rounds serialize coordinator execution`() = runBlocking {
        val active = AtomicInteger()
        val maximumActive = AtomicInteger()
        val calls = AtomicInteger()
        val provider = BackgroundSyncCoordinatorProvider {
            SyncCoordinatorRun {
                calls.incrementAndGet()
                val nowActive = active.incrementAndGet()
                maximumActive.updateAndGet { current -> maxOf(current, nowActive) }
                delay(25L)
                active.decrementAndGet()
                SyncCoordinatorResult(selected = 0, leased = 0, recoveredLeases = 0)
            }
        }

        coroutineScope {
            listOf(
                async { BackgroundSyncExecution(provider, InMemoryBackgroundStatusStore()).runOnce() },
                async { BackgroundSyncExecution(provider, InMemoryBackgroundStatusStore()).runOnce() },
            ).awaitAll()
        }

        assertEquals(2, calls.get())
        assertEquals(1, maximumActive.get())
    }
}

private class InMemoryBackgroundStatusStore(
    initial: BackgroundSyncStatus = BackgroundSyncStatus(BackgroundSyncState.IDLE),
) : BackgroundSyncStatusStore {
    private var value = initial
    override fun read(): BackgroundSyncStatus = value
    override fun write(status: BackgroundSyncStatus) {
        value = status
    }
}

private class RecordingWorkBackend : BackgroundSyncWorkBackend {
    var immediate = 0
    var keptImmediate = 0
    var replacedImmediate = 0
    var freshImmediate = 0
    var freshDelayMillis = -1L
    var periodic = 0
    override fun enqueueImmediateNetworkWork() {
        immediate += 1
    }
    override fun replaceImmediateNetworkWork() {
        replacedImmediate += 1
    }
    override fun keepImmediateNetworkWork() {
        keptImmediate += 1
    }
    override fun enqueueFreshImmediateNetworkWork(initialDelayMillis: Long) {
        freshImmediate += 1
        freshDelayMillis = initialDelayMillis
    }
    override fun ensurePeriodicNetworkWork() {
        periodic += 1
    }
}
