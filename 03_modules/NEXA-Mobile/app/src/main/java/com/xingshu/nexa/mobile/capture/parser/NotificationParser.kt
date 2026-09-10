package com.xingshu.nexa.mobile.capture.parser

import com.xingshu.nexa.mobile.domain.notification.RawNotificationEvent
import com.xingshu.nexa.mobile.domain.transaction.TransactionType

interface NotificationParser {
    val parserId: String
    val parserVersion: String

    fun supports(event: RawNotificationEvent): Boolean

    fun parse(event: RawNotificationEvent): NotificationParseResult
}

interface PackageRoutedNotificationParser : NotificationParser {
    val sourcePackages: Set<String>
}

internal data class TransactionSignalRules(
    val refund: Set<String>,
    val transferOut: Set<String>,
    val transferIn: Set<String>,
    val collection: Set<String>,
    val payment: Set<String>,
    val merchantLabels: Set<String> = setOf("商户", "商家"),
    val counterpartyLabels: Set<String> = setOf("对方", "付款方", "收款方"),
)

abstract class DeterministicKeywordNotificationParser internal constructor(
    final override val parserId: String,
    final override val parserVersion: String,
    private val paymentChannel: String,
    private val sourcePolicy: NotificationSourcePolicy,
    private val rules: TransactionSignalRules,
) : PackageRoutedNotificationParser {
    final override val sourcePackages: Set<String> = sourcePolicy.allowedPackages

    init {
        require(parserId.isNotBlank()) { "parserId must not be blank" }
        require(parserVersion.isNotBlank()) { "parserVersion must not be blank" }
        require(paymentChannel.isNotBlank()) { "paymentChannel must not be blank" }
    }

    final override fun supports(event: RawNotificationEvent): Boolean =
        sourcePolicy.isAllowed(event.sourcePackage)

    final override fun parse(event: RawNotificationEvent): NotificationParseResult {
        if (!supports(event)) {
            return NotificationParseResult.Ignored(ParserReasonCode.UNSUPPORTED_SOURCE)
        }
        return try {
            parseSupported(event)
        } catch (_: Exception) {
            NotificationParseResult.Failed(
                errorCode = ParserReasonCode.PARSER_INTERNAL_ERROR,
                retryable = false,
            )
        }
    }

    protected open fun extractAccountHint(text: String): String? = null

    private fun parseSupported(event: RawNotificationEvent): NotificationParseResult {
        val normalized = NotificationTextNormalizer.normalize(event)
        val text = normalized.mergedText
        if (text.isBlank()) {
            return NotificationParseResult.Ignored(ParserReasonCode.UNSUPPORTED_FORMAT)
        }

        val transactionType = when (val detection = detectTransactionType(text)) {
            TypeDetection.None -> {
                return NotificationParseResult.Ignored(ParserReasonCode.NON_TRANSACTION_NOTIFICATION)
            }
            TypeDetection.Ambiguous -> {
                return NotificationParseResult.Failed(ParserReasonCode.TRANSACTION_TYPE_AMBIGUOUS)
            }
            is TypeDetection.Resolved -> detection.type
        }

        val parsedAmount = when (val amount = AmountParser.parse(text)) {
            is AmountParseResult.Failed -> {
                return NotificationParseResult.Failed(amount.errorCode, retryable = false)
            }
            is AmountParseResult.Parsed -> amount
        }
        if (
            parsedAmount.hadNegativeSign &&
            transactionType in setOf(
                TransactionType.COLLECTION,
                TransactionType.TRANSFER_IN,
                TransactionType.REFUND,
            )
        ) {
            return NotificationParseResult.Failed(ParserReasonCode.TRANSACTION_TYPE_AMBIGUOUS)
        }

        val merchant = extractLabeledValue(text, rules.merchantLabels)
        val counterparty = extractLabeledValue(text, rules.counterpartyLabels)
        val reference = PROVIDER_REFERENCE.find(text)?.groups?.get(1)?.value
        val accountHint = extractAccountHint(text)
        val confidence = (
            VERIFIED_SOURCE_SCORE +
                UNIQUE_TYPE_SCORE +
                UNIQUE_AMOUNT_SCORE +
                (if (merchant != null || counterparty != null) PARTY_SCORE else 0) +
                (if (reference != null) REFERENCE_SCORE else 0)
            ).coerceIn(0, MAX_CONFIDENCE)
        if (confidence < PARSED_THRESHOLD) {
            return NotificationParseResult.Failed(ParserReasonCode.REQUIRED_FIELD_MISSING)
        }

        return NotificationParseResult.Parsed(
            ParsedTransactionDraft(
                transactionType = transactionType,
                amountMinor = parsedAmount.amountMinor,
                paymentChannel = paymentChannel,
                sourceEventId = event.eventId,
                confidence = confidence,
                parserVersion = parserVersion,
                merchant = merchant,
                counterparty = counterparty,
                accountHint = accountHint,
                transactionTime = null,
                rawReference = reference,
            ),
        )
    }

    private fun detectTransactionType(text: String): TypeDetection {
        if (text.containsAny(rules.refund)) {
            return TypeDetection.Resolved(TransactionType.REFUND)
        }
        val transferOut = text.containsAny(rules.transferOut)
        val transferIn = text.containsAny(rules.transferIn)
        if (transferOut && transferIn) return TypeDetection.Ambiguous
        if (transferOut) return TypeDetection.Resolved(TransactionType.TRANSFER_OUT)
        if (transferIn) return TypeDetection.Resolved(TransactionType.TRANSFER_IN)

        val collection = text.containsAny(rules.collection)
        val payment = text.containsAny(rules.payment)
        if (collection && payment) return TypeDetection.Ambiguous
        if (collection) return TypeDetection.Resolved(TransactionType.COLLECTION)
        if (payment) return TypeDetection.Resolved(TransactionType.PAYMENT)
        return TypeDetection.None
    }

    private fun extractLabeledValue(text: String, labels: Set<String>): String? {
        if (labels.isEmpty()) return null
        val labelPattern = labels.joinToString("|") { label -> Regex.escape(label) }
        return Regex("(?:$labelPattern)\\s*:\\s*([^,;\\n]{1,64})")
            .find(text)
            ?.groups
            ?.get(1)
            ?.value
            ?.trim()
            ?.takeIf(String::isNotEmpty)
    }

    private fun String.containsAny(keywords: Set<String>): Boolean =
        keywords.any { keyword -> contains(keyword) }

    private sealed interface TypeDetection {
        data object None : TypeDetection
        data object Ambiguous : TypeDetection
        data class Resolved(val type: TransactionType) : TypeDetection
    }

    private companion object {
        val PROVIDER_REFERENCE = Regex(
            "(?:交易号|订单号|流水号)\\s*:?\\s*([A-Za-z0-9_-]{6,64})",
        )
        const val VERIFIED_SOURCE_SCORE = 3_000
        const val UNIQUE_TYPE_SCORE = 2_500
        const val UNIQUE_AMOUNT_SCORE = 3_000
        const val PARTY_SCORE = 500
        const val REFERENCE_SCORE = 1_000
        const val PARSED_THRESHOLD = 8_500
        const val MAX_CONFIDENCE = 10_000
    }
}
