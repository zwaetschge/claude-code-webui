package com.claudewebui.app.wear

import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.PermissionAction
import com.claudewebui.app.data.model.PermissionResponse
import com.claudewebui.app.widget.WidgetHub
import com.claudewebui.app.widget.WidgetRefreshWorker
import com.claudewebui.app.widget.WidgetStore
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Receives approval answers sent by the watch app over the Wear data layer and
 * forwards them to the backend — the watch never talks to the server itself.
 */
class WearBridgeService : WearableListenerService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != WearSync.PATH_APPROVAL_RESPONSE) {
            super.onMessageReceived(event)
            return
        }
        val payload = runCatching { JSONObject(String(event.data, Charsets.UTF_8)) }.getOrNull()
            ?: return
        val sessionId = payload.optString("sessionId")
        val requestId = payload.optString("requestId")
        val approve = payload.optBoolean("approve", false)
        if (sessionId.isBlank() || requestId.isBlank()) return

        scope.launch {
            runCatching {
                ApiClient().respondToPermission(
                    PermissionResponse(
                        sessionId,
                        requestId,
                        if (approve) PermissionAction.ALLOW_ONCE else PermissionAction.DENY,
                    )
                )
            }
            val context = applicationContext
            WidgetStore.load(context)?.let { snapshot ->
                val trimmed = snapshot.copy(
                    approvals = snapshot.approvals.filterNot { it.requestId == requestId },
                )
                WidgetStore.save(context, trimmed)
                WearSync.push(context, trimmed)
            }
            WidgetHub.pushAll(context)
            WidgetRefreshWorker.refreshNow(context)
        }
    }
}
