package com.xingshu.nexa.mobile.data.update

import android.content.Context
import com.xingshu.nexa.mobile.domain.update.RuntimeBundleStorage
import java.io.File

class AndroidRuntimeBundleStorage(context: Context) : RuntimeBundleStorage {
    private val root = File(context.filesDir, "runtime-bundles")
    private val active = File(root, "active")
    private val previous = File(root, "previous")

    override val activeVersion: Long get() = versionOf(active)
    override val previousVersion: Long? get() = versionOf(previous).takeIf { it > 0 }

    override fun atomicCommit(version: Long, resources: Map<String, ByteArray>): Boolean {
        root.mkdirs()
        val pending = File(root, ".pending-${System.currentTimeMillis()}")
        return try {
            pending.mkdirs()
            resources.forEach { (relative, content) ->
                val target = File(pending, relative)
                require(target.canonicalPath.startsWith(pending.canonicalPath + File.separator))
                target.parentFile?.mkdirs(); target.writeBytes(content)
            }
            File(pending, "VERSION").writeText(version.toString())
            val discarded = File(root, ".discarded")
            if (discarded.exists()) discarded.deleteRecursively()
            if (previous.exists() && !previous.renameTo(discarded)) return false
            if (active.exists() && !active.renameTo(previous)) return false
            if (!pending.renameTo(active)) {
                if (previous.exists()) previous.renameTo(active)
                return false
            }
            discarded.deleteRecursively()
            true
        } catch (_: Exception) {
            pending.deleteRecursively(); false
        }
    }

    override fun rollback(): Boolean {
        if (!previous.exists()) return false
        val failed = File(root, ".failed-${System.currentTimeMillis()}")
        if (active.exists() && !active.renameTo(failed)) return false
        if (!previous.renameTo(active)) { if (failed.exists()) failed.renameTo(active); return false }
        failed.deleteRecursively(); return true
    }

    private fun versionOf(directory: File): Long = try { File(directory, "VERSION").readText().trim().toLong() } catch (_: Exception) { 0L }
}
