package com.xingshu.nexa.mobile.domain.notification

data class NotificationCaptureSettings(
    val id: Int = SINGLETON_ID,
    val globalEnabled: Boolean,
    val updatedAt: Long,
) {
    init {
        require(id == SINGLETON_ID) { "Notification capture settings id must be $SINGLETON_ID" }
        require(updatedAt >= 0L) { "updatedAt must not be negative" }
    }

    companion object {
        const val SINGLETON_ID = 1
    }
}

class NotificationPolicySnapshot(
    val globalEnabled: Boolean,
    appPolicies: Map<String, NotificationUserPolicy>,
    sourcePolicies: Map<NotificationSourceIdentity, NotificationUserPolicy>,
) {
    val appPolicies: Map<String, NotificationUserPolicy> = appPolicies.toMap()
    val sourcePolicies: Map<NotificationSourceIdentity, NotificationUserPolicy> =
        sourcePolicies.toMap()

    init {
        require(appPolicies.keys.all(String::isNotBlank)) {
            "app policy package names must be non-blank"
        }
        require(sourcePolicies.keys.none { it.sourceScope == NotificationSourceScope.APP }) {
            "sourcePolicies must contain only CHANNEL or NULL_CHANNEL identities"
        }
    }

    fun appPolicy(packageName: String): NotificationUserPolicy =
        appPolicies[packageName] ?: NotificationUserPolicy.INHERIT

    fun sourcePolicy(identity: NotificationSourceIdentity): NotificationUserPolicy =
        sourcePolicies[identity] ?: NotificationUserPolicy.INHERIT
}

enum class NotificationCaptureDecision {
    ALLOW,
    BLOCK,
}

object NotificationCapturePolicyResolver {
    const val OWN_PACKAGE = "com.xingshu.nexa.mobile"

    fun resolve(
        snapshot: NotificationPolicySnapshot,
        identity: NotificationSourceIdentity,
    ): NotificationCaptureDecision {
        if (identity.packageName == OWN_PACKAGE) return NotificationCaptureDecision.BLOCK
        if (!snapshot.globalEnabled) return NotificationCaptureDecision.BLOCK

        val appPolicy = snapshot.appPolicy(identity.packageName)
        if (appPolicy == NotificationUserPolicy.BLOCK) return NotificationCaptureDecision.BLOCK

        val sourcePolicy = if (identity.sourceScope == NotificationSourceScope.APP) {
            NotificationUserPolicy.INHERIT
        } else {
            snapshot.sourcePolicy(identity)
        }
        if (sourcePolicy == NotificationUserPolicy.BLOCK) return NotificationCaptureDecision.BLOCK
        if (sourcePolicy == NotificationUserPolicy.ALLOW) return NotificationCaptureDecision.ALLOW
        if (appPolicy == NotificationUserPolicy.ALLOW) return NotificationCaptureDecision.ALLOW
        return NotificationCaptureDecision.ALLOW
    }
}
