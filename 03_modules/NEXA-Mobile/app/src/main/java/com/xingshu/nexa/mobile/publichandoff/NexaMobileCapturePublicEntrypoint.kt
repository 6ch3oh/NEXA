package com.xingshu.nexa.mobile.publichandoff

import android.content.Context
import com.xingshu.nexa.mobile.data.publichandoff.AndroidCaptureDesktopHandoff

/** Public assembly entrypoint. Creating or reading this handoff does not schedule or mutate work. */
object NexaMobileCapturePublicEntrypoint {
    @JvmStatic
    fun createDesktopHandoff(context: Context): CaptureDesktopHandoff =
        AndroidCaptureDesktopHandoff.create(context.applicationContext)
}
