package com.xingshu.nexa.mobile.capture.parser

enum class ParserReasonCode {
    UNSUPPORTED_SOURCE,
    NON_TRANSACTION_NOTIFICATION,
    DUPLICATE_EVENT,
    UNSUPPORTED_FORMAT,
    AMOUNT_MISSING,
    AMOUNT_AMBIGUOUS,
    AMOUNT_INVALID,
    TRANSACTION_TYPE_AMBIGUOUS,
    REQUIRED_FIELD_MISSING,
    PARSER_INTERNAL_ERROR,
    ;

    val isIgnored: Boolean
        get() = this in IGNORED_CODES

    val isFailed: Boolean
        get() = this in FAILED_CODES

    companion object {
        val IGNORED_CODES: Set<ParserReasonCode> = setOf(
            UNSUPPORTED_SOURCE,
            NON_TRANSACTION_NOTIFICATION,
            DUPLICATE_EVENT,
            UNSUPPORTED_FORMAT,
        )
        val FAILED_CODES: Set<ParserReasonCode> = setOf(
            AMOUNT_MISSING,
            AMOUNT_AMBIGUOUS,
            AMOUNT_INVALID,
            TRANSACTION_TYPE_AMBIGUOUS,
            REQUIRED_FIELD_MISSING,
            PARSER_INTERNAL_ERROR,
        )
    }
}
