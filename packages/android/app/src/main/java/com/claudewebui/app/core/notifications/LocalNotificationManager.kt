package com.claudewebui.app.core.notifications

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.result.ActivityResultLauncher
import androidx.core.content.ContextCompat
import com.claudewebui.app.core.network.SocketManager
import com.claudewebui.app.data.model.SessionStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach

/**
 * Manages local notifications without requiring Firebase or WorkManager.
 *
 * Responsibilities:
 * 1. Monitor [SocketManager] flows and post notifications when the app is in background.
 * 2. Handle Android 13+ POST_NOTIFICATIONS permission requests.
 * 3. Serve as the in-process dispatcher for inline notification actions (approve permission).
 */
object LocalNotificationManager {

    // Injected on app init; held weakly to avoid Context leak
    private var appContext: Context? = null
    private var socketManager: SocketManager? = null

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    // Tracks whether the hosting Activity is currently in the foreground.
    @Volatile
    private var appInForeground = false

    // ── Initialisation ─────────────────────────────────────────────────────────

    /**
     * Initialize and start observing socket events.
     * Call once from [Application.onCreate] after [SocketManager] is created.
     */
    fun init(context: Context, socket: SocketManager) {
        appContext = context.applicationContext
        socketManager = socket
        observeSocketEvents(socket)
    }

    /**
     * Notify the manager that the app entered the foreground.
     * While in foreground we suppress background-only notifications.
     */
    fun onAppForegrounded() {
        appInForeground = true
    }

    /**
     * Notify the manager that the app went to the background.
     */
    fun onAppBackgrounded() {
        appInForeground = false
    }

    /** Clean up coroutine scope (call from Application.onTerminate if needed). */
    fun destroy() {
        scope.cancel()
        appContext = null
        socketManager = null
    }

    // ── Socket event observation ───────────────────────────────────────────────

    private fun observeSocketEvents(socket: SocketManager) {
        // Session status changes
        socket.status
            .onEach { (sessionId, status) ->
                if (appInForeground) return@onEach
                val ctx = appContext ?: return@onEach
                when (status) {
                    SessionStatus.STOPPED -> {
                        NotificationService.notifySessionCompleted(
                            ctx, sessionId, sessionId, "Session finished"
                        )
                    }
                    SessionStatus.ERROR -> {
                        NotificationService.notifyError(
                            ctx, sessionId, sessionId,
                            "Session encountered an error"
                        )
                    }
                    else -> Unit
                }
            }
            .launchIn(scope)

        // Permission requests
        socket.permission
            .onEach { permissionJson ->
                if (appInForeground) return@onEach
                val ctx = appContext ?: return@onEach
                val obj = permissionJson.toString()
                // Parse minimal fields from the permission JSON element
                try {
                    val jsonObj = org.json.JSONObject(obj)
                    val sessionId = jsonObj.optString("sessionId", "")
                    val requestId = jsonObj.optString("requestId", "")
                    val toolName = jsonObj
                        .optJSONArray("toolNames")
                        ?.optString(0) ?: jsonObj.optString("toolName", "unknown tool")
                    if (sessionId.isNotBlank() && requestId.isNotBlank()) {
                        NotificationService.notifyPermissionRequest(
                            ctx, sessionId, sessionId, toolName, requestId
                        )
                    }
                } catch (_: Exception) {}
            }
            .launchIn(scope)

        // Session errors
        socket.errors
            .onEach { (sessionId, errorMsg) ->
                if (appInForeground) return@onEach
                val ctx = appContext ?: return@onEach
                NotificationService.notifyError(ctx, sessionId, sessionId, errorMsg)
            }
            .launchIn(scope)

    }

    // ── Permission request handling ────────────────────────────────────────────

    /**
     * Check whether POST_NOTIFICATIONS permission is granted (Android 13+).
     * On older versions this always returns true.
     */
    fun hasNotificationPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Request POST_NOTIFICATIONS permission using a pre-registered launcher.
     * Obtain the launcher via:
     * ```kotlin
     * val launcher = rememberLauncherForActivityResult(
     *     ActivityResultContracts.RequestPermission()
     * ) { granted -> … }
     * ```
     */
    fun requestNotificationPermission(
        launcher: ActivityResultLauncher<String>
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            launcher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    /**
     * Show permission rationale dialog if needed (call from an Activity context).
     */
    fun shouldShowRationale(activity: Activity): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
        return activity.shouldShowRequestPermissionRationale(
            android.Manifest.permission.POST_NOTIFICATIONS
        )
    }

    // ── Inline notification action dispatch ───────────────────────────────────

    /**
     * Called by [NotificationActionReceiver] when the user taps "Approve" on a
     * permission notification. Dispatches the approval through the live socket
     * without requiring the app to open.
     */
    fun approvePermissionFromNotification(
        context: Context,
        sessionId: String,
        requestId: String
    ) {
        val socket = socketManager
        if (socket != null) {
            socket.respondToPermission(
                sessionId,
                requestId,
                com.claudewebui.app.data.model.PermissionAction.ALLOW_ONCE
            )
        }
        // Cancel the ongoing permission notification
        NotificationService.cancelSessionNotifications(context, sessionId)
    }
}
