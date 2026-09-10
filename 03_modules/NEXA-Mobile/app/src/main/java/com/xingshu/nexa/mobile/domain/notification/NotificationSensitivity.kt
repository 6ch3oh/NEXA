package com.xingshu.nexa.mobile.domain.notification

enum class NotificationSensitivity { NORMAL, RESTRICTED }

object NotificationSensitivityClassifier {
    private val restrictedPatterns = listOf(
        Regex("(?:验证码|校验码|动态码|一次性密码|OTP)[^0-9]{0,12}[0-9]{4,8}", RegexOption.IGNORE_CASE),
        Regex("(?:password reset|reset code|verification code)[^0-9]{0,16}[0-9]{4,10}", RegexOption.IGNORE_CASE),
    )

    fun classify(vararg values: String?): NotificationSensitivity {
        val content = values.filterNotNull().joinToString("\n")
        return if (restrictedPatterns.any { it.containsMatchIn(content) }) {
            NotificationSensitivity.RESTRICTED
        } else {
            NotificationSensitivity.NORMAL
        }
    }
}
