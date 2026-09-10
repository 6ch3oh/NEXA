package com.xingshu.nexa.mobile.domain.notification

import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationSensitivityClassifierTest {
    @Test fun otpAndPasswordResetCodesAreRestricted() {
        assertEquals(NotificationSensitivity.RESTRICTED, NotificationSensitivityClassifier.classify("验证码 123456"))
        assertEquals(NotificationSensitivity.RESTRICTED, NotificationSensitivityClassifier.classify("Password reset code: 876543"))
    }

    @Test fun ordinaryPaymentNotificationRemainsNormal() {
        assertEquals(NotificationSensitivity.NORMAL, NotificationSensitivityClassifier.classify("支付成功 42.80 元"))
    }
}
