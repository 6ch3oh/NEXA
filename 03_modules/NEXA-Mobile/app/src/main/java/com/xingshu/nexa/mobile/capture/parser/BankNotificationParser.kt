package com.xingshu.nexa.mobile.capture.parser

class BankNotificationParser(
    allowedPackages: Set<String>,
) : DeterministicKeywordNotificationParser(
    parserId = "bank-notification-v1",
    parserVersion = "bank-boundary-2",
    paymentChannel = "BANK_NOTIFICATION",
    sourcePolicy = NotificationSourcePolicy(allowedPackages),
    rules = TransactionSignalRules(
        refund = setOf("退款到账", "退款成功", "退款"),
        transferOut = setOf("转账支出", "转出", "汇出", "支出"),
        transferIn = setOf("转账收入", "转入", "汇入", "收到转账", "收入"),
        collection = emptySet(),
        payment = setOf("消费金额", "消费成功", "消费", "扣款"),
        merchantLabels = setOf("商户", "商家"),
        counterpartyLabels = setOf("对方", "付款方", "收款方"),
    ),
) {
    override fun extractAccountHint(text: String): String? {
        MASKED_ACCOUNT.find(text)?.groups?.get(1)?.value?.let { return it }
        TAIL_ACCOUNT.find(text)?.groups?.get(1)?.value?.let { return "尾号$it" }
        return null
    }

    private companion object {
        val MASKED_ACCOUNT = Regex(
            "(?:卡号|账户|银行卡)\\s*:?\\s*([*•Xx]{2,}\\d{2,4})",
        )
        val TAIL_ACCOUNT = Regex("尾号\\s*:?\\s*(\\d{2,4})")
    }
}
