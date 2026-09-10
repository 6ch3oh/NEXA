package com.xingshu.nexa.mobile.data.pairing

import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.xingshu.nexa.mobile.domain.pairing.PairingQrScanGate
import com.xingshu.nexa.mobile.domain.pairing.PairingQrScanResult
import com.xingshu.nexa.mobile.domain.pairing.ZxingQrCodeDecoder
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean

enum class PairingScanDiagnostic {
    FRAME_RECEIVED,
    ZXING_ATTEMPTED,
    ZXING_DECODED,
    PAYLOAD_ACCEPTED,
}

data class PairingScannerPerformanceDiagnostic(
    val frameCount: Long,
    val elapsedMillis: Long,
    val approximateFps: Double,
    val decodeMillis: Long,
    val width: Int,
    val height: Int,
    val rotationDegrees: Int,
    val rowStride: Int,
    val pixelStride: Int,
    val decoded: Boolean,
) {
    fun toLogLine(): String =
        "scanner_metrics frames=$frameCount elapsed_ms=$elapsedMillis " +
            "fps=${"%.1f".format(java.util.Locale.US, approximateFps)} " +
            "decode_ms=$decodeMillis frame=${width}x$height rotation=$rotationDegrees " +
            "row_stride=$rowStride pixel_stride=$pixelStride decoded=$decoded"
}

class PairingImageAnalyzer(
    private val decoder: ZxingQrCodeDecoder,
    private val gate: PairingQrScanGate,
    private val onAccepted: () -> Unit,
    private val onDiagnostic: (PairingScanDiagnostic) -> Unit = {},
    private val onPerformanceDiagnostic: (PairingScannerPerformanceDiagnostic) -> Unit = {},
    private val nanoTime: () -> Long = System::nanoTime,
) : ImageAnalysis.Analyzer {
    private val stopped = AtomicBoolean(false)
    private val diagnosticsEmitted = PairingScanDiagnostic.entries
        .associateWith { AtomicBoolean(false) }
    private val startedAtNanos = nanoTime()
    private var frameCount = 0L

    override fun analyze(image: ImageProxy) {
        try {
            if (stopped.get()) return
            frameCount += 1L
            emitOnce(PairingScanDiagnostic.FRAME_RECEIVED)
            val plane = image.planes.firstOrNull() ?: return
            val crop = image.cropRect
            val luminance = YPlaneLuminanceExtractor.extract(
                buffer = plane.buffer,
                rowStride = plane.rowStride,
                pixelStride = plane.pixelStride,
                imageWidth = image.width,
                imageHeight = image.height,
                cropLeft = crop.left,
                cropTop = crop.top,
                cropRight = crop.right,
                cropBottom = crop.bottom,
            )
            emitOnce(PairingScanDiagnostic.ZXING_ATTEMPTED)
            val decodeStartedAt = nanoTime()
            val raw = decoder.decode(
                luminance = luminance.bytes,
                width = luminance.width,
                height = luminance.height,
                rotationDegrees = image.imageInfo.rotationDegrees,
            )
            val decodedAt = nanoTime()
            if (frameCount == 1L || frameCount % PERFORMANCE_SAMPLE_INTERVAL == 0L || raw != null) {
                val elapsedNanos = (decodedAt - startedAtNanos).coerceAtLeast(1L)
                onPerformanceDiagnostic(
                    PairingScannerPerformanceDiagnostic(
                        frameCount = frameCount,
                        elapsedMillis = elapsedNanos / 1_000_000L,
                        approximateFps = frameCount * 1_000_000_000.0 / elapsedNanos,
                        decodeMillis = (decodedAt - decodeStartedAt).coerceAtLeast(0L) / 1_000_000L,
                        width = luminance.width,
                        height = luminance.height,
                        rotationDegrees = image.imageInfo.rotationDegrees,
                        rowStride = plane.rowStride,
                        pixelStride = plane.pixelStride,
                        decoded = raw != null,
                    ),
                )
            }
            if (raw == null) return
            emitOnce(PairingScanDiagnostic.ZXING_DECODED)
            if (gate.consume(raw) == PairingQrScanResult.ACCEPTED) {
                emitOnce(PairingScanDiagnostic.PAYLOAD_ACCEPTED)
                stopped.set(true)
                onAccepted()
            }
        } finally {
            image.close()
        }
    }

    fun stop() {
        stopped.set(true)
    }

    private fun emitOnce(diagnostic: PairingScanDiagnostic) {
        if (diagnosticsEmitted.getValue(diagnostic).compareAndSet(false, true)) {
            onDiagnostic(diagnostic)
        }
    }

    private companion object {
        const val PERFORMANCE_SAMPLE_INTERVAL = 15L
    }
}

internal data class LuminanceFrame(
    val bytes: ByteArray,
    val width: Int,
    val height: Int,
)

internal object YPlaneLuminanceExtractor {
    fun extract(
        buffer: ByteBuffer,
        rowStride: Int,
        pixelStride: Int,
        imageWidth: Int,
        imageHeight: Int,
        cropLeft: Int,
        cropTop: Int,
        cropRight: Int,
        cropBottom: Int,
    ): LuminanceFrame {
        require(rowStride > 0 && pixelStride > 0) { "Y plane strides must be positive" }
        require(cropLeft >= 0 && cropTop >= 0) { "crop origin must be non-negative" }
        require(cropRight in (cropLeft + 1)..imageWidth) { "crop width is invalid" }
        require(cropBottom in (cropTop + 1)..imageHeight) { "crop height is invalid" }

        val width = cropRight - cropLeft
        val height = cropBottom - cropTop
        val source = buffer.duplicate()
        val baseOffset = source.position()
        val finalOffset = baseOffset +
            (cropBottom - 1) * rowStride +
            (cropRight - 1) * pixelStride
        require(finalOffset < source.limit()) { "Y plane buffer is smaller than the cropped frame" }

        val result = ByteArray(width * height)
        for (row in 0 until height) {
            val sourceRowOffset = baseOffset + (cropTop + row) * rowStride + cropLeft * pixelStride
            val targetRowOffset = row * width
            if (pixelStride == 1) {
                source.position(sourceRowOffset)
                source.get(result, targetRowOffset, width)
            } else {
                for (column in 0 until width) {
                    result[targetRowOffset + column] = source.get(sourceRowOffset + column * pixelStride)
                }
            }
        }
        return LuminanceFrame(result, width, height)
    }
}
