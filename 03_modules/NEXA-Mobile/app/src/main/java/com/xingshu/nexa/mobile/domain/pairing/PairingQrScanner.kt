package com.xingshu.nexa.mobile.domain.pairing

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.ReaderException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

enum class PairingQrScanResult {
    ACCEPTED,
    INVALID,
    DUPLICATE_INVALID,
    ALREADY_ACCEPTED,
}

class PairingQrScanGate(
    private val parser: PairingPayloadParser,
    private val onAccepted: (PairingPayloadV0_1) -> Unit,
    private val onInvalid: (String) -> Unit,
) {
    private val accepted = AtomicBoolean(false)
    private var lastInvalidDigest: ByteArray? = null

    @Synchronized
    fun consume(rawText: String): PairingQrScanResult {
        if (accepted.get()) return PairingQrScanResult.ALREADY_ACCEPTED
        return try {
            val payload = parser.parse(rawText)
            if (!accepted.compareAndSet(false, true)) return PairingQrScanResult.ALREADY_ACCEPTED
            lastInvalidDigest = null
            onAccepted(payload)
            PairingQrScanResult.ACCEPTED
        } catch (error: PairingException) {
            val digest = MessageDigest.getInstance("SHA-256")
                .digest(rawText.toByteArray(Charsets.UTF_8))
            if (lastInvalidDigest?.contentEquals(digest) == true) {
                PairingQrScanResult.DUPLICATE_INVALID
            } else {
                lastInvalidDigest = digest
                onInvalid(error.errorCode)
                PairingQrScanResult.INVALID
            }
        }
    }
}

class ZxingQrCodeDecoder {
    private val reader = MultiFormatReader().apply {
        setHints(
            mapOf(
                DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
                DecodeHintType.CHARACTER_SET to "UTF-8",
                DecodeHintType.TRY_HARDER to true,
            ),
        )
    }

    @Synchronized
    fun decode(
        luminance: ByteArray,
        width: Int,
        height: Int,
        rotationDegrees: Int,
    ): String? {
        require(luminance.size == width * height) { "luminance frame dimensions are invalid" }
        val rotated = rotate(luminance, width, height, rotationDegrees)
        val source = PlanarYUVLuminanceSource(
            rotated.bytes,
            rotated.width,
            rotated.height,
            0,
            0,
            rotated.width,
            rotated.height,
            false,
        )
        return try {
            reader.decodeWithState(BinaryBitmap(HybridBinarizer(source))).text
        } catch (_: ReaderException) {
            null
        } finally {
            reader.reset()
        }
    }

    private fun rotate(
        source: ByteArray,
        width: Int,
        height: Int,
        rotation: Int,
    ): RotatedLuminance = when (rotation) {
        0 -> RotatedLuminance(source, width, height)
        90 -> {
            val target = ByteArray(source.size)
            for (y in 0 until height) for (x in 0 until width) {
                target[x * height + (height - y - 1)] = source[y * width + x]
            }
            RotatedLuminance(target, height, width)
        }
        180 -> RotatedLuminance(source.reversedArray(), width, height)
        270 -> {
            val target = ByteArray(source.size)
            for (y in 0 until height) for (x in 0 until width) {
                target[(width - x - 1) * height + y] = source[y * width + x]
            }
            RotatedLuminance(target, height, width)
        }
        else -> throw IllegalArgumentException("rotation must be 0, 90, 180, or 270")
    }

    private data class RotatedLuminance(
        val bytes: ByteArray,
        val width: Int,
        val height: Int,
    )
}
