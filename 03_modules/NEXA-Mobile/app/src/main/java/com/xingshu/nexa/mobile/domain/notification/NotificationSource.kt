package com.xingshu.nexa.mobile.domain.notification

data class NotificationSourceIdentity(
    val packageName: String,
    val sourceScope: NotificationSourceScope,
    val channelId: String,
) {
    init {
        require(packageName.isNotBlank()) { "packageName must not be blank" }
        when (sourceScope) {
            NotificationSourceScope.CHANNEL ->
                require(channelId.isNotBlank()) { "CHANNEL identity requires a channelId" }
            NotificationSourceScope.APP,
            NotificationSourceScope.NULL_CHANNEL ->
                require(channelId.isEmpty()) { "$sourceScope identity requires an empty channelId" }
        }
    }

    companion object {
        fun app(packageName: String): NotificationSourceIdentity =
            NotificationSourceIdentity(packageName, NotificationSourceScope.APP, "")

        fun channel(packageName: String, channelId: String): NotificationSourceIdentity =
            NotificationSourceIdentity(packageName, NotificationSourceScope.CHANNEL, channelId)

        fun nullChannel(packageName: String): NotificationSourceIdentity =
            NotificationSourceIdentity(packageName, NotificationSourceScope.NULL_CHANNEL, "")
    }
}

data class NotificationSource(
    val identity: NotificationSourceIdentity,
    val appLabel: String? = null,
    val channelDisplayName: String? = null,
    val firstSeenAt: Long,
    val lastSeenAt: Long,
    val policy: NotificationUserPolicy = NotificationUserPolicy.INHERIT,
) {
    init {
        require(appLabel == null || appLabel.isNotBlank()) { "appLabel must be null or non-blank" }
        require(channelDisplayName == null || channelDisplayName.isNotBlank()) {
            "channelDisplayName must be null or non-blank"
        }
        require(firstSeenAt >= 0L) { "firstSeenAt must not be negative" }
        require(lastSeenAt >= firstSeenAt) { "lastSeenAt must not precede firstSeenAt" }
    }
}

data class NotificationSourceCatalogMetadata(
    val identity: NotificationSourceIdentity,
    val appLabel: String? = null,
    val channelDisplayName: String? = null,
    val seenAt: Long,
) {
    init {
        require(appLabel == null || appLabel.isNotBlank()) { "appLabel must be null or non-blank" }
        require(channelDisplayName == null || channelDisplayName.isNotBlank()) {
            "channelDisplayName must be null or non-blank"
        }
        require(seenAt >= 0L) { "seenAt must not be negative" }
    }
}
