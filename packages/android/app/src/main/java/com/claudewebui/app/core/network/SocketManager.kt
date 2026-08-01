package com.claudewebui.app.core.network

import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.*
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.emitter.Emitter
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * Connection state for the Socket.IO connection.
 */
enum class ConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    RECONNECTING,
    ERROR
}

/**
 * Manages the Socket.IO real-time connection to the Plum Code WebUI backend.
 *
 * Provides:
 * - Connection lifecycle management (connect, disconnect, auto-reconnect)
 * - Per-session SharedFlow channels for all event types
 * - Methods for sending messages, input, interrupts, and mode changes
 *
 * Usage:
 * 1. Call [connect] with the server URL
 * 2. Call [subscribeToSession] to start receiving events for a session
 * 3. Collect from the various SharedFlow properties
 * 4. Call [disconnect] when done
 */
class SocketManager {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    private var socket: Socket? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val subscribedSessions = ConcurrentHashMap.newKeySet<String>()

    // --- Connection State ---
    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    // --- Reconnection ---
    private var reconnectJob: Job? = null
    private var reconnectAttempt = 0
    private val maxReconnectDelay = 30_000L // 30 seconds

    // --- Per-session event flows ---
    // Using replay = 0 and extraBufferCapacity for backpressure
    private val _output = MutableSharedFlow<StreamingMessage>(extraBufferCapacity = 256)
    val output: SharedFlow<StreamingMessage> = _output.asSharedFlow()

    private val _messages = MutableSharedFlow<Message>(extraBufferCapacity = 64)
    val messages: SharedFlow<Message> = _messages.asSharedFlow()

    private val _status = MutableSharedFlow<Pair<String, SessionStatus>>(extraBufferCapacity = 16)
    val status: SharedFlow<Pair<String, SessionStatus>> = _status.asSharedFlow()

    private val _toolUse = MutableSharedFlow<ToolExecutionEvent>(extraBufferCapacity = 64)
    val toolUse: SharedFlow<ToolExecutionEvent> = _toolUse.asSharedFlow()

    private val _agent = MutableSharedFlow<AgentEvent>(extraBufferCapacity = 32)
    val agent: SharedFlow<AgentEvent> = _agent.asSharedFlow()

    private val _thinking = MutableSharedFlow<Pair<String, Boolean>>(extraBufferCapacity = 16)
    val thinking: SharedFlow<Pair<String, Boolean>> = _thinking.asSharedFlow()

    private val _todos = MutableSharedFlow<Pair<String, List<TodoItem>>>(extraBufferCapacity = 16)
    val todos: SharedFlow<Pair<String, List<TodoItem>>> = _todos.asSharedFlow()

    private val _usage = MutableSharedFlow<UsageData>(extraBufferCapacity = 16)
    val usage: SharedFlow<UsageData> = _usage.asSharedFlow()

    private val _image = MutableSharedFlow<GeneratedImageData>(extraBufferCapacity = 8)
    val image: SharedFlow<GeneratedImageData> = _image.asSharedFlow()

    private val _permission = MutableSharedFlow<JsonElement>(extraBufferCapacity = 8)
    val permission: SharedFlow<JsonElement> = _permission.asSharedFlow()

    private val _compact = MutableSharedFlow<CompactEvent>(extraBufferCapacity = 8)
    val compact: SharedFlow<CompactEvent> = _compact.asSharedFlow()

    private val _mode = MutableSharedFlow<Pair<String, SessionMode>>(extraBufferCapacity = 8)
    val mode: SharedFlow<Pair<String, SessionMode>> = _mode.asSharedFlow()

    private val _errors = MutableSharedFlow<Pair<String, String>>(extraBufferCapacity = 16)
    val errors: SharedFlow<Pair<String, String>> = _errors.asSharedFlow()

    // ========================================================================
    // Connection Lifecycle
    // ========================================================================

    /**
     * Connect to the Socket.IO server.
     * @param serverUrl Base URL of the backend (e.g., "https://your-server:4545")
     */
    fun connect(serverUrl: String? = null) {
        val url = serverUrl ?: TokenStore.getServerUrl() ?: return
        disconnect()

        _connectionState.value = ConnectionState.CONNECTING
        reconnectAttempt = 0

        val options = IO.Options().apply {
            forceNew = true
            reconnection = false // We handle reconnection ourselves
            transports = arrayOf("websocket", "polling")
            val token = TokenStore.getToken()
            if (token != null) {
                auth = mapOf("token" to token)
                extraHeaders = mapOf("Authorization" to listOf("Bearer $token"))
            }
        }

        try {
            socket = IO.socket(url, options).apply {
                on(Socket.EVENT_CONNECT, onConnect)
                on(Socket.EVENT_DISCONNECT, onDisconnect)
                on(Socket.EVENT_CONNECT_ERROR, onConnectError)

                // Session events
                on("session:output", onSessionOutput)
                on("session:message", onSessionMessage)
                on("session:status", onSessionStatus)
                on("session:error", onSessionError)
                on("session:tool_use", onToolUse)
                on("session:agent", onAgentEvent)
                on("session:thinking", onThinking)
                on("session:todos", onTodos)
                on("session:usage", onUsage)
                on("session:image", onImage)
                on("session:permission_request", onPermission)
                on("session:compact", onCompact)
                on("session:mode", onMode)

                connect()
            }
        } catch (e: Exception) {
            _connectionState.value = ConnectionState.ERROR
            scheduleReconnect()
        }
    }

    /**
     * Disconnect from the server and clean up resources.
     */
    fun disconnect() {
        reconnectJob?.cancel()
        reconnectJob = null
        socket?.let { s ->
            s.off()
            s.disconnect()
        }
        socket = null
        subscribedSessions.clear()
        _connectionState.value = ConnectionState.DISCONNECTED
    }

    /**
     * Destroy the manager and cancel the coroutine scope.
     */
    fun destroy() {
        disconnect()
        scope.cancel()
    }

    // ========================================================================
    // Session Subscription
    // ========================================================================

    fun subscribeToSession(sessionId: String) {
        subscribedSessions.add(sessionId)
        socket?.emit("session:subscribe", sessionId)
    }

    fun unsubscribeFromSession(sessionId: String) {
        subscribedSessions.remove(sessionId)
        socket?.emit("session:unsubscribe", sessionId)
    }

    // ========================================================================
    // Session Actions
    // ========================================================================

    /**
     * Send a message to a session, optionally with file attachments.
     */
    fun sendMessage(
        sessionId: String,
        message: String,
        images: List<FileAttachmentData>? = null
    ) {
        val data = JSONObject().apply {
            put("sessionId", sessionId)
            put("message", message)
            if (!images.isNullOrEmpty()) {
                val imagesArray = JSONArray()
                images.forEach { img ->
                    imagesArray.put(JSONObject().apply {
                        put("data", img.data)
                        put("mimeType", img.mimeType)
                        img.filename?.let { put("filename", it) }
                    })
                }
                put("images", imagesArray)
            }
        }
        socket?.emit("session:send", data)
    }

    /**
     * Send raw input to a session (for interactive prompts).
     */
    fun sendInput(sessionId: String, input: String) {
        val data = JSONObject().apply {
            put("sessionId", sessionId)
            put("input", input)
        }
        socket?.emit("session:input", data)
    }

    /**
     * Interrupt the current operation in a session.
     */
    fun interruptSession(sessionId: String) {
        socket?.emit("session:interrupt", sessionId)
    }

    /**
     * Restart a session.
     */
    fun restartSession(sessionId: String) {
        socket?.emit("session:restart", sessionId)
    }

    /**
     * Set the permission mode for a session.
     */
    fun setMode(sessionId: String, mode: SessionMode) {
        val data = JSONObject().apply {
            put("sessionId", sessionId)
            put("mode", when (mode) {
                SessionMode.PLANNING -> "planning"
                SessionMode.AUTO_ACCEPT -> "auto-accept"
                SessionMode.MANUAL -> "manual"
                SessionMode.DANGER -> "danger"
            })
        }
        socket?.emit("session:set-mode", data)
    }

    /**
     * Approve a permission request (legacy flow).
     */
    fun approvePermission(sessionId: String, toolNames: List<String>, originalMessage: String) {
        val data = JSONObject().apply {
            put("sessionId", sessionId)
            put("toolNames", JSONArray(toolNames))
            put("originalMessage", originalMessage)
        }
        socket?.emit("session:approve_permission", data)
    }

    /**
     * Deny a permission request (legacy flow).
     */
    fun denyPermission(sessionId: String) {
        val data = JSONObject().apply {
            put("sessionId", sessionId)
        }
        socket?.emit("session:deny_permission", data)
    }

    /**
     * Respond to a hooks-based permission request with fine-grained control.
     */
    fun respondToPermission(
        sessionId: String,
        requestId: String,
        action: PermissionAction,
        pattern: String? = null
    ) {
        val data = JSONObject().apply {
            put("sessionId", sessionId)
            put("requestId", requestId)
            put("action", when (action) {
                PermissionAction.ALLOW_ONCE -> "allow_once"
                PermissionAction.ALLOW_PROJECT -> "allow_project"
                PermissionAction.ALLOW_GLOBAL -> "allow_global"
                PermissionAction.DENY -> "deny"
            })
            pattern?.let { put("pattern", it) }
        }
        socket?.emit("session:permission_respond", data)
    }

    /**
     * Reconnect to a session and replay buffered messages.
     */
    fun reconnectSession(sessionId: String, lastTimestamp: Long? = null) {
        val data = JSONObject().apply {
            put("sessionId", sessionId)
            lastTimestamp?.let { put("lastTimestamp", it) }
        }
        socket?.emit("session:reconnect", data)
    }

    // ========================================================================
    // Private: Connection Callbacks
    // ========================================================================

    private val onConnect = Emitter.Listener {
        _connectionState.value = ConnectionState.CONNECTED
        reconnectAttempt = 0
        reconnectJob?.cancel()
        // Re-subscribe to previously subscribed sessions
        subscribedSessions.forEach { sessionId ->
            socket?.emit("session:subscribe", sessionId)
        }
    }

    private val onDisconnect = Emitter.Listener {
        _connectionState.value = ConnectionState.DISCONNECTED
        scheduleReconnect()
    }

    private val onConnectError = Emitter.Listener {
        _connectionState.value = ConnectionState.ERROR
        scheduleReconnect()
    }

    // ========================================================================
    // Private: Session Event Handlers
    // ========================================================================

    private val onSessionOutput = Emitter.Listener { args ->
        parseAndEmit<StreamingMessage>(args) { _output.tryEmit(it) }
    }

    private val onSessionMessage = Emitter.Listener { args ->
        parseAndEmit<Message>(args) { _messages.tryEmit(it) }
    }

    private val onSessionStatus = Emitter.Listener { args ->
        val obj = args.firstOrNull() as? JSONObject ?: return@Listener
        val sessionId = obj.optString("sessionId")
        val statusStr = obj.optString("status")
        val sessionStatus = try {
            json.decodeFromString<SessionStatus>("\"$statusStr\"")
        } catch (_: Exception) { return@Listener }
        _status.tryEmit(sessionId to sessionStatus)
    }

    private val onSessionError = Emitter.Listener { args ->
        val obj = args.firstOrNull() as? JSONObject ?: return@Listener
        val sessionId = obj.optString("sessionId")
        val error = obj.optString("error")
        _errors.tryEmit(sessionId to error)
    }

    private val onToolUse = Emitter.Listener { args ->
        parseAndEmit<ToolExecutionEvent>(args) { _toolUse.tryEmit(it) }
    }

    private val onAgentEvent = Emitter.Listener { args ->
        parseAndEmit<AgentEvent>(args) { _agent.tryEmit(it) }
    }

    private val onThinking = Emitter.Listener { args ->
        val obj = args.firstOrNull() as? JSONObject ?: return@Listener
        val sessionId = obj.optString("sessionId")
        val isThinking = obj.optBoolean("isThinking")
        _thinking.tryEmit(sessionId to isThinking)
    }

    private val onTodos = Emitter.Listener { args ->
        val obj = args.firstOrNull() as? JSONObject ?: return@Listener
        val sessionId = obj.optString("sessionId")
        val todosArray = obj.optJSONArray("todos")?.toString() ?: return@Listener
        val todoItems = try {
            json.decodeFromString<List<TodoItem>>(todosArray)
        } catch (_: Exception) { return@Listener }
        _todos.tryEmit(sessionId to todoItems)
    }

    private val onUsage = Emitter.Listener { args ->
        parseAndEmit<UsageData>(args) { _usage.tryEmit(it) }
    }

    private val onImage = Emitter.Listener { args ->
        parseAndEmit<GeneratedImageData>(args) { _image.tryEmit(it) }
    }

    private val onPermission = Emitter.Listener { args ->
        val obj = args.firstOrNull() as? JSONObject ?: return@Listener
        val element = try {
            json.parseToJsonElement(obj.toString())
        } catch (_: Exception) { return@Listener }
        _permission.tryEmit(element)
    }

    private val onCompact = Emitter.Listener { args ->
        parseAndEmit<CompactEvent>(args) { _compact.tryEmit(it) }
    }

    private val onMode = Emitter.Listener { args ->
        val obj = args.firstOrNull() as? JSONObject ?: return@Listener
        val sessionId = obj.optString("sessionId")
        val modeStr = obj.optString("mode")
        val sessionMode = try {
            json.decodeFromString<SessionMode>("\"$modeStr\"")
        } catch (_: Exception) { return@Listener }
        _mode.tryEmit(sessionId to sessionMode)
    }

    // ========================================================================
    // Private: Reconnection Logic
    // ========================================================================

    private fun scheduleReconnect() {
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            _connectionState.value = ConnectionState.RECONNECTING
            // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s cap
            val delay = minOf(1000L * (1L shl reconnectAttempt), maxReconnectDelay)
            reconnectAttempt++
            delay(delay)
            if (isActive) {
                connect()
            }
        }
    }

    // ========================================================================
    // Private: JSON Parsing Helper
    // ========================================================================

    private inline fun <reified T> parseAndEmit(
        args: Array<out Any>,
        emit: (T) -> Unit
    ) {
        val obj = args.firstOrNull() as? JSONObject ?: return
        try {
            val decoded = json.decodeFromString<T>(obj.toString())
            emit(decoded)
        } catch (e: Exception) {
            // Silently ignore parse failures for robustness
        }
    }
}

/**
 * Data class for compact/context-clear events from the server.
 */
@kotlinx.serialization.Serializable
data class CompactEvent(
    val sessionId: String,
    val message: String,
    val summary: String? = null,
    val clear: Boolean? = null,
    val reason: String? = null,
    val error: String? = null
)

/**
 * Data class for generated image events from the server.
 */
@kotlinx.serialization.Serializable
data class GeneratedImageData(
    val sessionId: String,
    val imagePath: String,
    val imageBase64: String? = null,
    val mimeType: String,
    val prompt: String,
    val generator: String = "codex"
)
