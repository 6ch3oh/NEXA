package com.xingshu.nexa.mobile.ui.product

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.core.app.NotificationManagerCompat
import com.xingshu.nexa.mobile.capture.notification.NotificationListenerHealthStore
import com.xingshu.nexa.mobile.data.sync.diagnostics.AndroidSyncDiagnosticsSource
import com.xingshu.nexa.mobile.data.product.AndroidCoreGatewayClient
import java.io.IOException
import java.time.LocalDate
import java.time.YearMonth
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

data class MobileProductUiState(
    val loading: Boolean = false,
    val pcState: String = "待连接",
    val aiState: String = "待检查",
    val aiDiagnostic: String? = null,
    val syncState: String = "待同步",
    val trusted: Boolean = false,
    val ackedNotifications: Long = 0,
    val aiPendingClassification: Long = 0,
    val autoPostedCount: Long = 0,
    val notificationPermission: String = "待检查",
    val listenerStatus: String = "待检查",
    val pendingUpload: Int = 0,
    val lastSyncAt: Long? = null,
    val calendarDate: String = LocalDate.now().toString(),
    val calendarLines: List<String> = emptyList(),
    val billsRange: String = "本月",
    val billLines: List<String> = emptyList(),
    val draftIds: List<String> = emptyList(),
    val draftLines: List<String> = emptyList(),
    val proposalId: String? = null,
    val proposalSummary: String? = null,
    val proposalChanges: List<String> = emptyList(),
    val proposalConflicts: List<String> = emptyList(),
    val proposalHighRisk: Boolean = false,
    val highRiskArmed: Boolean = false,
    val clarification: String? = null,
    val commandResult: String? = null,
    val revision: Long = 0L,
    val errorCode: String? = null,
)

class MobileProductViewModel internal constructor(
    private val client: AndroidCoreGatewayClient,
    private val readLocalStatus: suspend () -> LocalMobileLedgerStatus = { LocalMobileLedgerStatus() },
) : ViewModel() {
    private val mutableUiState = MutableStateFlow(MobileProductUiState())
    val uiState: StateFlow<MobileProductUiState> = mutableUiState.asStateFlow()

    fun refreshStatus() = launchRequest(showLoading = false) {
        val local = readLocalStatus()
        mutableUiState.value = mutableUiState.value.copy(
            notificationPermission = if (local.notificationPermissionGranted) "已授权" else "未授权",
            listenerStatus = local.listenerStatus,
            pendingUpload = local.pendingUpload,
            lastSyncAt = local.lastSyncAt,
        )
        val response = client.product("status")
        val value = response.optJSONObject("value") ?: JSONObject()
        val aiValue = value.optJSONObject("ai") ?: JSONObject()
        val ai = mobileAiProductLabel(
            runtimeState = aiValue.optString("runtime_state"),
            legacyStatus = aiValue.optString("status"),
        )
        val aiDiagnostic = aiValue.optString("diagnostic_code")
            .takeIf(String::isNotBlank)
        val notifications = value.optJSONObject("notifications") ?: JSONObject()
        mutableUiState.value = mutableUiState.value.copy(
            pcState = value.optString("pc", "READY"),
            aiState = ai,
            aiDiagnostic = aiDiagnostic,
            syncState = value.optString("sync", "AUTHENTICATED"),
            trusted = value.optBoolean("trusted", false),
            ackedNotifications = notifications.optLong("acked_notification_count", 0),
            aiPendingClassification = notifications.optLong("pending_notification_classification_count", 0),
            autoPostedCount = notifications.optLong("auto_posted_count", 0),
            notificationPermission = if (local.notificationPermissionGranted) "已授权" else "未授权",
            listenerStatus = local.listenerStatus,
            pendingUpload = local.pendingUpload,
            lastSyncAt = local.lastSyncAt,
            revision = response.optLong("revision", mutableUiState.value.revision),
        )
    }

    fun refreshCalendar(date: LocalDate) = launchRequest {
        val month = YearMonth.from(date)
        client.product(
            "calendar.month",
            JSONObject().put("start_date", month.atDay(1).toString())
                .put("end_date", month.atEndOfMonth().toString()),
        )
        val response = client.product("calendar.day", JSONObject().put("date", date.toString()))
        markGatewayConnected()
        val value = response.optJSONObject("value") ?: JSONObject()
        val lines = buildList {
            addAll(projectArray(value.optJSONArray("events"), "日程"))
            addAll(projectArray(value.optJSONArray("tasks"), "任务"))
            addAll(projectArray(value.optJSONArray("timeline"), "时间线"))
        }.distinct()
        mutableUiState.value = mutableUiState.value.copy(
            calendarDate = date.toString(),
            calendarLines = lines,
            revision = response.optLong("revision", mutableUiState.value.revision),
        )
    }

    fun refreshBills(range: String, customStart: String? = null, customEnd: String? = null) = launchRequest {
        val (start, end) = if (range == "自定义") {
            val parsedStart = LocalDate.parse(requireNotNull(customStart) { "CUSTOM_START_REQUIRED" })
            val parsedEnd = LocalDate.parse(requireNotNull(customEnd) { "CUSTOM_END_REQUIRED" })
            require(!parsedEnd.isBefore(parsedStart)) { "CUSTOM_RANGE_INVALID" }
            parsedStart to parsedEnd
        } else rangeDates(range)
        val filters = JSONObject().put("startDate", start.toString()).put("endDate", end.toString())
        val options = JSONObject(filters.toString()).put("limit", 50)
        val recordsResponse = client.product("bills.query", JSONObject().put("options", options))
        val statisticsResponse = client.product("bills.statistics", JSONObject().put("filters", filters))
        val draftsResponse = client.product("bills.drafts", JSONObject().put("options", JSONObject()))
        markGatewayConnected()
        val records = recordsResponse.optJSONArray("value") ?: JSONArray()
        val drafts = draftsResponse.optJSONArray("value") ?: JSONArray()
        val lines = buildList {
            add("统计：${compactObject(statisticsResponse.opt("value"))}")
            for (index in 0 until minOf(records.length(), 12)) {
                add(compactObject(records.opt(index)))
            }
        }
        mutableUiState.value = mutableUiState.value.copy(
            billsRange = range,
            billLines = lines,
            draftIds = (0 until drafts.length()).mapNotNull { drafts.optJSONObject(it)?.optString("draftId")?.takeIf(String::isNotBlank) },
            draftLines = (0 until drafts.length()).map { compactObject(drafts.opt(it)) },
            revision = draftsResponse.optLong("revision", mutableUiState.value.revision),
        )
    }

    fun actOnDraft(action: String, draftId: String, changeValue: String? = null) = launchRequest {
        val operation = when (action) {
            "confirm" -> "bills.confirm-draft"
            "ignore" -> "bills.ignore-draft"
            "edit-category" -> "bills.update-draft"
            else -> return@launchRequest
        }
        val payload = JSONObject().put("draft_id", draftId)
        if (action == "edit-category") {
            payload.put("changes", JSONObject().put("category", requireNotNull(changeValue).trim()))
        }
        client.product(operation, payload)
        mutableUiState.value = mutableUiState.value.copy(
            commandResult = "草稿操作已提交；按 revision 与 PC 权威对账",
            draftIds = if (action == "edit-category") mutableUiState.value.draftIds else mutableUiState.value.draftIds.filterNot { it == draftId },
        )
    }

    fun submitCommand(input: String) = launchRequest {
        val response = client.product("global-command.submit", JSONObject().put("request", input.take(1000)))
        markGatewayConnected()
        val value = response.optJSONObject("value") ?: JSONObject()
        val succeeded = value.optBoolean("ok", false)
        val proposal = value.optJSONObject("proposal") ?: JSONObject()
        val plan = value.optJSONObject("plan") ?: JSONObject()
        val outcome = value.optJSONObject("outcome") ?: JSONObject()
        val pendingConfirmation = value.optString("status") == "pending_confirmation"
        val planChanges = planCapabilityLabels(plan)
        mutableUiState.value = mutableUiState.value.copy(
            proposalId = value.optString("proposal_id").takeIf { pendingConfirmation && it.isNotBlank() },
            proposalSummary = plan.optString("confirmation_summary").takeIf(String::isNotBlank)
                ?: plan.optString("intent").takeIf(String::isNotBlank)
                ?: proposal.optString("intent").takeIf(String::isNotBlank),
            proposalChanges = planChanges.ifEmpty { listOfNotNull(
                proposal.optString("domain").takeIf(String::isNotBlank),
                proposal.optString("action").takeIf(String::isNotBlank),
            ) },
            proposalConflicts = emptyList(),
            proposalHighRisk = proposal.optJSONObject("capability")?.optString("classification") == "high_risk" || planHasHighRiskStep(plan),
            highRiskArmed = false,
            clarification = outcome.optString("question").takeIf(String::isNotBlank),
            commandResult = if (!succeeded) {
                value.optString("message").ifBlank { "本地 AI 暂不可用，请稍后重试。" }
            } else if (value.optString("status") == "completed") {
                val routeId = navigationRoute(outcome)
                if (routeId != null) {
                    "已打开${mobileRouteLabel(routeId)}"
                } else if (outcome.optString("type") == "plan_result") {
                    "命令已完成 · ${outcome.optJSONArray("steps")?.length() ?: 0} 步"
                } else {
                    compactObject(outcome.opt("value"))
                }
            } else null,
            errorCode = if (succeeded) null else value.optString("reason_code")
                .ifBlank { value.optString("code") }
                .takeIf(String::isNotBlank),
            revision = response.optLong("revision", mutableUiState.value.revision),
        )
    }

    fun confirmProposal() = launchRequest {
        val proposalId = mutableUiState.value.proposalId ?: return@launchRequest
        if (mutableUiState.value.proposalHighRisk && !mutableUiState.value.highRiskArmed) {
            mutableUiState.value = mutableUiState.value.copy(
                highRiskArmed = true,
                commandResult = "高风险操作：请再次点击确认；取消不会写入",
            )
            return@launchRequest
        }
        val response = client.product(
            "global-command.confirm",
            JSONObject().put("proposal_id", proposalId).put("confirmed", true)
                .put("high_risk_confirmed", mutableUiState.value.highRiskArmed),
        )
        val queued = response.optJSONObject("value")?.optString("status") == "queued_offline"
        if (!queued) markGatewayConnected()
        mutableUiState.value = mutableUiState.value.copy(
            proposalId = null,
            highRiskArmed = false,
            commandResult = if (queued) "已进入加密离线队列；重连后由 PC 权威执行"
                else "已由 PC 权威确认：${compactObject(response.opt("value"))}",
            revision = response.optLong("revision", mutableUiState.value.revision),
        )
    }

    fun cancelProposal() = launchRequest {
        val proposalId = mutableUiState.value.proposalId ?: return@launchRequest
        client.product("global-command.cancel", JSONObject().put("proposal_id", proposalId))
        mutableUiState.value = mutableUiState.value.copy(
            proposalId = null, proposalSummary = null, proposalChanges = emptyList(),
            proposalConflicts = emptyList(), clarification = null, commandResult = "Proposal 已取消",
            highRiskArmed = false,
        )
    }

    private fun launchRequest(showLoading: Boolean = true, block: suspend () -> Unit) {
        if (mutableUiState.value.loading) return
        if (showLoading) mutableUiState.value = mutableUiState.value.copy(loading = true, errorCode = null)
        viewModelScope.launch {
            runCatching { block() }
                .onSuccess {
                    if (showLoading) mutableUiState.value = mutableUiState.value.copy(loading = false)
                }
                .onFailure { error ->
                    mutableUiState.value = productRequestFailureState(
                        current = mutableUiState.value,
                        connectivityFailure = error is IOException,
                        errorCode = error.message?.take(120) ?: "CORE_GATEWAY_FAILED",
                    )
                }
        }
    }

    private fun markGatewayConnected() {
        mutableUiState.value = productRequestSuccessState(mutableUiState.value)
    }

    private fun rangeDates(range: String): Pair<LocalDate, LocalDate> {
        val today = LocalDate.now()
        return when (range) {
            "今日" -> today to today
            "本周" -> today.minusDays((today.dayOfWeek.value - 1).toLong()) to today.plusDays((7 - today.dayOfWeek.value).toLong())
            "本年" -> today.withDayOfYear(1) to today.withDayOfYear(today.lengthOfYear())
            else -> YearMonth.from(today).atDay(1) to YearMonth.from(today).atEndOfMonth()
        }
    }
}

internal fun mobileAiProductLabel(runtimeState: String?, legacyStatus: String?): String = when (runtimeState) {
    "AI_READY" -> "就绪"
    "AI_STARTING" -> "启动中"
    "" , null -> when (legacyStatus) {
        "ready" -> "就绪"
        "checking", "not_checked" -> "启动中"
        else -> "暂不可用"
    }
    else -> "暂不可用"
}

internal fun mobileRouteLabel(routeId: String): String = when (routeId) {
    "home" -> "首页"
    "cost" -> "消费中心"
    "calendar" -> "日历管家"
    "automation-center" -> "自动化中心"
    "study-center" -> "学习中心"
    "device-center" -> "设备与网络"
    "market" -> "股票市场"
    "creator-ops" -> "自媒体运营"
    "dashi" -> "Dashi任务板"
    "starbench" -> "StarBench"
    "settings" -> "设置"
    else -> routeId
}

internal fun productRequestSuccessState(current: MobileProductUiState): MobileProductUiState =
    current.copy(
        pcState = "READY",
        syncState = "AUTHENTICATED",
        trusted = true,
        errorCode = null,
    )

internal fun productRequestFailureState(
    current: MobileProductUiState,
    connectivityFailure: Boolean,
    errorCode: String,
): MobileProductUiState = current.copy(
    loading = false,
    pcState = if (connectivityFailure) "离线" else current.pcState,
    errorCode = errorCode,
)

class MobileProductViewModelFactory(context: Context) : ViewModelProvider.Factory {
    private val applicationContext = context.applicationContext
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        require(modelClass.isAssignableFrom(MobileProductViewModel::class.java))
        @Suppress("UNCHECKED_CAST")
        return MobileProductViewModel(
            AndroidCoreGatewayClient(applicationContext),
            readLocalStatus = {
                val facts = AndroidSyncDiagnosticsSource(applicationContext).observe().first()
                LocalMobileLedgerStatus(
                    notificationPermissionGranted = applicationContext.packageName in
                        NotificationManagerCompat.getEnabledListenerPackages(applicationContext),
                    listenerStatus = NotificationListenerHealthStore.state.value.name,
                    pendingUpload = facts.queue.pendingCount + facts.queue.runningCount + facts.queue.retryPendingCount,
                    lastSyncAt = facts.queue.lastSuccessAt,
                )
            },
        ) as T
    }
}

internal data class LocalMobileLedgerStatus(
    val notificationPermissionGranted: Boolean = false,
    val listenerStatus: String = "UNAVAILABLE",
    val pendingUpload: Int = 0,
    val lastSyncAt: Long? = null,
)

private fun projectArray(array: JSONArray?, prefix: String): List<String> = buildList {
    if (array == null) return@buildList
    for (index in 0 until minOf(array.length(), 20)) add("$prefix · ${compactObject(array.opt(index))}")
}

private fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else
    (0 until length()).mapNotNull { optString(it).takeIf(String::isNotBlank) }

private fun planCapabilityLabels(plan: JSONObject): List<String> {
    val steps = plan.optJSONArray("steps") ?: return emptyList()
    return (0 until minOf(steps.length(), 6)).mapNotNull { index ->
        steps.optJSONObject(index)?.optString("capability")?.takeIf(String::isNotBlank)
    }
}

private fun planHasHighRiskStep(plan: JSONObject): Boolean {
    val steps = plan.optJSONArray("steps") ?: return false
    return (0 until steps.length()).any { index ->
        steps.optJSONObject(index)?.optJSONObject("metadata")?.optString("risk_class") == "HIGH_RISK"
    }
}

private fun navigationRoute(outcome: JSONObject): String? {
    if (outcome.optString("type") == "navigation") return outcome.optString("route_id").takeIf(String::isNotBlank)
    if (outcome.optString("type") != "plan_result") return null
    val steps = outcome.optJSONArray("steps") ?: return null
    for (index in 0 until steps.length()) {
        val stepOutcome = steps.optJSONObject(index)?.optJSONObject("outcome") ?: continue
        if (stepOutcome.optString("type") == "navigation") return stepOutcome.optString("route_id").takeIf(String::isNotBlank)
    }
    return null
}

private fun compactObject(value: Any?): String = when (value) {
    is JSONObject -> listOf("title", "name", "merchant", "category", "amount", "amountCents", "direction", "occurredAt", "sourceReference", "change_summary", "status")
        .mapNotNull { key -> value.opt(key)?.takeIf { it != JSONObject.NULL && it.toString().isNotBlank() }?.let { "$key=$it" } }
        .takeIf(List<String>::isNotEmpty)?.joinToString(" · ") ?: value.toString().take(240)
    else -> value?.toString()?.take(240).orEmpty()
}
