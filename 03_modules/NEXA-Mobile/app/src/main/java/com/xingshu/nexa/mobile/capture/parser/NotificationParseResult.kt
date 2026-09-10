package com.xingshu.nexa.mobile.capture.parser

sealed interface NotificationParseResult {
    data class Parsed(val draft: ParsedTransactionDraft) : NotificationParseResult

    data class Ignored(val reasonCode: ParserReasonCode) : NotificationParseResult {
        init {
            require(reasonCode.isIgnored) { "Ignored requires an ignored parser reason code" }
        }
    }

    data class Failed(
        val errorCode: ParserReasonCode,
        val retryable: Boolean = false,
    ) : NotificationParseResult {
        init {
            require(errorCode.isFailed) { "Failed requires a failed parser reason code" }
            require(!retryable) { "Deterministic parser failures are never retryable" }
        }
    }
}
