package com.claudewebui.app.core.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat

/**
 * Handles inline notification actions (Approve / Dismiss) without requiring the user
 * to open the app first.
 *
 * For APPROVE_PERMISSION the actual socket command is dispatched via
 * [LocalNotificationManager] which holds a reference to the live SocketManager.
 */
class NotificationActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val sessionId = intent.getStringExtra(NotificationService.EXTRA_SESSION_ID) ?: return
        val notificationId = intent.getIntExtra(NotificationService.EXTRA_NOTIFICATION_ID, -1)

        when (intent.action) {
            NotificationService.ACTION_APPROVE_PERMISSION -> {
                val requestId = intent.getStringExtra(NotificationService.EXTRA_REQUEST_ID) ?: return
                LocalNotificationManager.approvePermissionFromNotification(
                    context, sessionId, requestId
                )
                cancelNotification(context, sessionId, notificationId)
            }
            NotificationService.ACTION_DISMISS -> {
                cancelNotification(context, sessionId, notificationId)
            }
        }
    }

    private fun cancelNotification(context: Context, sessionId: String, notificationId: Int) {
        if (notificationId != -1) {
            NotificationManagerCompat.from(context).cancel(sessionId, notificationId)
        }
    }
}
