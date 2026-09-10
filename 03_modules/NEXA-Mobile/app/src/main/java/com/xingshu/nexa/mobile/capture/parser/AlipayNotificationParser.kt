package com.xingshu.nexa.mobile.capture.parser

class AlipayNotificationParser(
    allowedPackages: Set<String>,
) : DeterministicKeywordNotificationParser(
    parserId = "alipay-notification-v1",
    parserVersion = "alipay-generic-2",
    paymentChannel = "ALIPAY_NOTIFICATION",
    sourcePolicy = NotificationSourcePolicy(allowedPackages),
    rules = TransactionSignalRules(
        refund = setOf("退款到账", "退款成功", "已退款", "退款"),
        transferOut = setOf("转账支出", "转出成功", "已转出", "支出"),
        transferIn = setOf("收到转账", "转账收入", "转入成功", "收入"),
        collection = setOf("支付宝收款", "收款到账", "收款成功", "已收款"),
        payment = setOf("支付宝付款", "付款成功", "支付成功", "已付款", "扣款"),
    ),
)
