package com.xingshu.nexa.mobile.capture.parser

sealed interface AmountParseResult {
    data class Parsed(
        val amountMinor: Long,
        val hadNegativeSign: Boolean,
    ) : AmountParseResult {
        init {
            require(amountMinor > 0L) { "amountMinor must be positive" }
        }
    }

    data class Failed(val errorCode: ParserReasonCode) : AmountParseResult {
        init {
            require(errorCode in AMOUNT_ERROR_CODES) {
                "AmountParseResult.Failed requires an amount parser error code"
            }
        }
    }

    companion object {
        private val AMOUNT_ERROR_CODES = setOf(
            ParserReasonCode.AMOUNT_MISSING,
            ParserReasonCode.AMOUNT_AMBIGUOUS,
            ParserReasonCode.AMOUNT_INVALID,
        )
    }
}
