package com.xingshu.nexa.mobile.capture.parser

import com.xingshu.nexa.mobile.domain.notification.RawNotificationEvent

class NotificationParserRegistry(parsers: Collection<PackageRoutedNotificationParser>) {
    private val routes: Map<String, NotificationParser>

    init {
        val parserIds = mutableSetOf<String>()
        val mutableRoutes = linkedMapOf<String, NotificationParser>()
        parsers.forEach { parser ->
            require(parser.parserId.isNotBlank()) { "parserId must not be blank" }
            require(parser.parserVersion.isNotBlank()) { "parserVersion must not be blank" }
            require(parserIds.add(parser.parserId)) { "Duplicate parserId: ${parser.parserId}" }
            parser.sourcePackages.forEach { sourcePackage ->
                require(sourcePackage.isNotBlank()) { "source package must not be blank" }
                require(mutableRoutes.putIfAbsent(sourcePackage, parser) == null) {
                    "Duplicate parser mapping for source package: $sourcePackage"
                }
            }
        }
        routes = mutableRoutes.toMap()
    }

    fun parserFor(sourcePackage: String): NotificationParser? = routes[sourcePackage]

    fun parse(event: RawNotificationEvent): NotificationParseResult =
        parserFor(event.sourcePackage)?.parse(event)
            ?: NotificationParseResult.Ignored(ParserReasonCode.UNSUPPORTED_SOURCE)
}
