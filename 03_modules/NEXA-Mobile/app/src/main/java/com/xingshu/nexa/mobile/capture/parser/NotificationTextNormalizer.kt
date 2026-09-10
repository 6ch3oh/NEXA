package com.xingshu.nexa.mobile.capture.parser

import com.xingshu.nexa.mobile.capture.notification.NotificationSnapshot
import com.xingshu.nexa.mobile.domain.notification.RawNotificationEvent
import java.text.Normalizer

data class NormalizedNotificationText(
    val title: String?,
    val body: String?,
    val rawText: String,
    val mergedText: String,
)

object NotificationTextNormalizer {
    private val horizontalWhitespace = Regex("[\\t\\u000B\\u000C ]+")
    private val punctuation = mapOf(
        '，' to ',',
        '。' to '.',
        '：' to ':',
        '；' to ';',
        '！' to '!',
        '？' to '?',
        '（' to '(',
        '）' to ')',
        '【' to '[',
        '】' to ']',
        '“' to '"',
        '”' to '"',
        '‘' to '\'',
        '’' to '\'',
    )

    fun normalizeField(value: String?): String? {
        if (value == null) return null
        val canonical = Normalizer.normalize(
            value
                .replace("\r\n", "\n")
                .replace('\r', '\n')
                .replace('\u00A0', ' ')
                .replace('\u202F', ' '),
            Normalizer.Form.NFKC,
        )
        val normalized = buildString(canonical.length) {
            canonical.forEach { character ->
                append(
                    when (character) {
                        '￥', '¥' -> '¥'
                        else -> punctuation[character] ?: character
                    },
                )
            }
        }
        return normalized
            .split('\n')
            .map { line -> horizontalWhitespace.replace(line, " ").trim() }
            .filter { line -> line.isNotEmpty() }
            .joinToString("\n")
            .trim()
    }

    fun normalize(snapshot: NotificationSnapshot): NormalizedNotificationText = normalize(
        title = snapshot.title,
        body = snapshot.body,
        rawText = snapshot.rawText,
    )

    fun normalize(event: RawNotificationEvent): NormalizedNotificationText = normalize(
        title = event.title,
        body = event.body,
        rawText = event.rawText,
    )

    private fun normalize(
        title: String?,
        body: String?,
        rawText: String,
    ): NormalizedNotificationText {
        val normalizedTitle = normalizeField(title).nullIfEmpty()
        val normalizedBody = normalizeField(body).nullIfEmpty()
        val normalizedRawText = normalizeField(rawText).orEmpty()
        val uniqueSegments = linkedSetOf<String>()
        listOfNotNull(normalizedTitle, normalizedBody, normalizedRawText.nullIfEmpty())
            .forEach(uniqueSegments::add)
        return NormalizedNotificationText(
            title = normalizedTitle,
            body = normalizedBody,
            rawText = normalizedRawText,
            mergedText = uniqueSegments.joinToString("\n"),
        )
    }

    private fun String?.nullIfEmpty(): String? = this?.takeIf(String::isNotEmpty)
}
