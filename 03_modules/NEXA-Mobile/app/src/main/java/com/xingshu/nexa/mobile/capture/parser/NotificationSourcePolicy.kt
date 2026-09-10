package com.xingshu.nexa.mobile.capture.parser

class NotificationSourcePolicy(allowedPackages: Set<String>) {
    val allowedPackages: Set<String> = allowedPackages.toSet()

    init {
        require(this.allowedPackages.all(String::isNotBlank)) {
            "allowedPackages must contain only non-blank package names"
        }
    }

    fun isAllowed(sourcePackage: String): Boolean = sourcePackage in allowedPackages
}
