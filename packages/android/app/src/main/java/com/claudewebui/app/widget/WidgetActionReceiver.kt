package com.claudewebui.app.widget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.PermissionAction
import com.claudewebui.app.data.model.PermissionResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

const val ACTION_WIDGET_APPROVE = "com.claudewebui.app.widget.APPROVE"
const val ACTION_WIDGET_DENY = "com.claudewebui.app.widget.DENY"
const val EXTRA_WIDGET_SESSION_ID = "widget_session_id"
const val EXTRA_WIDGET_REQUEST_ID = "widget_request_id"

/**
 * Answers a permission request straight from the Approvals widget — same REST
 * path the notification actions use, no app launch required. The widget row
 * disappears with the refresh that follows.
 */
class WidgetActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val sessionId = intent.getStringExtra(EXTRA_WIDGET_SESSION_ID) ?: return
        val requestId = intent.getStringExtra(EXTRA_WIDGET_REQUEST_ID) ?: return
        val action = when (intent.action) {
            ACTION_WIDGET_APPROVE -> PermissionAction.ALLOW_ONCE
            ACTION_WIDGET_DENY -> PermissionAction.DENY
            else -> return
        }
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                // A broadcast may only stay alive ~10s; the client's own 30s
                // timeout would outlive it and get killed mid-flight.
                runCatching {
                    withTimeoutOrNull(8_000) {
                        ApiClient().respondToPermission(
                            PermissionResponse(sessionId, requestId, action)
                        )
                    }
                }
                // Drop the answered entry from the cache immediately so the
                // widget doesn't keep showing it until the refetch lands.
                WidgetStore.load(context)?.let { snapshot ->
                    WidgetStore.save(
                        context,
                        snapshot.copy(approvals = snapshot.approvals.filterNot { it.requestId == requestId }),
                    )
                }
                WidgetHub.pushAll(context)
                WidgetRefreshWorker.refreshNow(context)
            } finally {
                pending.finish()
            }
        }
    }
}
