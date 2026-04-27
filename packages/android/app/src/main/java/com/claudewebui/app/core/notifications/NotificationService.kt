package com.claudewebui.app.core.notifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.claudewebui.app.MainActivity
import com.claudewebui.app.R

/**
 * Local notification helper for Claude Code WebUI.
 *
 * Notification channels:
 * - SESSION_UPDATES_CHANNEL: Session completed / status changes
 * - PERMISSION_REQUESTS_CHANNEL: Permission approval prompts (high priority)
 * - ERRORS_CHANNEL: Error and warning notifications
 * - RALPH_CHANNEL: Ralph (autonomous agent) status changes
 *
 * Notifications are grouped per session using [sessionId] as the group key.
 * Tap targets deep-link directly into the relevant session via [MainActivity].
 */
object NotificationService {

    // ── Channel IDs ───────────────────────────────────────────────────────
    const val SESSION_UPDATES_CHANNEL = "session_updates"
    const val PERMISSION_REQUESTS_CHANNEL = "permission_requests"
    const val ERRORS_CHANNEL = "errors"
    const val RALPH_CHANNEL = "ralph_status"

    // ── Notification ID ranges ────────────────────────────────────────────
    // Ranges avoid collisions between categories while keeping grouping intact.
    private const val ID_SESSION_BASE = 1000
    private const val ID_PERMISSION_BASE = 2000
    private const val ID_ERROR_BASE = 3000
    private const val ID_RALPH_BASE = 4000

    // ── Action identifiers ────────────────────────────────────────────────
    const val ACTION_OPEN = "com.claudewebui.app.action.OPEN"
    const val ACTION_APPROVE_PERMISSION = "com.claudewebui.app.action.APPROVE_PERMISSION"
    const val ACTION_DISMISS = "com.claudewebui.app.action.DISMISS"

    // ── Intent extras ─────────────────────────────────────────────────────
    const val EXTRA_SESSION_ID = "session_id"
    const val EXTRA_REQUEST_ID = "request_id"
    const val EXTRA_NOTIFICATION_ID = "notification_id"

    // ── Channels setup ────────────────────────────────────────────────────

    /**
     * Create all notification channels. Safe to call multiple times; the OS
     * is idempotent for existing channels.
     * Must be called before posting any notification (typically in Application.onCreate).
     */
    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        nm.createNotificationChannels(
            listOf(
                NotificationChannel(
                    SESSION_UPDATES_CHANNEL,
                    "Session Updates",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "Notifies when a Claude session completes or changes status"
                    setShowBadge(true)
                    enableLights(true)
                    lightColor = 0xFFCC785C.toInt() // AntiqueBrass brand color
                },
                NotificationChannel(
                    PERMISSION_REQUESTS_CHANNEL,
                    "Permission Requests",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Requires your approval before Claude can run a command"
                    setShowBadge(true)
                    enableLights(true)
                    lightColor = 0xFFF59E0B.toInt() // WarningAmber
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 250, 100, 250)
                    lockscreenVisibility = Notification.VISIBILITY_PRIVATE
                },
                NotificationChannel(
                    ERRORS_CHANNEL,
                    "Errors & Warnings",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "Errors and warnings from active sessions"
                    setShowBadge(false)
                    enableLights(true)
                    lightColor = 0xFFEF4444.toInt() // ErrorRed
                },
                NotificationChannel(
                    RALPH_CHANNEL,
                    "Ralph Status",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "Status updates from the Ralph autonomous agent"
                    setShowBadge(true)
                    enableLights(true)
                    lightColor = 0xFFC377FF.toInt() // BrandPurple
                }
            )
        )
    }

    // ── Public factory methods (usable from LocalNotificationManager) ──────

    /**
     * Post a "session completed" notification.
     *
     * @param context         Application context.
     * @param sessionId       ID of the completed session.
     * @param sessionName     Human-readable session title.
     * @param summary         Optional short summary of what Claude produced.
     */
    fun notifySessionCompleted(
        context: Context,
        sessionId: String,
        sessionName: String,
        summary: String? = null
    ) {
        val notificationId = sessionIdToNotificationId(sessionId, ID_SESSION_BASE)
        val notification = buildSessionCompletedNotification(
            context, sessionId, sessionName, summary, notificationId
        )
        NotificationManagerCompat.from(context).notify(
            sessionId, notificationId, notification
        )
    }

    /**
     * Post a permission request notification with Approve / Dismiss actions.
     */
    fun notifyPermissionRequest(
        context: Context,
        sessionId: String,
        sessionName: String,
        toolName: String,
        requestId: String
    ) {
        val notificationId = sessionIdToNotificationId(sessionId, ID_PERMISSION_BASE)
        val notification = buildPermissionNotification(
            context, sessionId, sessionName, toolName, requestId, notificationId
        )
        NotificationManagerCompat.from(context).notify(
            sessionId, notificationId, notification
        )
    }

    /**
     * Post an error or warning notification.
     */
    fun notifyError(
        context: Context,
        sessionId: String,
        sessionName: String,
        message: String,
        isWarning: Boolean = false
    ) {
        val notificationId = sessionIdToNotificationId(sessionId, ID_ERROR_BASE)
        val notification = buildErrorNotification(
            context, sessionId, sessionName, message, isWarning, notificationId
        )
        NotificationManagerCompat.from(context).notify(
            sessionId, notificationId, notification
        )
    }

    /**
     * Post a Ralph agent status change notification.
     */
    fun notifyRalphState(
        context: Context,
        sessionId: String,
        runId: String,
        state: String,
        message: String
    ) {
        val notificationId = sessionIdToNotificationId(runId, ID_RALPH_BASE)
        val notification = buildRalphNotification(
            context, sessionId, runId, state, message, notificationId
        )
        NotificationManagerCompat.from(context).notify(
            sessionId, notificationId, notification
        )
    }

    /**
     * Cancel all notifications for a given session group.
     */
    fun cancelSessionNotifications(context: Context, sessionId: String) {
        val nm = NotificationManagerCompat.from(context)
        listOf(ID_SESSION_BASE, ID_PERMISSION_BASE, ID_ERROR_BASE).forEach { base ->
            nm.cancel(sessionId, sessionIdToNotificationId(sessionId, base))
        }
    }

    // ── Private builders ──────────────────────────────────────────────────

    private fun buildSessionCompletedNotification(
        context: Context,
        sessionId: String,
        sessionName: String,
        summary: String?,
        notificationId: Int
    ): Notification {
        val tapIntent = deepLinkPendingIntent(context, sessionId, notificationId)
        val openAction = NotificationCompat.Action(
            0, "Open", tapIntent
        )
        return NotificationCompat.Builder(context, SESSION_UPDATES_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Session completed")
            .setContentText(sessionName)
            .apply { summary?.let { setStyle(NotificationCompat.BigTextStyle().bigText(it)) } }
            .setContentIntent(tapIntent)
            .addAction(openAction)
            .setAutoCancel(true)
            .setGroup(sessionId)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
    }

    private fun buildPermissionNotification(
        context: Context,
        sessionId: String,
        sessionName: String,
        toolName: String,
        requestId: String,
        notificationId: Int
    ): Notification {
        val tapIntent = deepLinkPendingIntent(context, sessionId, notificationId)

        val approveIntent = PendingIntent.getBroadcast(
            context,
            notificationId + 100,
            Intent(context, NotificationActionReceiver::class.java).apply {
                action = ACTION_APPROVE_PERMISSION
                putExtra(EXTRA_SESSION_ID, sessionId)
                putExtra(EXTRA_REQUEST_ID, requestId)
                putExtra(EXTRA_NOTIFICATION_ID, notificationId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val dismissIntent = PendingIntent.getBroadcast(
            context,
            notificationId + 200,
            Intent(context, NotificationActionReceiver::class.java).apply {
                action = ACTION_DISMISS
                putExtra(EXTRA_SESSION_ID, sessionId)
                putExtra(EXTRA_NOTIFICATION_ID, notificationId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(context, PERMISSION_REQUESTS_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Permission required — $sessionName")
            .setContentText("Claude wants to run: $toolName")
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText("Claude wants to run: $toolName\nTap \"Approve\" to allow this action.")
            )
            .setContentIntent(tapIntent)
            .addAction(NotificationCompat.Action(0, "Approve", approveIntent))
            .addAction(NotificationCompat.Action(0, "Dismiss", dismissIntent))
            .setAutoCancel(false)
            .setOngoing(true) // stays until user acts
            .setGroup(sessionId)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
    }

    private fun buildErrorNotification(
        context: Context,
        sessionId: String,
        sessionName: String,
        message: String,
        isWarning: Boolean,
        notificationId: Int
    ): Notification {
        val tapIntent = deepLinkPendingIntent(context, sessionId, notificationId)
        val title = if (isWarning) "Warning — $sessionName" else "Error — $sessionName"
        return NotificationCompat.Builder(context, ERRORS_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setContentIntent(tapIntent)
            .addAction(NotificationCompat.Action(0, "Open", tapIntent))
            .setAutoCancel(true)
            .setGroup(sessionId)
            .setCategory(NotificationCompat.CATEGORY_ERROR)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
    }

    private fun buildRalphNotification(
        context: Context,
        sessionId: String,
        runId: String,
        state: String,
        message: String,
        notificationId: Int
    ): Notification {
        val tapIntent = deepLinkPendingIntent(context, sessionId, notificationId)
        val title = when (state) {
            "completed" -> "Ralph finished"
            "error" -> "Ralph encountered an error"
            "paused" -> "Ralph paused"
            else -> "Ralph: $state"
        }
        return NotificationCompat.Builder(context, RALPH_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setContentIntent(tapIntent)
            .addAction(NotificationCompat.Action(0, "Open", tapIntent))
            .setAutoCancel(true)
            .setGroup(sessionId)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    /** Stable integer ID derived from sessionId + base bucket. */
    private fun sessionIdToNotificationId(id: String, base: Int): Int =
        base + (id.hashCode() and 0x0FFF)

    /** PendingIntent that deep-links into a specific session. */
    private fun deepLinkPendingIntent(
        context: Context,
        sessionId: String,
        notificationId: Int
    ): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = android.net.Uri.parse("claudewebui://session/$sessionId")
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_NOTIFICATION_ID, notificationId)
        }
        return PendingIntent.getActivity(
            context,
            notificationId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
