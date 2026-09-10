package com.xingshu.nexa.mobile.capture.parser

class WeChatNotificationParser(
    allowedPackages: Set<String>,
) : DeterministicKeywordNotificationParser(
    parserId = "wechat-notification-v1",
    parserVersion = "wechat-generic-1",
    paymentChannel = "WECHAT_NOTIFICATION",
    sourcePolicy = NotificationSourcePolicy(allowedPackages),
    rules = TransactionSignalRules(
        refund = setOf("退款到账", "退款成功", "已退款", "退款"),
        transferOut = setOf("转账支出", "转出成功", "已转出"),
        transferIn = setOf("收到转账", "转账收入", "转入成功"),
        collection = setOf("微信收款", "收款到账", "收款成功", "已收款"),
        payment = setOf("微信支付", "付款成功", "支付成功", "已付款"),
    ),
)
