package com.xingshu.nexa.mobile.capture.parser

import java.math.BigDecimal

object AmountParser {
    private val leadingSignedCurrency = Regex(
        "([-+])\\s*(?:¥|￥|RMB\\s*|CNY\\s*)(\\d[\\d,]*(?:\\.\\d+)?)(?![\\d,.])",
        RegexOption.IGNORE_CASE,
    )
    private val prefixCurrency = Regex(
        "(?:¥|￥|RMB\\s*|CNY\\s*)([-+]?\\d[\\d,]*(?:\\.\\d+)?)(?![\\d,.])",
        RegexOption.IGNORE_CASE,
    )
    private val suffixCurrency = Regex("([-+]?\\d[\\d,]*(?:\\.\\d+)?)\\s*元")
    private val labeledAmount = Regex(
        "(?:消费金额|付款金额|支付金额|收款金额|退款金额|转账金额|交易金额|实付金额|到账金额|金额)" +
            "\\s*:?\\s*([-+]?\\d[\\d,]*(?:\\.\\d+)?)(?![\\d,.])",
    )
    private val excludedLabels = listOf("账户余额", "可用余额", "余额", "信用额度", "可用额度")
    private val plainInteger = Regex("\\d+")
    private val groupedInteger = Regex("\\d{1,3}(?:,\\d{3})+")

    fun parse(text: String): AmountParseResult {
        val candidates = linkedMapOf<IntRange, String>()
        leadingSignedCurrency.findAll(text).forEach { match ->
            val sign = match.groups[1] ?: return@forEach
            val number = match.groups[2] ?: return@forEach
            if (!isExcludedByContext(text, number.range)) {
                candidates.putIfAbsent(number.range, sign.value + number.value)
            }
        }
        sequenceOf(prefixCurrency, suffixCurrency, labeledAmount)
            .flatMap { pattern -> pattern.findAll(text) }
            .forEach { match ->
                val group = match.groups[1] ?: return@forEach
                if (!isExcludedByContext(text, group.range)) {
                    candidates.putIfAbsent(group.range, group.value)
                }
            }
        if (candidates.isEmpty()) {
            return AmountParseResult.Failed(ParserReasonCode.AMOUNT_MISSING)
        }

        val parsed = mutableListOf<AmountParseResult.Parsed>()
        candidates.values.forEach { candidate ->
            val value = parseCandidate(candidate)
                ?: return AmountParseResult.Failed(ParserReasonCode.AMOUNT_INVALID)
            parsed += value
        }
        val distinctAmounts = parsed.map(AmountParseResult.Parsed::amountMinor).distinct()
        if (distinctAmounts.size > 1) {
            return AmountParseResult.Failed(ParserReasonCode.AMOUNT_AMBIGUOUS)
        }
        return AmountParseResult.Parsed(
            amountMinor = distinctAmounts.single(),
            hadNegativeSign = parsed.any(AmountParseResult.Parsed::hadNegativeSign),
        )
    }

    private fun isExcludedByContext(text: String, range: IntRange): Boolean {
        val contextStart = (range.first - CONTEXT_LOOKBEHIND).coerceAtLeast(0)
        val prefix = text.substring(contextStart, range.first)
        return excludedLabels.any(prefix::contains)
    }

    private fun parseCandidate(candidate: String): AmountParseResult.Parsed? {
        val negative = candidate.startsWith('-')
        val unsigned = candidate.removePrefix("+").removePrefix("-")
        val parts = unsigned.split('.')
        if (parts.size > 2) return null
        val integer = parts.first()
        if (!plainInteger.matches(integer) && !groupedInteger.matches(integer)) return null
        val fraction = parts.getOrNull(1)
        if (fraction != null && (fraction.isEmpty() || fraction.length > 2 || !plainInteger.matches(fraction))) {
            return null
        }
        val decimal = try {
            BigDecimal(unsigned.replace(",", ""))
        } catch (_: NumberFormatException) {
            return null
        }
        if (decimal.scale() !in 0..2 || decimal.signum() == 0) return null
        val amountMinor = try {
            decimal.movePointRight(2).longValueExact()
        } catch (_: ArithmeticException) {
            return null
        }
        return AmountParseResult.Parsed(
            amountMinor = amountMinor,
            hadNegativeSign = negative,
        )
    }

    private const val CONTEXT_LOOKBEHIND = 16
}
