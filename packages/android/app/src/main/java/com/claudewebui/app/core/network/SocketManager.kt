package com.claudewebui.app.core.network

import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.*
import io.socket.client.IO
import io.socket.client.Ack
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
import java.net.URI
import java.util.concurrent.ConcurrentHashMap

internal data class SocketEndpoint(val origin: String, val path: String)

internal fun socketEndpoint(serverUrl: String): SocketEndpoint {
    val uri = URI(serverUrl)
    val prefix = uri.path.orEmpty().trimEnd('/')
    val origin = URI(uri.scheme, uri.userInfo, uri.host, uri.port, null, null, null).toString()
    return SocketEndpoint(
        origin = origin,
        path = if (prefix.isBlank()) "/socket.io" else "$prefix/socket.io",
    )
}

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

    private companion object {
        val TERMINAL_CONNECT_ERRORS = listOf(
            "Authentication required",
            "Invalid token",
            "Account unavailable",
        )
    }

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

    private val _thinking = MutableSharedFlow<ThinkingEvent>(extraBufferCapacity = 16)
    val thinking: SharedFlow<ThinkingEvent> = _thinking.asSharedFlow()

    private val _todos = MutableSharedFlow<Pair<String, List<TodoItem>>>(extraBufferCapacity = 16)
    val todos: SharedFlow<Pair<String, List<TodoItem>>> = _todos.asSharedFlow()

    private val _usage = MutableSharedFlow<UsageData>(extraBufferCapacity = 16)
    val usage: SharedFlow<UsageData> = _usage.asSharedFlow()

    private val _queue = MutableSharedFlow<QueueEvent>(extraBufferCapacity = 16)
    val queue: SharedFlow<QueueEvent> = _queue.asSharedFlow()

    private val _question = MutableSharedFlow<QuestionRequestEvent>(extraBufferCapacity = 8)
    val question: SharedFlow<QuestionRequestEvent> = _question.asSharedFlow()

    private val _reconnected = MutableSharedFlow<ReconnectedEvent>(extraBufferCapacity = 8)
    val reconnected: SharedFlow<ReconnectedEvent> = _reconnected.asSharedFlow()

    private val _cursor = MutableSharedFlow<Pair<String, Long>>(extraBufferCapacity = 32)
    val cursor: SharedFlow<Pair<String, Long>> = _cursor.asSharedFlow()

    private val _presence = MutableSharedFlow<PresenceSnapshot>(extraBufferCapacity = 16)
    val presence: SharedFlow<PresenceSnapshot> = _presence.asSharedFlow()

    private val _permission = MutableSharedFlow<JsonElement>(extraBufferCapacity = 8)
    val permission: SharedFlow<JsonElement> = _permission.asSharedFlow()

    private val _compact = MutableSharedFlow<CompactEvent>(extraBufferCapacity = 8)
    val compact: SharedFlow<CompactEvent> = _compact.asSharedFlow()

    private val _mode = MutableSharedFlow<Pair<String, SessionMode>>(extraBufferCapacity = 8)
    val mode: SharedFlow<Pair<String, SessionMode>> = _mode.asSharedFlow()

    private val _errors = MutableSharedFlow<Pair<String, String>>(extraBufferCapacity = 16)
    val errors: SharedFlow<Pair<String, String>> = _errors.asSharedFlow()

    /** Fires with the sessionId whenever this client submits a turn. */
    private val _turnStarted = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val turnStarted: SharedFlow<String> = _turnStarted.asSharedFlow()

    // ========================================================================
    // Connection Lifecycle
    // ========================================================================

    /**
     * Connect to the Socket.IO server.
     * @param serverUrl Base URL of the backend (e.g., "https://your-server:4545")
     */
    fun connect(serverUrl: String? = null) {
        val url = serverUrl ?: TokenStore.getServerUrl() ?: return
        val endpoint = runCatching { socketEndpoint(url) }.getOrNull() ?: return
        disconnect(clearSubscriptions = false)

        _connectionState.value = ConnectionState.CONNECTING

        val options = IO.Options().apply {
            forceNew = true
            reconnection = false // We handle reconnection ourselves
            transports = arrayOf("websocket", "polling")
            path = endpoint.path
            val token = TokenStore.getToken()
            if (token != null) {
                auth = mapOf("token" to token)
                extraHeaders = mapOf("Authorization" to listOf("Bearer $token"))
            }
        }

        try {
            socket = IO.socket(endpoint.origin, options).apply {
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
                on("session:permission_request", onPermission)
                on("session:question_request", onQuestion)
                on("session:queue", onQueue)
                on("session:reconnected", onReconnected)
                on("session:cursor", onCursor)
                on("session:presence", onPresence)
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
    fun disconnect(clearSubscriptions: Boolean = true) {
        reconnectJob?.cancel()
        reconnectJob = null
        socket?.let { s ->
            s.off()
            s.disconnect()
        }
        socket = null
        if (clearSubscriptions) subscribedSessions.clear()
        _connectionState.value = ConnectionState.DISCONNECTED
    }

    /**
     * Destroy the manager and cancel the coroutine scope.
     */
    fun destroy() {
        disconnect()
        scope.cancel()
    }

    /** Reconnect if the transport is gone; no-op while genuinely connected. */
    fun ensureConnected() {
        val s = socket
        if (s == null || !s.connected()) {
            reconnectAttempt = 0
            connect()
        }
    }

    /**
     * Hard reconnect after a long background stay. A socket revived from Doze
     * often still reports connected() == true while the server has long since
     * dropped it; only a fresh transport gets events flowing again. Session
     * subscriptions survive — [connect] keeps them and re-emits on connect.
     */
    fun forceReconnect() {
        reconnectAttempt = 0
        connect()
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
    suspend fun sendMessage(
        sessionId: String,
        chatId: String?,
        message: String,
        images: List<FileAttachmentData>? = null,
        clientMessageId: String,
        uploadIds: List<String> = emptyList(),
        activeFollowupMode: ActiveFollowupMode = ActiveFollowupMode.QUEUE,
    ): SessionSendAck {
        val activeSocket = socket?.takeIf { it.connected() } ?: return SessionSendAck(
            clientMessageId = clientMessageId,
            status = SessionSendAck.SendStatus.REJECTED,
            error = "Not connected to the server",
            retryable = true,
        )
        val data = JSONObject().apply {
            put("sessionId", sessionId)
            if (chatId == null) put("chatId", JSONObject.NULL) else put("chatId", chatId)
            put("message", message)
            put("clientMessageId", clientMessageId)
            put("activeFollowupMode", activeFollowupMode.name.lowercase())
            if (uploadIds.isNotEmpty()) put("uploadIds", JSONArray(uploadIds))
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
        val acknowledgement = CompletableDeferred<SessionSendAck>()
        activeSocket.emit("session:send", data, Ack { args ->
            val obj = when (val raw = args.firstOrNull()) {
                is JSONObject -> raw
                is Map<*, *> -> JSONObject(raw)
                else -> null
            }
            val parsed = obj?.let { parseSessionSendAck(it, clientMessageId) }
                ?: SessionSendAck(
                    clientMessageId = clientMessageId,
                    status = SessionSendAck.SendStatus.REJECTED,
                    error = "Server returned an invalid delivery acknowledgement",
                    retryable = true,
                )
            acknowledgement.complete(parsed)
        })
        val result = withTimeoutOrNull(SEND_ACK_TIMEOUT_MS) { acknowledgement.await() }
            ?: SessionSendAck(
                clientMessageId = clientMessageId,
                status = SessionSendAck.SendStatus.REJECTED,
                error = "Server did not confirm delivery. Retry keeps the same message id.",
                retryable = true,
            )
        if (result.status == SessionSendAck.SendStatus.ACCEPTED) {
            _turnStarted.tryEmit(sessionId)
        }
        return result
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
     * Reconnect to a session: joins the room server-side and answers with
     * `session:reconnected` (running state), so it doubles as a subscribe.
     */
    fun reconnectSession(
        sessionId: String,
        lastTimestamp: Long? = null,
        lastSequence: Long? = null,
    ) {
        val data = JSONObject().apply {
            put("sessionId", sessionId)
            lastTimestamp?.let { put("lastTimestamp", it) }
            lastSequence?.let { put("lastSequence", it) }
        }
        socket?.emit("session:reconnect", data)
    }

    fun updatePresence(
        sessionId: String,
        deviceId: String,
        label: String?,
        state: String,
        lastReadMessageId: String?,
    ) {
        socket?.takeIf { it.connected() }?.emit(
            "session:presence",
            JSONObject().apply {
                put("sessionId", sessionId)
                put("deviceId", deviceId)
                label?.let { put("label", it) }
                put("state", state)
                if (lastReadMessageId == null) put("lastReadMessageId", JSONObject.NULL)
                else put("lastReadMessageId", lastReadMessageId)
            },
        )
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

    private val onConnectError = Emitter.Listener { args ->
        _connectionState.value = ConnectionState.ERROR
        val message = when (val cause = args.firstOrNull()) {
            is Exception -> cause.message.orEmpty()
            else -> cause?.toString().orEmpty()
        }
        val terminal = TERMINAL_CONNECT_ERRORS.any { message.contains(it, ignoreCase = true) }
        // An invalid/expired token can only be fixed by re-login; retrying
        // every second just floods the server and drains the battery.
        if (!terminal) scheduleReconnect()
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
        _thinking.tryEmit(
            ThinkingEvent(
                sessionId = obj.optString("sessionId"),
                isThinking = obj.optBoolean("isThinking"),
                message = obj.optString("message").takeIf { it.isNotBlank() },
            )
        )
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

    private val onQueue = Emitter.Listener { args ->
        parseAndEmit<QueueEvent>(args) { _queue.tryEmit(it) }
    }

    private val onQuestion = Emitter.Listener { args ->
        parseAndEmit<QuestionRequestEvent>(args) { _question.tryEmit(it) }
    }

    private val onReconnected = Emitter.Listener { args ->
        val obj = args.firstOrNull() as? JSONObject ?: return@Listener
        val buffered = buildList {
            val values = obj.optJSONArray("bufferedMessages") ?: JSONArray()
            for (index in 0 until values.length()) {
                val item = values.optJSONObject(index) ?: continue
                runCatching { json.decodeFromString<BufferedMessage>(item.toString()) }
                    .getOrNull()
                    ?.let(::add)
            }
        }
        _reconnected.tryEmit(
            ReconnectedEvent(
                sessionId = obj.optString("sessionId"),
                isRunning = obj.optBoolean("isRunning"),
                needsFullResync = obj.optBoolean("needsFullResync"),
                bufferedMessages = buffered,
                highWatermark = obj.optLongOrNull("highWatermark"),
                snapshotRevision = obj.optLongOrNull("snapshotRevision"),
            )
        )
    }

    private val onCursor = Emitter.Listener { args ->
        val obj = args.firstOrNull() as? JSONObject ?: return@Listener
        val sessionId = obj.optString("sessionId")
        val sequence = obj.optLongOrNull("sequence") ?: return@Listener
        _cursor.tryEmit(sessionId to sequence)
    }

    private val onPresence = Emitter.Listener { args ->
        parseAndEmit<PresenceSnapshot>(args) { _presence.tryEmit(it) }
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
            // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s cap. The shift
            // must stay clamped: at attempt 63 `1L shl 63` is negative, minOf
            // picks it, and delay(negative) fires an immediate reconnect burst.
            val delay = minOf(1000L * (1L shl reconnectAttempt.coerceAtMost(5)), maxReconnectDelay)
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

/** `session:thinking` — the label drives the activity indicator text. */
data class ThinkingEvent(
    val sessionId: String,
    val isThinking: Boolean,
    val message: String? = null,
)

/** `session:reconnected` — answer to a `session:reconnect` request. */
data class ReconnectedEvent(
    val sessionId: String,
    val isRunning: Boolean,
    val needsFullResync: Boolean = false,
    val bufferedMessages: List<BufferedMessage> = emptyList(),
    val highWatermark: Long? = null,
    val snapshotRevision: Long? = null,
)

@kotlinx.serialization.Serializable
data class BufferedMessage(
    val type: String,
    val data: JsonElement,
    val timestamp: Long,
    val sequence: Long? = null,
)

/** `session:queue` — server-side message queue state while the CLI is busy. */
@kotlinx.serialization.Serializable
data class QueueEvent(
    val sessionId: String,
    val depth: Int = 0,
    val busy: Boolean = false,
    val preempting: Boolean = false,
    val items: List<QueueItem> = emptyList(),
)

@kotlinx.serialization.Serializable
data class QueueItem(
    val id: String = "",
    val preview: String = "",
)

internal const val SEND_ACK_TIMEOUT_MS = 12_000L

internal fun parseSessionSendAck(
    value: JSONObject,
    expectedClientMessageId: String,
): SessionSendAck {
    val clientMessageId = value.optString("clientMessageId").ifBlank { expectedClientMessageId }
    val attachments = buildList {
        val array = value.optJSONArray("attachments") ?: JSONArray()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            add(
                SessionSendAttachmentResult(
                    uploadId = item.optString("uploadId").takeIf { it.isNotBlank() },
                    filename = item.optString("filename"),
                    status = item.optString("status", "accepted"),
                    error = item.optString("error").takeIf { it.isNotBlank() },
                )
            )
        }
    }
    return if (value.optString("status") == "accepted") {
        SessionSendAck(
            clientMessageId = clientMessageId,
            status = SessionSendAck.SendStatus.ACCEPTED,
            chatId = value.optString("chatId").takeIf { it.isNotBlank() },
            acceptedAt = value.optString("acceptedAt").takeIf { it.isNotBlank() },
            messageId = value.optString("messageId").takeIf { it.isNotBlank() },
            disposition = value.optString("disposition").takeIf { it.isNotBlank() },
            highWatermark = value.optLongOrNull("highWatermark"),
            attachments = attachments,
        )
    } else {
        SessionSendAck(
            clientMessageId = clientMessageId,
            status = SessionSendAck.SendStatus.REJECTED,
            attachments = attachments,
            error = value.optString("error").ifBlank { "Message was rejected" },
            retryable = value.optBoolean("retryable", false),
        )
    }
}

private fun JSONObject.optLongOrNull(key: String): Long? =
    takeIf { has(key) && !isNull(key) }?.optLong(key)
