package com.claudewebui.app.core.offline

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import com.claudewebui.app.core.network.ConnectionState
import com.claudewebui.app.core.network.SocketManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

/**
 * Manages offline/online state by monitoring both the device's network connectivity
 * and the WebSocket connection to the server.
 *
 * Exposes:
 *  - [isOffline] — true when either network is unavailable or socket is disconnected
 *  - [pendingMessageCount] — number of messages queued while offline
 *
 * Usage: inject as a singleton via Koin and observe [isOffline] in the UI.
 */
class OfflineManager(
    context: Context,
    private val socketManager: SocketManager
) {
    private val appContext: Context = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    // True when network is unavailable at the OS level
    private val _hasNetwork = MutableStateFlow(isNetworkAvailable())

    // True when the app is effectively offline (network down OR socket not connected)
    private val _isOffline = MutableStateFlow(!isNetworkAvailable())
    val isOffline: StateFlow<Boolean> = _isOffline.asStateFlow()

    // Messages queued while offline
    private val _pendingMessages = MutableStateFlow<List<PendingMessage>>(emptyList())
    val pendingMessages: StateFlow<List<PendingMessage>> = _pendingMessages.asStateFlow()

    val pendingMessageCount: StateFlow<Int> get() = _pendingMessageCount
    private val _pendingMessageCount = MutableStateFlow(0)

    init {
        registerNetworkCallback()
        observeSocketState()
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Enqueue a message to be sent once connectivity is restored.
     * Returns the [PendingMessage] for tracking.
     */
    fun enqueueMessage(sessionId: String, text: String): PendingMessage {
        val msg = PendingMessage(sessionId = sessionId, text = text)
        val updated = _pendingMessages.value + msg
        _pendingMessages.value = updated
        _pendingMessageCount.value = updated.size
        return msg
    }

    /**
     * Drain and return all pending messages, clearing the queue.
     * Call this when back online and ready to flush queued messages.
     */
    fun drainPendingMessages(): List<PendingMessage> {
        val messages = _pendingMessages.value
        _pendingMessages.value = emptyList()
        _pendingMessageCount.value = 0
        return messages
    }

    // -------------------------------------------------------------------------
    // Network monitoring
    // -------------------------------------------------------------------------

    private fun registerNetworkCallback() {
        val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        cm.registerNetworkCallback(request, object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                scope.launch {
                    _hasNetwork.value = true
                    recalculate()
                }
            }

            override fun onLost(network: Network) {
                scope.launch {
                    _hasNetwork.value = false
                    recalculate()
                }
            }

            override fun onUnavailable() {
                scope.launch {
                    _hasNetwork.value = false
                    recalculate()
                }
            }
        })
    }

    private fun observeSocketState() {
        socketManager.connectionState
            .onEach { recalculate() }
            .launchIn(scope)
    }

    private fun recalculate() {
        val networkUp = _hasNetwork.value
        val socketUp = socketManager.connectionState.value == ConnectionState.CONNECTED
        _isOffline.value = !networkUp || !socketUp
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }
}

// ── Data ──────────────────────────────────────────────────────────────────────

data class PendingMessage(
    val id: String = java.util.UUID.randomUUID().toString(),
    val sessionId: String,
    val text: String,
    val enqueuedAt: Long = System.currentTimeMillis()
)
