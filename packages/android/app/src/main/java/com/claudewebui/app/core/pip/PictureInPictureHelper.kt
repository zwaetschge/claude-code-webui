package com.claudewebui.app.core.pip

import android.app.Activity
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Rational
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import com.claudewebui.app.R

/**
 * Helper that manages Picture-in-Picture (PiP) for the chat screen.
 *
 * Usage:
 * ```kotlin
 * // In Activity.onCreate:
 * pipHelper = PictureInPictureHelper(this)
 * pipHelper.register()
 *
 * // Auto-enter PiP when Claude is thinking and user navigates away:
 * override fun onUserLeaveHint() {
 *     if (hasActiveSession) pipHelper.enterPip(sessionId)
 * }
 *
 * // React to PiP mode changes:
 * override fun onPictureInPictureModeChanged(isInPiP: Boolean, …) {
 *     pipHelper.onPipModeChanged(isInPiP)
 * }
 *
 * // Cleanup:
 * override fun onDestroy() { pipHelper.unregister() }
 * ```
 *
 * The PiP window is a compact 16:9 overlay.
 * Available remote actions:
 * - Interrupt: sends SIGINT to the current CLI session.
 * - Expand: brings the app back to full-screen.
 */
@RequiresApi(Build.VERSION_CODES.O)
class PictureInPictureHelper(private val activity: Activity) {

    // Callbacks so the UI layer can react without coupling to this helper
    var onEnterPip: (() -> Unit)? = null
    var onExitPip: (() -> Unit)? = null
    var onInterruptRequested: ((sessionId: String) -> Unit)? = null

    private var activeSessionId: String? = null

    // ── BroadcastReceiver for remote actions ──────────────────────────────────

    private val pipActionReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                ACTION_INTERRUPT -> {
                    val sid = intent.getStringExtra(EXTRA_SESSION_ID) ?: return
                    onInterruptRequested?.invoke(sid)
                }
                ACTION_EXPAND -> {
                    // Maximise the activity from PiP mode
                    val launchIntent = Intent(activity, activity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP
                    }
                    activity.startActivity(launchIntent)
                }
            }
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    fun register() {
        val filter = IntentFilter().apply {
            addAction(ACTION_INTERRUPT)
            addAction(ACTION_EXPAND)
        }
        ContextCompat.registerReceiver(
            activity,
            pipActionReceiver,
            filter,
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
    }

    fun unregister() {
        try { activity.unregisterReceiver(pipActionReceiver) } catch (_: Exception) {}
    }

    // ── PiP entry ─────────────────────────────────────────────────────────────

    /**
     * Request the system to enter Picture-in-Picture mode for [sessionId].
     * Should be called from [Activity.onUserLeaveHint] when a session is running.
     *
     * @param sessionId   The currently active session — used for remote actions.
     */
    fun enterPip(sessionId: String) {
        activeSessionId = sessionId
        val params = buildPipParams(sessionId)
        activity.enterPictureInPictureMode(params)
    }

    /**
     * Update the PiP params while already in PiP mode (e.g. new session started).
     */
    fun updatePipParams(sessionId: String) {
        if (!activity.isInPictureInPictureMode) return
        activeSessionId = sessionId
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            activity.setPictureInPictureParams(buildPipParams(sessionId))
        }
    }

    // ── Mode change callback ───────────────────────────────────────────────────

    /**
     * Forward [Activity.onPictureInPictureModeChanged] here.
     */
    fun onPipModeChanged(isInPiP: Boolean) {
        if (isInPiP) onEnterPip?.invoke() else onExitPip?.invoke()
    }

    // ── PiP param builder ─────────────────────────────────────────────────────

    private fun buildPipParams(sessionId: String): PictureInPictureParams {
        val actions = buildRemoteActions(sessionId)
        return PictureInPictureParams.Builder()
            .setAspectRatio(Rational(16, 9))
            .setActions(actions)
            .apply {
                // Android 12+ can set a hint for auto-enter PiP
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    setAutoEnterEnabled(false) // we control entry manually
                    setSeamlessResizeEnabled(true)
                }
                // Android 13+ supports source rect hint for smooth animation
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    setTitle("Plum Code")
                    setSubtitle("Session active")
                }
            }
            .build()
    }

    private fun buildRemoteActions(sessionId: String): List<RemoteAction> {
        val actions = mutableListOf<RemoteAction>()

        // ── Interrupt action ────────────────────────────────────────────────
        val interruptIntent = PendingIntent.getBroadcast(
            activity,
            REQUEST_CODE_INTERRUPT,
            Intent(ACTION_INTERRUPT).apply {
                `package` = activity.packageName
                putExtra(EXTRA_SESSION_ID, sessionId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        actions.add(
            RemoteAction(
                Icon.createWithResource(activity, R.drawable.ic_notification),
                "Interrupt",
                "Stop the current operation",
                interruptIntent
            ).apply {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    isEnabled = true
                }
            }
        )

        // ── Expand action ───────────────────────────────────────────────────
        val expandIntent = PendingIntent.getBroadcast(
            activity,
            REQUEST_CODE_EXPAND,
            Intent(ACTION_EXPAND).apply { `package` = activity.packageName },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        actions.add(
            RemoteAction(
                Icon.createWithResource(activity, R.drawable.ic_notification),
                "Expand",
                "Open Plum Code full-screen",
                expandIntent
            )
        )

        return actions
    }

    companion object {
        private const val ACTION_INTERRUPT = "com.claudewebui.app.pip.INTERRUPT"
        private const val ACTION_EXPAND = "com.claudewebui.app.pip.EXPAND"
        private const val EXTRA_SESSION_ID = "session_id"
        private const val REQUEST_CODE_INTERRUPT = 801
        private const val REQUEST_CODE_EXPAND = 802

        /**
         * Check whether the device and current Android version support PiP.
         */
        fun isSupported(context: Context): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
            val pm = context.packageManager
            return pm.hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE)
        }
    }
}
