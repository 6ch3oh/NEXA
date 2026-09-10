package com.xingshu.nexa.mobile.domain.sync.protocol

import com.xingshu.nexa.mobile.domain.sync.SyncAckDisposition
import com.xingshu.nexa.mobile.domain.sync.SyncEventIdentity
import java.lang.StringBuilder

class SyncWireJsonCodec {
    internal fun encodeObject(value: Map<String, Any?>): String = encode(value)

    internal fun decodeObject(
        value: String,
        malformedCode: String,
    ): Map<String, Any?> = parseObject(value, malformedCode)

    fun encodeRequest(request: SyncWireRequest): String = encode(
        linkedMapOf(
            "protocol_version" to request.protocolVersion,
            "device_id" to request.deviceId,
            "batch_id" to request.batchId,
            "sent_at" to request.sentAt,
            "events" to request.events.map { event ->
                linkedMapOf(
                    "event_type" to event.identity.eventType.name,
                    "event_id" to event.identity.eventId,
                    "payload" to event.payload.fields,
                    "event_time" to event.payload.eventTime,
                    "attempt" to event.attempt,
                )
            },
        ),
    )

    fun decodeRequest(json: String): SyncWireRequest {
        val root = parseObject(json, "INVALID_REQUEST:MALFORMED_JSON")
        val protocolVersion = root.requiredString("protocol_version", "INVALID_REQUEST")
        if (protocolVersion != SyncWireProtocol.VERSION) {
            throw SyncProtocolException("INVALID_REQUEST:PROTOCOL_VERSION")
        }
        val events = root.requiredList("events", "INVALID_REQUEST").map { rawEvent ->
            val event = rawEvent.asObject("INVALID_REQUEST:EVENT")
            SyncWireEvent(
                identity = SyncEventIdentity(
                    syncEventType(event.requiredString("event_type", "INVALID_REQUEST")),
                    event.requiredString("event_id", "INVALID_REQUEST"),
                ),
                payload = SyncEventPayload(
                    eventTime = event.requiredLong("event_time", "INVALID_REQUEST"),
                    fields = event.requiredObject("payload", "INVALID_REQUEST"),
                ),
                attempt = event.requiredLong("attempt", "INVALID_REQUEST").toIntExact(
                    "INVALID_REQUEST:ATTEMPT",
                ),
            )
        }
        return SyncWireRequest(
            protocolVersion = protocolVersion,
            deviceId = root.requiredString("device_id", "INVALID_REQUEST"),
            batchId = root.requiredString("batch_id", "INVALID_REQUEST"),
            sentAt = root.requiredLong("sent_at", "INVALID_REQUEST"),
            events = events,
        )
    }

    fun encodeResponse(response: SyncWireResponse): String = encode(
        linkedMapOf(
            "protocol_version" to response.protocolVersion,
            "batch_id" to response.batchId,
            "acknowledgements" to response.acknowledgements.map { ack ->
                linkedMapOf<String, Any?>(
                    "event_type" to ack.identity.eventType.name,
                    "event_id" to ack.identity.eventId,
                    "status" to ack.status.name,
                    "reason" to ack.reason,
                    "error_message" to ack.errorMessage,
                )
            },
        ),
    )

    fun decodeResponse(json: String, expectedBatchId: String): SyncWireResponse {
        val root = parseObject(json, "INVALID_RESPONSE:MALFORMED_JSON")
        val protocolVersion = root.requiredString("protocol_version", "INVALID_RESPONSE")
        if (protocolVersion != SyncWireProtocol.VERSION) {
            throw SyncProtocolException("INVALID_RESPONSE:PROTOCOL_VERSION")
        }
        val batchId = root.requiredString("batch_id", "INVALID_RESPONSE")
        if (batchId != expectedBatchId) {
            throw SyncProtocolException("INVALID_RESPONSE:BATCH_ID")
        }
        val acknowledgements = root.requiredList(
            "acknowledgements",
            "INVALID_RESPONSE",
        ).map { rawAck ->
            val ack = rawAck.asObject("INVALID_RESPONSE:ACK")
            val statusValue = ack.requiredString("status", "INVALID_RESPONSE")
            val status = try {
                SyncAckDisposition.valueOf(statusValue)
            } catch (error: IllegalArgumentException) {
                throw SyncProtocolException("INVALID_RESPONSE:ACK_STATUS", error)
            }
            SyncWireAck(
                identity = SyncEventIdentity(
                    syncEventType(ack.requiredString("event_type", "INVALID_RESPONSE")),
                    ack.requiredString("event_id", "INVALID_RESPONSE"),
                ),
                status = status,
                reason = ack.optionalString("reason", "INVALID_RESPONSE"),
                errorMessage = ack.optionalString("error_message", "INVALID_RESPONSE"),
            )
        }
        return SyncWireResponse(protocolVersion, batchId, acknowledgements)
    }

    private fun parseObject(json: String, malformedCode: String): Map<String, Any?> = try {
        JsonParser(json).parse().asObject(malformedCode)
    } catch (error: SyncProtocolException) {
        throw error
    } catch (error: RuntimeException) {
        throw SyncProtocolException(malformedCode, error)
    }

    private fun encode(value: Any?): String = buildString { appendJson(value) }

    private fun StringBuilder.appendJson(value: Any?) {
        when (value) {
            null -> append("null")
            is String -> appendJsonString(value)
            is Boolean -> append(value)
            is Byte, is Short, is Int, is Long -> append(value)
            is Float -> appendFiniteNumber(value.toDouble())
            is Double -> appendFiniteNumber(value)
            is Map<*, *> -> {
                append('{')
                value.entries.forEachIndexed { index, entry ->
                    if (index > 0) append(',')
                    val key = entry.key as? String
                        ?: throw SyncProtocolException("INVALID_PAYLOAD:OBJECT_KEY")
                    appendJsonString(key)
                    append(':')
                    appendJson(entry.value)
                }
                append('}')
            }
            is Iterable<*> -> {
                append('[')
                value.forEachIndexed { index, element ->
                    if (index > 0) append(',')
                    appendJson(element)
                }
                append(']')
            }
            else -> throw SyncProtocolException("INVALID_PAYLOAD:VALUE_TYPE")
        }
    }

    private fun StringBuilder.appendFiniteNumber(value: Double) {
        if (!value.isFinite()) throw SyncProtocolException("INVALID_PAYLOAD:NON_FINITE_NUMBER")
        append(value)
    }

    private fun StringBuilder.appendJsonString(value: String) {
        append('"')
        value.forEach { character ->
            when (character) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\u000C' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (character.code < 0x20) {
                    append("\\u")
                    append(character.code.toString(16).padStart(4, '0'))
                } else append(character)
            }
        }
        append('"')
    }
}

private class JsonParser(private val source: String) {
    private var index = 0

    fun parse(): Any? {
        skipWhitespace()
        val value = parseValue()
        skipWhitespace()
        if (index != source.length) error("Trailing JSON content")
        return value
    }

    private fun parseValue(): Any? {
        skipWhitespace()
        if (index >= source.length) error("Unexpected end of JSON")
        return when (source[index]) {
            '{' -> parseObject()
            '[' -> parseArray()
            '"' -> parseString()
            't' -> parseLiteral("true", true)
            'f' -> parseLiteral("false", false)
            'n' -> parseLiteral("null", null)
            '-', in '0'..'9' -> parseNumber()
            else -> error("Unexpected JSON token")
        }
    }

    private fun parseObject(): Map<String, Any?> {
        expect('{')
        skipWhitespace()
        val result = linkedMapOf<String, Any?>()
        if (consume('}')) return result
        while (true) {
            skipWhitespace()
            val key = parseString()
            skipWhitespace()
            expect(':')
            if (result.containsKey(key)) error("Duplicate JSON key")
            result[key] = parseValue()
            skipWhitespace()
            if (consume('}')) return result
            expect(',')
        }
    }

    private fun parseArray(): List<Any?> {
        expect('[')
        skipWhitespace()
        val result = mutableListOf<Any?>()
        if (consume(']')) return result
        while (true) {
            result += parseValue()
            skipWhitespace()
            if (consume(']')) return result
            expect(',')
        }
    }

    private fun parseString(): String {
        expect('"')
        val result = StringBuilder()
        while (index < source.length) {
            val character = source[index++]
            when (character) {
                '"' -> return result.toString()
                '\\' -> {
                    if (index >= source.length) error("Incomplete JSON escape")
                    when (val escaped = source[index++]) {
                        '"', '\\', '/' -> result.append(escaped)
                        'b' -> result.append('\b')
                        'f' -> result.append('\u000C')
                        'n' -> result.append('\n')
                        'r' -> result.append('\r')
                        't' -> result.append('\t')
                        'u' -> {
                            if (index + 4 > source.length) error("Incomplete unicode escape")
                            result.append(source.substring(index, index + 4).toInt(16).toChar())
                            index += 4
                        }
                        else -> error("Unknown JSON escape")
                    }
                }
                else -> {
                    if (character.code < 0x20) error("Unescaped control character")
                    result.append(character)
                }
            }
        }
        error("Unterminated JSON string")
    }

    private fun parseNumber(): Number {
        val start = index
        consume('-')
        if (consume('0')) {
            if (index < source.length && source[index].isDigit()) error("Leading zero")
        } else {
            requireDigits()
        }
        var decimal = false
        if (consume('.')) {
            decimal = true
            requireDigits()
        }
        if (index < source.length && source[index] in "eE") {
            decimal = true
            index += 1
            if (index < source.length && source[index] in "+-") index += 1
            requireDigits()
        }
        val number = source.substring(start, index)
        return if (decimal) number.toDouble() else number.toLong()
    }

    private fun requireDigits() {
        val start = index
        while (index < source.length && source[index].isDigit()) index += 1
        if (start == index) error("Expected digit")
    }

    private fun <T> parseLiteral(literal: String, value: T): T {
        if (!source.startsWith(literal, index)) error("Invalid JSON literal")
        index += literal.length
        return value
    }

    private fun expect(character: Char) {
        if (!consume(character)) error("Expected $character")
    }

    private fun consume(character: Char): Boolean {
        if (index < source.length && source[index] == character) {
            index += 1
            return true
        }
        return false
    }

    private fun skipWhitespace() {
        while (index < source.length && source[index] in " \t\r\n") index += 1
    }
}

private fun Any?.asObject(errorCode: String): Map<String, Any?> {
    @Suppress("UNCHECKED_CAST")
    return this as? Map<String, Any?> ?: throw SyncProtocolException(errorCode)
}

private fun Map<String, Any?>.requiredString(name: String, prefix: String): String =
    (this[name] as? String)?.takeIf(String::isNotBlank)
        ?: throw SyncProtocolException("$prefix:MISSING_OR_INVALID_$name")

private fun Map<String, Any?>.optionalString(name: String, prefix: String): String? {
    val value = this[name] ?: return null
    return (value as? String)?.takeIf(String::isNotBlank)
        ?: throw SyncProtocolException("$prefix:INVALID_$name")
}

private fun Map<String, Any?>.requiredLong(name: String, prefix: String): Long {
    val number = this[name] as? Number
        ?: throw SyncProtocolException("$prefix:MISSING_OR_INVALID_$name")
    val long = number.toLong()
    if (number.toDouble() != long.toDouble()) {
        throw SyncProtocolException("$prefix:INVALID_$name")
    }
    return long
}

private fun Map<String, Any?>.requiredList(name: String, prefix: String): List<Any?> =
    this[name] as? List<Any?>
        ?: throw SyncProtocolException("$prefix:MISSING_OR_INVALID_$name")

private fun Map<String, Any?>.requiredObject(name: String, prefix: String): Map<String, Any?> =
    this[name].asObject("$prefix:MISSING_OR_INVALID_$name")

private fun Long.toIntExact(errorCode: String): Int {
    if (this !in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong()) {
        throw SyncProtocolException(errorCode)
    }
    return toInt()
}
