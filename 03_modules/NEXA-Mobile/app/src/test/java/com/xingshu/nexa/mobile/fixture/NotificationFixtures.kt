package com.xingshu.nexa.mobile.fixture

import com.xingshu.nexa.mobile.capture.notification.NotificationSnapshot
import com.xingshu.nexa.mobile.capture.parser.NotificationEventFingerprint
import com.xingshu.nexa.mobile.domain.notification.RawNotificationEvent

object NotificationFixtures {
    const val WECHAT_PACKAGE = "com.example.fixture.wechat"
    const val ALIPAY_PACKAGE = "com.example.fixture.alipay"
    const val BANK_PACKAGE = "com.example.fixture.bank"
    const val UNSUPPORTED_PACKAGE = "com.example.fixture.unsupported"

    private const val POSTED_AT = 1_700_000_000_000L
    private const val CAPTURED_AT = 1_700_000_000_100L

    val wechatPaymentSuccess = snapshot(
        sourcePackage = WECHAT_PACKAGE,
        notificationKey = "wechat-payment-key",
        title = "微信支付",
        body = "付款成功；付款金额 ￥12.34；商户：虚构咖啡店；交易号 WX_FIXTURE_001",
    )
    val wechatCollection = snapshot(
        sourcePackage = WECHAT_PACKAGE,
        notificationKey = "wechat-collection-key",
        title = "微信收款",
        body = "收款到账，收款金额 20.00元",
    )
    val alipayPaymentSuccess = snapshot(
        sourcePackage = ALIPAY_PACKAGE,
        notificationKey = "alipay-payment-key",
        title = "支付宝付款",
        body = "支付成功；支付金额 RMB 56.78；订单号 ALI_FIXTURE_001",
    )
    val alipayCollection = snapshot(
        sourcePackage = ALIPAY_PACKAGE,
        notificationKey = "alipay-collection-key",
        title = "支付宝收款",
        body = "收款成功；到账金额 CNY 88.00",
    )
    val alipayDebit = snapshot(
        sourcePackage = ALIPAY_PACKAGE,
        notificationKey = "alipay-debit-key",
        title = "支付宝通知",
        body = "账户扣款；金额 ￥23.45；交易号 ALI_DEBIT_FIXTURE_001",
    )
    val alipayExpense = snapshot(
        sourcePackage = ALIPAY_PACKAGE,
        notificationKey = "alipay-expense-key",
        title = "支付宝通知",
        body = "账户支出；金额 ￥12.80；交易号 ALI_OUT_FIXTURE_001",
    )
    val alipayIncome = snapshot(
        sourcePackage = ALIPAY_PACKAGE,
        notificationKey = "alipay-income-key",
        title = "支付宝通知",
        body = "账户收入；金额 ￥66.00；交易号 ALI_IN_FIXTURE_001",
    )
    val bankCardSpend = snapshot(
        sourcePackage = BANK_PACKAGE,
        notificationKey = "bank-spend-key",
        title = "虚构银行消费提醒",
        body = "消费成功；消费金额 ¥20.00；可用余额 ¥9,999.00；卡号 ****5678；" +
            "商户：虚构便利店；流水号 BANK_FIXTURE_001",
    )
    val bankExpense = snapshot(
        sourcePackage = BANK_PACKAGE,
        notificationKey = "bank-expense-key",
        title = "虚构银行通知",
        body = "账户支出；金额 ¥31.25；卡号尾号 2468；流水号 BANK_OUT_FIXTURE_001",
    )
    val bankIncome = snapshot(
        sourcePackage = BANK_PACKAGE,
        notificationKey = "bank-income-key",
        title = "虚构银行通知",
        body = "账户收入；金额 ¥42.50；卡号尾号 2468；流水号 BANK_IN_FIXTURE_001",
    )
    val refund = snapshot(
        sourcePackage = WECHAT_PACKAGE,
        notificationKey = "refund-key",
        title = "退款到账",
        body = "退款成功；退款金额 ¥6.66；交易号 REFUND_FIXTURE_001",
    )
    val duplicateNotification = wechatPaymentSuccess.copy(capturedAt = CAPTURED_AT + 500L)
    val missingAmount = snapshot(
        sourcePackage = WECHAT_PACKAGE,
        notificationKey = "missing-amount-key",
        title = "微信支付",
        body = "付款成功，但通知未提供金额",
    )
    val multiAmount = snapshot(
        sourcePackage = WECHAT_PACKAGE,
        notificationKey = "multi-amount-key",
        title = "微信支付",
        body = "付款成功；付款金额 ¥12.34；交易金额 ¥56.78",
    )
    val unsupportedPackage = snapshot(
        sourcePackage = UNSUPPORTED_PACKAGE,
        notificationKey = "unsupported-key",
        title = "付款成功",
        body = "付款金额 ¥12.34",
    )
    val emptyTitle = snapshot(
        sourcePackage = WECHAT_PACKAGE,
        notificationKey = "empty-title-key",
        title = null,
        body = "付款成功；付款金额 ¥12.34",
    )
    val emptyBody = snapshot(
        sourcePackage = WECHAT_PACKAGE,
        notificationKey = "empty-body-key",
        title = "微信支付",
        body = null,
        rawText = "付款成功；付款金额 ¥12.34",
    )
    val multilineText = snapshot(
        sourcePackage = WECHAT_PACKAGE,
        notificationKey = "multiline-key",
        title = " 微信支付\u00A0",
        body = "付款成功\r\n付款金额\u00A0￥１２．３４",
        rawText = "付款成功\n付款金额 ￥12.34",
    )
    val sameTextDifferentTransaction = wechatPaymentSuccess.copy(
        notificationKey = "wechat-payment-key-2",
        postedAt = POSTED_AT + 1L,
        capturedAt = CAPTURED_AT + 1L,
    )
    val parserUpgradeSameIdentity = wechatPaymentSuccess.copy(capturedAt = CAPTURED_AT + 1_000L)

    val all: Map<String, NotificationSnapshot> = linkedMapOf(
        "wechat_payment_success" to wechatPaymentSuccess,
        "wechat_collection" to wechatCollection,
        "alipay_payment_success" to alipayPaymentSuccess,
        "alipay_collection" to alipayCollection,
        "alipay_debit" to alipayDebit,
        "alipay_expense" to alipayExpense,
        "alipay_income" to alipayIncome,
        "bank_card_spend" to bankCardSpend,
        "bank_expense" to bankExpense,
        "bank_income" to bankIncome,
        "refund" to refund,
        "duplicate_notification" to duplicateNotification,
        "missing_amount" to missingAmount,
        "multi_amount" to multiAmount,
        "unsupported_package" to unsupportedPackage,
        "empty_title" to emptyTitle,
        "empty_body" to emptyBody,
        "multiline_text" to multilineText,
        "same_text_different_transaction" to sameTextDifferentTransaction,
        "parser_upgrade_same_identity" to parserUpgradeSameIdentity,
    )

    fun raw(
        fixtureId: String,
        parserVersion: String? = null,
        capturedAt: Long? = null,
    ): RawNotificationEvent {
        val snapshot = requireNotNull(all[fixtureId]) { "Unknown fixture: $fixtureId" }
        return RawNotificationEvent(
            eventId = "event-$fixtureId",
            sourcePackage = snapshot.sourcePackage,
            sourceChannel = snapshot.sourceChannel,
            notificationKey = snapshot.notificationKey,
            title = snapshot.title,
            body = snapshot.body,
            rawText = snapshot.rawText,
            postedAt = snapshot.postedAt,
            capturedAt = capturedAt ?: snapshot.capturedAt,
            eventFingerprint = NotificationEventFingerprint.calculate(snapshot),
            parserVersion = parserVersion,
        )
    }

    private fun snapshot(
        sourcePackage: String,
        notificationKey: String,
        title: String?,
        body: String?,
        rawText: String = "",
    ): NotificationSnapshot = NotificationSnapshot(
        sourcePackage = sourcePackage,
        sourceChannel = "notification",
        notificationKey = notificationKey,
        title = title,
        body = body,
        rawText = rawText,
        postedAt = POSTED_AT,
        capturedAt = CAPTURED_AT,
    )
}
