package com.xingshu.nexa.mobile.domain.transaction

data class ParsedTransaction(
    val transactionId: String,
    val transactionFingerprint: String,
    val transactionType: TransactionType,
    val amountMinor: Long,
    val paymentChannel: String,
    val sourceEventId: String,
    val confidence: Int,
    val parserVersion: String,
    val parsedAt: Long,
    val currency: String = DEFAULT_CURRENCY,
    val merchant: String? = null,
    val counterparty: String? = null,
    val accountHint: String? = null,
    val transactionTime: Long? = null,
    val rawReference: String? = null,
    val payloadVersion: Int = CURRENT_PAYLOAD_VERSION,
) {
    init {
        require(transactionId.isNotBlank()) { "transactionId must not be blank" }
        require(transactionFingerprint.isNotBlank()) {
            "transactionFingerprint must not be blank"
        }
        require(amountMinor > 0L) { "amountMinor must be positive" }
        require(CURRENCY_PATTERN.matches(currency)) {
            "currency must be a three-letter uppercase ISO 4217 code"
        }
        require(paymentChannel.isNotBlank()) { "paymentChannel must not be blank" }
        require(sourceEventId.isNotBlank()) { "sourceEventId must not be blank" }
        require(confidence in 0..MAX_CONFIDENCE) {
            "confidence must be in 0..$MAX_CONFIDENCE"
        }
        require(parserVersion.isNotBlank()) { "parserVersion must not be blank" }
        require(parsedAt >= 0L) { "parsedAt must not be negative" }
        require(transactionTime == null || transactionTime >= 0L) {
            "transactionTime must be null or non-negative"
        }
        require(merchant == null || merchant.isNotBlank()) {
            "merchant must be null or non-blank"
        }
        require(counterparty == null || counterparty.isNotBlank()) {
            "counterparty must be null or non-blank"
        }
        require(accountHint == null || accountHint.isNotBlank()) {
            "accountHint must be null or non-blank"
        }
        val accountDigitCount = accountHint?.count { it.isDigit() } ?: 0
        require(accountDigitCount !in FULL_ACCOUNT_DIGIT_RANGE) {
            "accountHint must not contain a full account number"
        }
        require(rawReference == null || rawReference.isNotBlank()) {
            "rawReference must be null or non-blank"
        }
        require(payloadVersion == CURRENT_PAYLOAD_VERSION) {
            "Unsupported payloadVersion: $payloadVersion"
        }
    }

    companion object {
        const val CURRENT_PAYLOAD_VERSION = 1
        const val DEFAULT_CURRENCY = "CNY"
        const val MAX_CONFIDENCE = 10_000
        private val CURRENCY_PATTERN = Regex("[A-Z]{3}")
        private val FULL_ACCOUNT_DIGIT_RANGE = 12..19
    }
}
