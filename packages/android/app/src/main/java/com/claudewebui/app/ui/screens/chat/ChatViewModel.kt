package com.claudewebui.app.ui.screens.chat

import android.content.Context
import android.net.Uri
import android.os.Build
import android.util.Base64
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiHttpException
import com.claudewebui.app.core.network.BufferedMessage
import com.claudewebui.app.core.network.ConnectionState
import com.claudewebui.app.core.network.SocketManager
import com.claudewebui.app.data.local.entity.OutboxEntity
import com.claudewebui.app.data.local.entity.OutboxStatus
import com.claudewebui.app.data.local.entity.SessionReadStateEntity
import com.claudewebui.app.data.model.*
import com.claudewebui.app.data.repository.MessageHistoryPage
import com.claudewebui.app.data.repository.MessageRepository
import com.claudewebui.app.data.repository.SessionRepository
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

private val socketJson = Json { ignoreUnknownKeys = true; coerceInputValues = true }

class ChatViewModel(
    private val sessionId: String,
    private val messageRepository: MessageRepository,
    private val sessionRepository: SessionRepository,
    private val settingsRepository: com.claudewebui.app.data.repository.SettingsRepository,
    private val socketManager: SocketManager,
    private val api: com.claudewebui.app.core.network.ApiClient,
    private val appContext: Context,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    private val selectedChatId = MutableStateFlow<String?>(null)

    /** Room-backed message list — auto-updates as messages arrive */
    val messages: StateFlow<List<Message>> = selectedChatId
        .flatMapLatest { chatId -> messageRepository.getMessages(sessionId, chatId) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** Pending/accepted/failed sends survive process death and reconnects. */
    val outbox: StateFlow<List<OutboxEntity>> = messageRepository.getOutbox(sessionId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val readState: StateFlow<SessionReadStateEntity?> = messageRepository.getReadState(sessionId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Room-backed session info */
    val session: StateFlow<Session?> = sessionRepository.observeSession(sessionId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private fun observeSessionMode() {
        session
            .mapNotNull { it?.mode }
            .distinctUntilChanged()
            .onEach { mode -> _uiState.update { it.copy(sessionMode = mode) } }
            .launchIn(viewModelScope)
    }

    private fun observeReadState() {
        readState
            .filterNotNull()
            .onEach { state ->
                _uiState.update {
                    it.copy(
                        lastReadMessageId = state.lastReadMessageId,
                        unreadCount = state.unreadCount,
                        restoreAnchorMessageId = state.scrollAnchorMessageId,
                        restoreAnchorOffset = state.scrollOffset,
                    )
                }
            }
            .launchIn(viewModelScope)
    }

    private fun reconcileOutboxWithMessages() {
        combine(messages, outbox) { cached, queued -> cached to queued }
            .onEach { (cached, queued) ->
                val clientIds = cached.mapNotNullTo(hashSetOf()) { it.clientMessageId }
                val messageIds = cached.mapTo(hashSetOf()) { it.id }
                queued.asSequence()
                    .filter { item ->
                        item.clientMessageId in clientIds ||
                            (item.messageId != null && item.messageId in messageIds)
                    }
                    .forEach { messageRepository.removeOutbox(it.clientMessageId) }
            }
            .launchIn(viewModelScope)
    }

    private val deviceId: String by lazy {
        val preferences = appContext.getSharedPreferences("chat_device", Context.MODE_PRIVATE)
        preferences.getString("device_id", null) ?: UUID.randomUUID().toString().also {
            preferences.edit().putString("device_id", it).apply()
        }
    }

    private fun requestReconnect() {
        val sequence = readState.value?.lastSeenSequence?.takeIf { it > 0 }
        socketManager.reconnectSession(sessionId, lastSequence = sequence)
    }

    private fun startPresenceHeartbeat() {
        presenceJob?.cancel()
        presenceJob = viewModelScope.launch {
            while (isActive) {
                socketManager.updatePresence(
                    sessionId = sessionId,
                    deviceId = deviceId,
                    label = Build.MODEL.takeIf { it.isNotBlank() },
                    state = "active",
                    lastReadMessageId = null,
                )
                delay(PRESENCE_HEARTBEAT_MS)
            }
        }
    }

    private var draftSaveJob: Job? = null
    private var initializationJob: Job? = null
    private var limitsJob: Job? = null
    private var searchJob: Job? = null
    private var readSaveJob: Job? = null
    private var presenceJob: Job? = null
    private val deliveryJobs = ConcurrentHashMap<String, Job>()
    private var viewportAtBottom = true
    private var announcedHighWatermark = 0L
    private var isSessionReady = false
    private val streamingDeltas = StreamingDeltaAccumulator()
    private var streamingFlushJob: Job? = null

    init {
        observeConnectionState()
        observeSessionMode()
        observeReadState()
        reconcileOutboxWithMessages()
        observeProviderLimits()
        observeTodos()
        loadSlashCommands()
        loadStyleLibrary()
        syncRemoteDraft()
        loadTurnDiffs()
        loadMeshPeers()
        probeVoiceInput()
        initializeChat()
    }

    /** Backs the composer's `/` picker; a failure just leaves it empty. */
    private fun loadSlashCommands() {
        viewModelScope.launch {
            settingsRepository.getCommands().onSuccess { commands ->
                _uiState.update { it.copy(slashCommands = commands) }
            }
        }
    }

    /** Presentation presets for the session settings sheet. */
    private fun loadStyleLibrary() {
        viewModelScope.launch {
            settingsRepository.getStyleLibrary().onSuccess { library ->
                _uiState.update {
                    it.copy(
                        designStyles = library.designStyles,
                        writingStyles = library.writingStyles,
                    )
                }
            }
        }
    }

    /** Apply or clear a presentation preset for this session. */
    fun setStyleSkill(kind: StyleKind, skill: String?) {
        applySessionChange("Style preset updated") {
            sessionRepository.setStyleSkill(sessionId, kind, skill)
        }
    }

    // ========================================================================
    // Initial Load
    // ========================================================================

    private fun initializeChat() {
        if (initializationJob?.isActive == true) return
        initializationJob = viewModelScope.launch {
            _uiState.update { it.copy(isLoadingHistory = true) }
            loadSessionThenMessages(
                loadSession = { sessionRepository.getSession(sessionId).map { } },
                onSessionLoaded = {
                    isSessionReady = true
                    observeSocketEvents()
                    loadDraft()
                    loadAllowedDirectories()
                    loadChats()
                    startPresenceHeartbeat()
                    if (socketManager.connectionState.value == ConnectionState.CONNECTED) {
                        socketManager.subscribeToSession(sessionId)
                        requestReconnect()
                        retryPendingOutbox()
                    }
                },
                loadMessages = {
                    messageRepository.fetchMessages(sessionId, clearExisting = true)
                        .onSuccess(::applyInitialHistoryPage)
                        .map { }
                },
            )
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
            _uiState.update { it.copy(isLoadingHistory = false) }
        }
    }

    private suspend fun loadDraft() {
        val draft = messageRepository.getDraft(sessionId) ?: ""
        _uiState.update { it.copy(draftText = draft) }
    }

    private fun loadMessages() {
        if (!isSessionReady) {
            initializeChat()
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingHistory = true) }
            messageRepository.fetchMessages(
                sessionId,
                clearExisting = true,
                chatId = _uiState.value.activeChatId,
            )
                .onSuccess(::applyInitialHistoryPage)
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
            _uiState.update { it.copy(isLoadingHistory = false) }
        }
    }

    // ========================================================================
    // Provider account limits
    // ========================================================================

    /** Reload the quota whenever the session's provider appears or changes. */
    /** Agent task list for this session; other sessions' todos are ignored. */
    private fun observeTodos() {
        socketManager.todos
            .onEach { (eventSessionId, todos) ->
                if (eventSessionId != sessionId) return@onEach
                _uiState.update { it.copy(todos = todos) }
            }
            .launchIn(viewModelScope)
    }

    private fun observeProviderLimits() {
        session
            .mapNotNull { it?.cliProvider }
            .distinctUntilChanged()
            .onEach { loadProviderLimits() }
            .launchIn(viewModelScope)
    }

    /**
     * Live account quota (5h/weekly windows) of the active provider. Providers
     * without an account of their own (OpenCode, Pi) answer `supported: false`
     * and the row simply stays hidden.
     */
    fun loadProviderLimits() {
        val provider = session.value?.cliProvider ?: return
        limitsJob?.cancel()
        limitsJob = viewModelScope.launch {
            val response = runCatching { api.getUsageLimits(provider.name.lowercase()) }.getOrNull()
            // An unreachable endpoint says nothing about the account — keep
            // whatever was shown rather than blanking the row.
            if (response != null) {
                _uiState.update {
                    it.copy(providerLimits = response.data.takeIf { _ -> response.supported })
                }
            }
        }
    }

    /**
     * App returned to the foreground. A socket revived from Doze can be a
     * zombie — still claiming connected while the server dropped it — so the
     * message history refreshes over REST unconditionally and the socket layer
     * re-joins the session room.
     */
    fun onResumed() {
        if (!isSessionReady) return
        socketManager.ensureConnected()
        viewModelScope.launch {
            messageRepository.fetchMessages(
                sessionId,
                clearExisting = true,
                chatId = _uiState.value.activeChatId,
            )
                .onSuccess(::applyInitialHistoryPage)
        }
        if (socketManager.connectionState.value == ConnectionState.CONNECTED) {
            socketManager.subscribeToSession(sessionId)
            requestReconnect()
            retryPendingOutbox()
        }
        loadChats()
        loadProviderLimits()
    }

    // ========================================================================
    // Socket Connection & Events
    // ========================================================================

    private fun observeConnectionState() {
        var wasConnected = socketManager.connectionState.value == ConnectionState.CONNECTED
        socketManager.connectionState
            .onEach { state ->
                val isConnected = state == ConnectionState.CONNECTED
                if (!isConnected) {
                    // Without this the composer stays locked on "Agent is
                    // working…" forever after a network drop.
                    _uiState.update {
                        it.copy(
                            isConnected = false,
                            isSending = false,
                            isThinking = false,
                            streamingState = StreamingState.Idle,
                        )
                    }
                } else {
                    _uiState.update { it.copy(isConnected = true) }
                    if (isSessionReady) {
                        socketManager.subscribeToSession(sessionId)
                        // session:reconnect re-joins the room and reports the
                        // running state; the REST refetch recovers messages
                        // produced while the app was offline.
                        requestReconnect()
                        retryPendingOutbox()
                        if (wasConnected.not()) {
                            viewModelScope.launch {
                                messageRepository.fetchMessages(
                                    sessionId,
                                    clearExisting = true,
                                    chatId = _uiState.value.activeChatId,
                                )
                                    .onSuccess(::applyInitialHistoryPage)
                            }
                        }
                    }
                }
                wasConnected = isConnected
            }
            .launchIn(viewModelScope)
    }

    private fun observeSocketEvents() {
        // Streaming text deltas are flushed at most every 50 ms. Some CLIs
        // emit hundreds of tiny chunks per second; recomposing markdown for
        // every one causes visible jank on phones.
        socketManager.output
            .filter { it.sessionId == sessionId && belongsToActiveChat(it.chatId) }
            .onEach { streaming ->
                adoptIncomingChat(streaming.chatId)
                enqueueStreamingDelta(streaming.content)
            }
            .launchIn(viewModelScope)

        // Complete persisted messages — cache in Room and clear streaming state
        socketManager.messages
            .filter { it.sessionId == sessionId && belongsToActiveChat(it.chatId) }
            .onEach { message ->
                clearStreamingDeltas()
                val incomingChatId = adoptIncomingChat(message.chatId)
                messageRepository.cacheMessage(message, incomingChatId)
                handleIncomingMessageReadState(message)
                commitAppliedSequence(message.eventSequence)
                _uiState.update { state ->
                    state.copy(
                        streamingState = StreamingState.Idle,
                        isSending = false,
                    )
                }
            }
            .launchIn(viewModelScope)

        // Replay only the missing monotone events after a reconnect. If the
        // server's bounded buffer rolled over, REST becomes authoritative.
        socketManager.reconnected
            .filter { it.sessionId == sessionId }
            .onEach { event ->
                if (event.needsFullResync) {
                    messageRepository.fetchMessages(
                        sessionId,
                        clearExisting = true,
                        chatId = _uiState.value.activeChatId,
                    ).onSuccess { page ->
                        applyInitialHistoryPage(page)
                        commitAppliedSequence(
                            page.snapshot?.highWatermark,
                            page.snapshot?.revision,
                        )
                    }.onFailure { error ->
                        _uiState.update { it.copy(error = error.message) }
                    }
                } else {
                    val currentSequence = messageRepository.cachedReadState(sessionId)
                        ?.lastSeenSequence ?: 0L
                    var lastApplied = currentSequence
                    var replayComplete = true
                    event.bufferedMessages
                        .sortedWith(compareBy<BufferedMessage> { it.sequence ?: Long.MAX_VALUE }
                            .thenBy { it.timestamp })
                        .filter { (it.sequence ?: Long.MAX_VALUE) > currentSequence }
                        .forEach { item ->
                            if (replayComplete && handleBufferedMessage(item)) {
                                item.sequence?.let { lastApplied = maxOf(lastApplied, it) }
                            } else {
                                replayComplete = false
                            }
                        }
                    if (replayComplete) {
                        commitAppliedSequence(lastApplied, event.snapshotRevision)
                    } else {
                        messageRepository.fetchMessages(
                            sessionId,
                            clearExisting = true,
                            chatId = _uiState.value.activeChatId,
                        ).onSuccess { page ->
                            applyInitialHistoryPage(page)
                            commitAppliedSequence(
                                page.snapshot?.highWatermark,
                                page.snapshot?.revision,
                            )
                        }.onFailure { error ->
                            _uiState.update { it.copy(error = error.message) }
                        }
                    }
                }
            }
            .launchIn(viewModelScope)

        socketManager.cursor
            .filter { (id, _) -> id == sessionId }
            .onEach { (_, sequence) ->
                // This is only an announcement. The durable cursor advances
                // after the corresponding event/snapshot has been applied.
                announcedHighWatermark = maxOf(announcedHighWatermark, sequence)
            }
            .launchIn(viewModelScope)

        socketManager.presence
            .filter { it.sessionId == sessionId }
            .onEach { snapshot ->
                _uiState.update { it.copy(presenceViewers = snapshot.viewers) }
            }
            .launchIn(viewModelScope)

        // Thinking indicator. A mid-turn thinking=true (agent start, Pi
        // compaction) must not discard streaming text already on screen.
        socketManager.thinking
            .filter { it.sessionId == sessionId }
            .onEach { event ->
                _uiState.update { state ->
                    state.copy(
                        isThinking = event.isThinking,
                        thinkingLabel = if (event.isThinking) event.message else null,
                        thinkingStartTime = if (event.isThinking) System.currentTimeMillis() else 0L,
                        streamingState = if (event.isThinking && state.streamingState !is StreamingState.Streaming) {
                            StreamingState.Idle
                        } else {
                            state.streamingState
                        },
                    )
                }
            }
            .launchIn(viewModelScope)

        // Tool use events
        socketManager.toolUse
            .filter { it.sessionId == sessionId }
            .onEach { event ->
                handleToolEvent(event)
            }
            .launchIn(viewModelScope)

        // Agent events
        socketManager.agent
            .filter { it.sessionId == sessionId }
            .onEach { event ->
                when (event.status) {
                    ToolStatus.STARTED -> _uiState.update { state ->
                        state.copy(
                            streamingState = StreamingState.AgentRunning(
                                event.agentType,
                                event.description,
                            ),
                            isThinking = false,
                        )
                    }
                    ToolStatus.COMPLETED, ToolStatus.ERROR -> _uiState.update { state ->
                        if (state.streamingState is StreamingState.AgentRunning)
                            state.copy(streamingState = StreamingState.Idle)
                        else state
                    }
                }
            }
            .launchIn(viewModelScope)

        // Usage data
        socketManager.usage
            .filter { it.sessionId == sessionId }
            .onEach { usage ->
                _uiState.update { it.copy(usageData = usage) }
            }
            .launchIn(viewModelScope)

        // Session status changes
        socketManager.status
            .filter { (id, _) -> id == sessionId }
            .onEach { (_, status) ->
                if (status == SessionStatus.STOPPED || status == SessionStatus.ERROR) {
                    _uiState.update { state ->
                        state.copy(
                            streamingState = StreamingState.Idle,
                            isThinking = false,
                            isSending = false,
                        )
                    }
                }
                // Refresh session in Room
                sessionRepository.getSession(sessionId)
            }
            .launchIn(viewModelScope)

        // Error events
        socketManager.errors
            .filter { (id, _) -> id == sessionId }
            .onEach { (_, error) ->
                _uiState.update { state ->
                    state.copy(
                        error = error,
                        streamingState = StreamingState.Idle,
                        isThinking = false,
                        isSending = false,
                    )
                }
            }
            .launchIn(viewModelScope)

        // Server-side mode is authoritative; reconciles optimistic taps and
        // server-initiated changes.
        socketManager.mode
            .filter { (id, _) -> id == sessionId }
            .onEach { (_, mode) -> _uiState.update { it.copy(sessionMode = mode) } }
            .launchIn(viewModelScope)

        // Queue state — messages accepted while the CLI is busy would
        // otherwise silently vanish from the UI until they run.
        socketManager.queue
            .filter { it.sessionId == sessionId }
            .onEach { event ->
                _uiState.update { it.copy(queuedCount = event.depth, isSending = false) }
            }
            .launchIn(viewModelScope)

        // Compaction/clear — the server discarded the transcript context, so
        // the local cache must follow or the visible history lies.
        socketManager.compact
            .filter { it.sessionId == sessionId }
            .onEach { event ->
                if (event.clear == true) {
                    messageRepository.fetchMessages(
                        sessionId,
                        clearExisting = true,
                        chatId = _uiState.value.activeChatId,
                    )
                        .onSuccess(::applyInitialHistoryPage)
                }
                _uiState.update { it.copy(settingsNotice = event.message) }
            }
            .launchIn(viewModelScope)

        // OpenCode question prompts — without this the session stalls silently.
        socketManager.question
            .filter { it.sessionId == sessionId }
            .onEach { event ->
                _uiState.update { it.copy(pendingQuestion = event, isThinking = false) }
                commitAppliedSequence(event.eventSequence)
            }
            .launchIn(viewModelScope)

        // Permission prompts, both wire formats.
        socketManager.permission
            .onEach { element ->
                val applied = applyPermissionElement(element)
                if (applied.first) commitAppliedSequence(applied.second)
            }
            .launchIn(viewModelScope)
    }

    private suspend fun handleBufferedMessage(item: BufferedMessage): Boolean = when (item.type) {
            "message" -> runCatching {
                socketJson.decodeFromJsonElement(Message.serializer(), item.data)
            }.getOrNull()?.let { message ->
                if (!belongsToActiveChat(message.chatId)) return@let false
                val incomingChatId = adoptIncomingChat(message.chatId)
                messageRepository.cacheMessage(message, incomingChatId)
                handleIncomingMessageReadState(message)
                true
            } ?: false
            "output" -> runCatching {
                socketJson.decodeFromJsonElement(StreamingMessage.serializer(), item.data)
            }.getOrNull()?.let {
                if (!belongsToActiveChat(it.chatId)) return@let false
                adoptIncomingChat(it.chatId)
                enqueueStreamingDelta(it.content)
                true
            } ?: false
            "thinking" -> runCatching {
                val obj = item.data.jsonObject
                val active = obj["isThinking"]?.jsonPrimitive?.content?.toBooleanStrictOrNull() ?: false
                val label = obj["message"]?.jsonPrimitive?.content
                _uiState.update {
                    it.copy(
                        isThinking = active,
                        thinkingLabel = label,
                        thinkingStartTime = if (active) System.currentTimeMillis() else 0L,
                    )
                }
                true
            }.getOrDefault(false)
            "question", "question_request", "session:question_request" -> runCatching {
                socketJson.decodeFromJsonElement(QuestionRequestEvent.serializer(), item.data)
            }.getOrNull()?.takeIf { it.sessionId == sessionId }?.let { request ->
                _uiState.update { it.copy(pendingQuestion = request, isThinking = false) }
                true
            } ?: false
            "permission_request", "permission", "session:permission_request" ->
                applyPermissionElement(item.data).first
            // These event types are already represented by newer REST/session
            // state or are non-durable UI hints; consuming them is idempotent.
            "status", "tool_use", "agent", "mode", "compact", "todos", "usage" -> true
            else -> false
        }

    private fun applyPermissionElement(
        element: kotlinx.serialization.json.JsonElement,
    ): Pair<Boolean, Long?> {
        val obj = element as? kotlinx.serialization.json.JsonObject ?: return false to null
        val sid = (obj["sessionId"] as? kotlinx.serialization.json.JsonPrimitive)?.content
        if (sid != sessionId) return false to null
        if (obj.containsKey("requestId")) {
            val request = runCatching {
                socketJson.decodeFromJsonElement(PermissionRequest.serializer(), obj)
            }.getOrNull() ?: return false to null
            _uiState.update { it.copy(pendingPermission = request, isThinking = false) }
            return true to request.eventSequence
        }
        if (obj.containsKey("denials")) {
            val request = runCatching {
                socketJson.decodeFromJsonElement(PermissionRequestData.serializer(), obj)
            }.getOrNull() ?: return false to null
            _uiState.update { it.copy(pendingLegacyPermission = request, isThinking = false) }
            return true to request.eventSequence
        }
        return false to null
    }

    private fun belongsToActiveChat(chatId: String?): Boolean {
        val active = _uiState.value.activeChatId
        return chatId == null || active == null || chatId == active
    }

    private fun adoptIncomingChat(chatId: String?): String? {
        val active = _uiState.value.activeChatId
        if (active == null && chatId != null) {
            selectedChatId.value = chatId
            _uiState.update { it.copy(activeChatId = chatId) }
            return chatId
        }
        return active
    }

    private suspend fun commitAppliedSequence(sequence: Long?, snapshotRevision: Long? = null) {
        if (sequence == null && snapshotRevision == null) return
        val current = messageRepository.cachedReadState(sessionId)
            ?: SessionReadStateEntity(sessionId)
        messageRepository.saveReadState(
            current.copy(
                lastSeenSequence = maxOf(current.lastSeenSequence, sequence ?: 0L),
                highWatermark = maxOf(current.highWatermark, sequence ?: 0L),
                snapshotRevision = maxOf(current.snapshotRevision, snapshotRevision ?: 0L),
            )
        )
    }

    private suspend fun handleIncomingMessageReadState(message: Message) {
        val current = messageRepository.cachedReadState(sessionId)
            ?: SessionReadStateEntity(sessionId)
        if (viewportAtBottom) {
            messageRepository.markRead(sessionId, current.chatId, message.id)
                .onFailure {
                    messageRepository.saveReadState(
                        current.copy(lastReadMessageId = message.id, unreadCount = 0)
                    )
                }
        } else if (message.role == MessageRole.ASSISTANT) {
            messageRepository.saveReadState(current.copy(unreadCount = current.unreadCount + 1))
        }
    }

    private fun handleToolEvent(event: ToolExecutionEvent) {
        when (event.status) {
            ToolStatus.STARTED -> {
                val toolId = event.toolId ?: "${event.toolName}_${System.currentTimeMillis()}"
                val tool = ToolExecution(
                    toolId = toolId,
                    toolName = event.toolName,
                    status = ToolStatus.STARTED,
                    input = event.input,
                    timestamp = event.timestamp ?: System.currentTimeMillis(),
                )
                _uiState.update { state ->
                    val updated = state.activeTools.toMutableMap().also { it[toolId] = tool }
                    state.copy(
                        activeTools = updated,
                        streamingState = StreamingState.ToolExecuting(event.toolName, toolId),
                        isThinking = false,
                    )
                }
            }
            ToolStatus.COMPLETED -> {
                val toolId = event.toolId ?: ""
                _uiState.update { state ->
                    val updated = state.activeTools.toMutableMap()
                    updated[toolId]?.let { existing ->
                        updated[toolId] = existing.copy(
                            status = ToolStatus.COMPLETED,
                            result = event.result,
                            completedAt = System.currentTimeMillis(),
                        )
                    }
                    state.copy(
                        activeTools = updated,
                        streamingState = StreamingState.Idle,
                    )
                }
            }
            ToolStatus.ERROR -> {
                val toolId = event.toolId ?: ""
                _uiState.update { state ->
                    val updated = state.activeTools.toMutableMap()
                    updated[toolId]?.let { existing ->
                        updated[toolId] = existing.copy(
                            status = ToolStatus.ERROR,
                            error = event.error,
                            completedAt = System.currentTimeMillis(),
                        )
                    }
                    state.copy(
                        activeTools = updated,
                        streamingState = StreamingState.Idle,
                    )
                }
            }
        }
    }

    private fun applyInitialHistoryPage(page: MessageHistoryPage) {
        selectedChatId.value = page.chatId
        _uiState.update {
            it.copy(
                activeChatId = if (page.snapshot != null) page.chatId else it.activeChatId,
                hasMoreHistory = page.hasMoreBefore,
                hasMoreAfterHistory = page.hasMoreAfter,
                oldestMessageId = page.oldestId,
                newestMessageId = page.newestId,
                totalMessageCount = page.total,
                lastHistoryPageSize = 0,
            )
        }
    }

    private fun enqueueStreamingDelta(delta: String) {
        if (delta.isEmpty()) return
        streamingDeltas.append(delta)
        if (streamingFlushJob?.isActive == true) return
        streamingFlushJob = viewModelScope.launch {
            delay(STREAM_FLUSH_MS)
            val batch = streamingDeltas.drain()
            if (batch.isNotEmpty()) {
                _uiState.update { state ->
                    val current = (state.streamingState as? StreamingState.Streaming)?.partialText.orEmpty()
                    state.copy(
                        streamingState = StreamingState.Streaming(current + batch),
                        isThinking = false,
                        isSending = false,
                    )
                }
            }
        }
    }

    private fun clearStreamingDeltas() {
        streamingFlushJob?.cancel()
        streamingFlushJob = null
        streamingDeltas.drain()
    }

    // ========================================================================
    // User Actions
    // ========================================================================

    fun loadHistory() {
        loadMessages()
    }

    /** Load one older page; Room prepends it without clearing the recent page. */
    fun loadOlderHistory() {
        val state = _uiState.value
        val before = state.oldestMessageId
        if (!state.hasMoreHistory || before == null || state.isLoadingOlderHistory) return

        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingOlderHistory = true) }
            messageRepository.fetchMessages(
                sessionId,
                before = before,
                chatId = state.activeChatId,
            )
                .onSuccess { page ->
                    _uiState.update {
                        it.copy(
                            isLoadingOlderHistory = false,
                            hasMoreHistory = page.hasMore,
                            oldestMessageId = page.oldestId,
                            totalMessageCount = page.total,
                            historyPageVersion = it.historyPageVersion + 1,
                            lastHistoryPageSize = page.messages.size,
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(isLoadingOlderHistory = false, error = error.message)
                    }
                }
        }
    }

    /** Leave an around/search window and atomically restore the live tail. */
    fun restoreLatestHistory() {
        if (_uiState.value.isLoadingHistory) return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingHistory = true) }
            messageRepository.fetchLatestMessages(sessionId, _uiState.value.activeChatId)
                .onSuccess { page ->
                    applyInitialHistoryPage(page)
                    _uiState.update {
                        it.copy(
                            isLoadingHistory = false,
                            jumpTargetMessageId = null,
                            jumpVersion = it.jumpVersion + 1,
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(isLoadingHistory = false, error = error.message) }
                }
        }
    }

    fun setSearchOpen(open: Boolean) {
        _uiState.update {
            it.copy(
                isSearchOpen = open,
                searchQuery = if (open) it.searchQuery else "",
                searchResults = if (open) it.searchResults else emptyList(),
                searchError = null,
            )
        }
        if (!open) searchJob?.cancel()
    }

    fun onSearchQueryChange(query: String) {
        _uiState.update { it.copy(searchQuery = query, searchError = null) }
        searchJob?.cancel()
        if (query.trim().length < 2) {
            _uiState.update { it.copy(searchResults = emptyList(), isSearching = false) }
            return
        }
        searchJob = viewModelScope.launch {
            delay(SEARCH_DEBOUNCE_MS)
            _uiState.update { it.copy(isSearching = true) }
            runCatching { api.searchSessionMessages(sessionId, query.trim()) }
                .onSuccess { response ->
                    _uiState.update {
                        it.copy(
                            isSearching = false,
                            searchResults = response.data.orEmpty(),
                            searchError = response.error?.message,
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(isSearching = false, searchError = error.message)
                    }
                }
        }
    }

    fun jumpToMessage(result: MessageSearchResult) {
        jumpToMessage(result.jump?.messageId ?: result.id, result.jump?.chatId)
    }

    fun jumpToMessage(messageId: String, chatId: String? = null) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingHistory = true) }
            // Always re-activate an explicit target: another device may have
            // switched the session-wide active chat since our local snapshot.
            if (chatId != null) {
                val switched = sessionRepository.activateChat(sessionId, chatId)
                if (switched.isFailure) {
                    _uiState.update {
                        it.copy(
                            isLoadingHistory = false,
                            searchError = switched.exceptionOrNull()?.message ?: "Couldn't open that chat",
                        )
                    }
                    return@launch
                }
                val list = switched.getOrThrow()
                _uiState.update { state ->
                    state.copy(chats = list.chats, activeChatId = list.activeChatId)
                }
            }
            val targetChatId = chatId ?: _uiState.value.activeChatId
            messageRepository.fetchAroundMessage(sessionId, messageId, targetChatId)
                .onSuccess { page ->
                    applyInitialHistoryPage(page)
                    _uiState.update {
                        it.copy(
                            isLoadingHistory = false,
                            isSearchOpen = false,
                            jumpTargetMessageId = messageId,
                            jumpVersion = it.jumpVersion + 1,
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(isLoadingHistory = false, searchError = error.message)
                    }
                }
        }
    }

    fun onViewportState(
        atBottom: Boolean,
        anchorMessageId: String?,
        anchorOffset: Int,
    ) {
        viewportAtBottom = atBottom
        readSaveJob?.cancel()
        readSaveJob = viewModelScope.launch {
            delay(READ_POSITION_DEBOUNCE_MS)
            val current = messageRepository.cachedReadState(sessionId)
                ?: SessionReadStateEntity(sessionId)
            val newest = messages.value.lastOrNull()?.id
            val local = current.copy(
                scrollAnchorMessageId = anchorMessageId,
                scrollOffset = anchorOffset,
                lastReadMessageId = if (atBottom) newest ?: current.lastReadMessageId
                    else current.lastReadMessageId,
                unreadCount = if (atBottom) 0 else current.unreadCount,
            )
            messageRepository.saveReadState(local)
            if (atBottom && newest != null) {
                messageRepository.markRead(sessionId, local.chatId, newest)
            }
            socketManager.updatePresence(
                sessionId = sessionId,
                deviceId = deviceId,
                label = Build.MODEL.takeIf { it.isNotBlank() },
                state = "active",
                lastReadMessageId = null,
            )
        }
    }

    fun sendMessage(content: String) {
        val attachments = _uiState.value.pendingAttachments.takeIf { it.isNotEmpty() }
        if (content.isBlank() && attachments.isNullOrEmpty()) return
        if (!isSessionReady) {
            _uiState.update { it.copy(error = "Session is still loading") }
            return
        }
        val trimmed = content.trim()
        val clientMessageId = UUID.randomUUID().toString()
        val persistedAttachments = attachments.orEmpty().map {
            PersistedOutboxAttachment(
                uri = it.uri,
                mimeType = it.mimeType,
                filename = it.filename,
                sizeBytes = it.sizeBytes,
            )
        }
        val item = OutboxEntity(
            clientMessageId = clientMessageId,
            sessionId = sessionId,
            chatId = _uiState.value.activeChatId,
            content = trimmed,
            attachmentsJson = OutboxEntity.attachmentsJson(persistedAttachments),
            activeFollowupMode = _uiState.value.activeFollowupMode.name,
            status = OutboxStatus.SENDING.name,
        )
        viewModelScope.launch {
            // The composer clears only after the message is durable in Room.
            // A process death or transport loss can therefore never erase it.
            messageRepository.putOutbox(item)
            clearDraft()
            _uiState.update {
                it.copy(
                    isSending = true,
                    draftText = "",
                    pendingAttachments = emptyList(),
                    isPreparingAttachments = persistedAttachments.isNotEmpty(),
                    attachmentPreparationProgress = 0f,
                    activeDeliveryId = clientMessageId,
                )
            }
            deliverOutbox(item)
        }
    }

    fun setActiveFollowupMode(mode: ActiveFollowupMode) {
        _uiState.update { it.copy(activeFollowupMode = mode) }
    }

    fun retryOutbox(clientMessageId: String) {
        viewModelScope.launch {
            val item = messageRepository.getOutboxItem(clientMessageId) ?: return@launch
            val retry = prepareOutboxRetry(item)
            messageRepository.putOutbox(retry)
            deliverOutbox(retry)
        }
    }

    private fun retryPendingOutbox() {
        if (socketManager.connectionState.value != ConnectionState.CONNECTED) return
        viewModelScope.launch {
            messageRepository.pendingOutbox(sessionId)
                .filter { it.retryable || it.deliveryStatus == OutboxStatus.SENDING }
                .forEach(::deliverOutbox)
            messageRepository.pruneAcceptedOutbox(System.currentTimeMillis() - OUTBOX_ACCEPTED_RETENTION_MS)
        }
    }

    private fun deliverOutbox(item: OutboxEntity) {
        if (deliveryJobs[item.clientMessageId]?.isActive == true) return
        deliveryJobs[item.clientMessageId] = viewModelScope.launch {
            try {
                if (socketManager.connectionState.value != ConnectionState.CONNECTED) {
                    failOutbox(item, "Saved to outbox — it will retry when reconnected", true)
                    return@launch
                }
                _uiState.update {
                    it.copy(
                        isSending = true,
                        isPreparingAttachments = item.attachments.isNotEmpty(),
                        activeDeliveryId = item.clientMessageId,
                    )
                }
                val prepared = prepareDelivery(item)
                val latest = messageRepository.getOutboxItem(item.clientMessageId) ?: item
                val acknowledgement = socketManager.sendMessage(
                    sessionId = sessionId,
                    chatId = item.chatId,
                    message = item.content,
                    images = prepared.legacyAttachments.takeIf { it.isNotEmpty() },
                    clientMessageId = item.clientMessageId,
                    uploadIds = prepared.uploadIds,
                    activeFollowupMode = item.followupMode,
                )
                if (acknowledgement.status == SessionSendAck.SendStatus.ACCEPTED) {
                    val alreadyPersisted = messages.value.any { message ->
                        message.clientMessageId == item.clientMessageId ||
                            (acknowledgement.messageId != null && message.id == acknowledgement.messageId)
                    }
                    if (alreadyPersisted) {
                        messageRepository.removeOutbox(item.clientMessageId)
                    } else {
                        messageRepository.putOutbox(
                            latest.copy(
                                status = OutboxStatus.ACCEPTED.name,
                                progress = 1f,
                                error = null,
                                retryable = false,
                                acceptedAt = acknowledgement.acceptedAt,
                                messageId = acknowledgement.messageId,
                                disposition = acknowledgement.disposition,
                                highWatermark = acknowledgement.highWatermark,
                                uploadIdsJson = OutboxEntity.uploadIdsJson(prepared.uploadIds),
                            )
                        )
                    }
                    acknowledgement.highWatermark?.let { sequence ->
                        val read = messageRepository.cachedReadState(sessionId)
                            ?: SessionReadStateEntity(sessionId)
                        messageRepository.saveReadState(
                            read.copy(highWatermark = maxOf(read.highWatermark, sequence))
                        )
                    }
                } else {
                    failOutbox(
                        latest,
                        acknowledgement.error ?: "Message was rejected",
                        acknowledgement.retryable,
                    )
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Throwable) {
                failOutbox(item, failure.message ?: "Delivery failed", true)
            } finally {
                deliveryJobs.remove(item.clientMessageId)
                _uiState.update { state ->
                    if (state.activeDeliveryId == item.clientMessageId) {
                        state.copy(
                            isSending = false,
                            isPreparingAttachments = false,
                            attachmentPreparationProgress = 0f,
                            activeDeliveryId = null,
                        )
                    } else state
                }
            }
        }
    }

    private suspend fun failOutbox(item: OutboxEntity, error: String, retryable: Boolean) {
        val latest = messageRepository.getOutboxItem(item.clientMessageId) ?: item
        messageRepository.putOutbox(
            latest.copy(
                status = OutboxStatus.FAILED.name,
                error = error,
                retryable = retryable,
            )
        )
    }

    fun cancelDelivery(clientMessageId: String) {
        deliveryJobs.remove(clientMessageId)?.cancel()
        viewModelScope.launch {
            val item = messageRepository.getOutboxItem(clientMessageId) ?: return@launch
            item.uploadIds.forEach { uploadId ->
                runCatching { api.cancelChatUpload(sessionId, uploadId) }
            }
            failOutbox(item, "Upload cancelled", true)
            _uiState.update {
                it.copy(
                    isSending = false,
                    isPreparingAttachments = false,
                    attachmentPreparationProgress = 0f,
                    activeDeliveryId = null,
                )
            }
        }
    }

    private suspend fun prepareDelivery(item: OutboxEntity): PreparedDelivery = withContext(Dispatchers.IO) {
        if (item.attachments.isEmpty()) return@withContext PreparedDelivery(emptyList(), emptyList())
        var totalBytes = 0L
        val allBytes = item.attachments.map { attachment ->
            val remaining = (MAX_TOTAL_ATTACHMENT_BYTES - totalBytes).coerceAtLeast(0)
            val bytes = readUriWithLimit(
                appContext,
                Uri.parse(attachment.uri),
                minOf(MAX_ATTACHMENT_BYTES, remaining),
            )
            totalBytes += bytes.size
            bytes
        }

        var updatedAttachments = item.attachments
        val uploadIds = mutableListOf<String>()
        try {
            item.attachments.forEachIndexed { attachmentIndex, original ->
                val bytes = allBytes[attachmentIndex]
                var upload = original.uploadId?.let { id ->
                    runCatching { api.getChatUpload(sessionId, id) }.getOrNull()?.data
                }
                if (upload == null || upload.status == "cancelled" || upload.status == "failed") {
                    val response = api.createChatUpload(
                        sessionId,
                        CreateChatUploadInput(
                            filename = original.filename,
                            mimeType = original.mimeType,
                            byteSize = bytes.size.toLong(),
                            sha256 = sha256Hex(bytes),
                        ),
                    )
                    if (!response.success || response.data == null) {
                        error(response.error?.message ?: "Couldn't start upload")
                    }
                    upload = response.data
                }

                val initial = requireNotNull(upload)
                val missing = when {
                    initial.status == "complete" -> emptyList()
                    initial.missingChunks.isNotEmpty() -> initial.missingChunks
                    else -> (0 until initial.totalChunks).toList()
                }
                var latest = initial
                for (chunkIndex in missing) {
                    ensureActive()
                    val range = chunkByteRange(chunkIndex, initial.chunkSize, bytes.size) ?: continue
                    val start = range.first
                    val end = range.last + 1
                    val response = api.putChatUploadChunk(
                        sessionId = sessionId,
                        uploadId = initial.id,
                        index = chunkIndex,
                        bytes = bytes.copyOfRange(start, end),
                        byteOffset = start.toLong(),
                        totalBytes = bytes.size.toLong(),
                    )
                    if (!response.success || response.data == null) {
                        error(response.error?.message ?: "Couldn't upload ${original.filename}")
                    }
                    latest = response.data
                    val overallProgress = (
                        attachmentIndex + latest.progress.coerceIn(0f, 1f)
                    ) / item.attachments.size.toFloat()
                    updatedAttachments = updatedAttachments.toMutableList().also { list ->
                        list[attachmentIndex] = original.copy(
                            uploadId = latest.id,
                            progress = latest.progress,
                            uploadedChunks = latest.receivedChunks,
                            totalChunks = latest.totalChunks,
                            error = latest.error,
                        )
                    }
                    val persisted = (messageRepository.getOutboxItem(item.clientMessageId) ?: item).copy(
                        attachmentsJson = OutboxEntity.attachmentsJson(updatedAttachments),
                        uploadIdsJson = OutboxEntity.uploadIdsJson(uploadIds + latest.id),
                        progress = overallProgress,
                    )
                    messageRepository.putOutbox(persisted)
                    _uiState.update {
                        it.copy(attachmentPreparationProgress = overallProgress)
                    }
                }
                if (latest.status != "complete") {
                    val refreshed = api.getChatUpload(sessionId, latest.id)
                    latest = refreshed.data ?: latest
                }
                if (latest.status != "complete") {
                    error(latest.error ?: "Upload did not complete")
                }
                uploadIds += latest.id
                updatedAttachments = updatedAttachments.toMutableList().also { list ->
                    list[attachmentIndex] = original.copy(
                        uploadId = latest.id,
                        progress = 1f,
                        uploadedChunks = latest.receivedChunks,
                        totalChunks = latest.totalChunks,
                    )
                }
            }
            messageRepository.putOutbox(
                (messageRepository.getOutboxItem(item.clientMessageId) ?: item).copy(
                    attachmentsJson = OutboxEntity.attachmentsJson(updatedAttachments),
                    uploadIdsJson = OutboxEntity.uploadIdsJson(uploadIds),
                    progress = 1f,
                )
            )
            PreparedDelivery(uploadIds, emptyList())
        } catch (failure: ApiHttpException) {
            if (failure.status != 404 && failure.status != 405) throw failure
            // Compatibility with servers predating staged uploads.
            PreparedDelivery(
                uploadIds = emptyList(),
                legacyAttachments = item.attachments.mapIndexed { index, attachment ->
                    FileAttachmentData(
                        data = Base64.encodeToString(allBytes[index], Base64.NO_WRAP),
                        mimeType = attachment.mimeType,
                        filename = attachment.filename,
                    )
                },
            )
        }
    }

    fun addAttachments(attachments: List<PendingFileAttachment>) {
        if (attachments.isEmpty()) return
        _uiState.update { state ->
            val availableSlots = (MAX_ATTACHMENT_COUNT - state.pendingAttachments.size).coerceAtLeast(0)
            val accepted = attachments.take(availableSlots)
            val combined = state.pendingAttachments + accepted
            val withinTotal = mutableListOf<PendingFileAttachment>()
            var total = 0L
            combined.forEach { item ->
                val size = item.sizeBytes ?: 0L
                if (total + size <= MAX_TOTAL_ATTACHMENT_BYTES) {
                    withinTotal += item
                    total += size
                }
            }
            state.copy(
                pendingAttachments = withinTotal,
                error = if (withinTotal.size < combined.size || accepted.size < attachments.size) {
                    "Up to $MAX_ATTACHMENT_COUNT files and ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} total can be attached"
                } else state.error,
            )
        }
    }

    fun removeAttachment(index: Int) {
        _uiState.update { state ->
            if (index !in state.pendingAttachments.indices) return@update state
            state.copy(
                pendingAttachments = state.pendingAttachments
                    .toMutableList()
                    .apply { removeAt(index) },
            )
        }
    }

    fun reportAttachmentFailure(failed: Int, total: Int) {
        if (failed <= 0) return
        val message = when {
            total == 1 -> "Couldn't attach file (too large or unsupported)"
            failed == total -> "Couldn't attach $failed files (too large or unsupported)"
            else -> "$failed of $total files couldn't be attached"
        }
        _uiState.update { it.copy(error = message) }
    }

    suspend fun fetchAttachment(mediaId: String): Result<ByteArray> = runCatching {
        api.getSessionMedia(sessionId, mediaId)
    }

    fun interrupt() {
        socketManager.interruptSession(sessionId)
        _uiState.update { state ->
            state.copy(
                streamingState = StreamingState.Idle,
                isThinking = false,
                isSending = false,
            )
        }
    }

    fun updateTitle(newTitle: String) {
        if (newTitle.isBlank()) return
        viewModelScope.launch {
            sessionRepository.updateSession(id = sessionId, name = newTitle)
                .onFailure { _uiState.update { it.copy(error = "Failed to update title") } }
            _uiState.update { it.copy(isEditingTitle = false) }
        }
    }

    fun setEditingTitle(editing: Boolean) {
        _uiState.update { it.copy(isEditingTitle = editing) }
    }

    fun toggleUsageBanner() {
        _uiState.update { it.copy(showUsageBanner = !it.showUsageBanner) }
    }

    fun dismissError() {
        _uiState.update { it.copy(error = null) }
    }

    fun reportError(message: String) {
        _uiState.update { it.copy(error = message) }
    }

    fun clearNotice() {
        _uiState.update { it.copy(notice = null) }
    }

    /** Freeze this session's setup so the same start is one tap away next time. */
    fun saveAsTemplate(name: String) {
        val session = this.session.value ?: return
        viewModelScope.launch {
            runCatching {
                api.createSessionTemplate(
                    CreateSessionTemplateInput(
                        name = name,
                        // The wire format is lowercase with dashes; the enum
                        // names use underscores (AUTO_ACCEPT ↔ auto-accept).
                        cliProvider = session.cliProvider.name.lowercase(),
                        cliModel = session.cliModel,
                        cliReasoning = session.cliReasoning,
                        mode = session.mode.name.lowercase().replace('_', '-'),
                        workingDirectory = session.workingDirectory,
                        designStyleSkill = session.designStyleSkill,
                        writingStyleSkill = session.writingStyleSkill,
                    )
                )
            }.onSuccess {
                _uiState.update { it.copy(notice = "Template “$name” saved") }
            }.onFailure {
                _uiState.update { s -> s.copy(error = it.message ?: "Could not save template") }
            }
        }
    }

    /**
     * Fetch the Markdown transcript and park it in state; the screen owns the
     * actual Intent because only it has a Context.
     */
    fun shareTranscript() {
        val id = session.value?.id ?: sessionId
        viewModelScope.launch {
            _uiState.update { it.copy(isExportingTranscript = true) }
            runCatching { api.exportSessionTranscript(id) }
                .onSuccess { markdown ->
                    _uiState.update {
                        it.copy(isExportingTranscript = false, pendingShareTranscript = markdown)
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            isExportingTranscript = false,
                            error = error.message ?: "Export failed",
                        )
                    }
                }
        }
    }

    fun consumePendingShare() {
        _uiState.update { it.copy(pendingShareTranscript = null) }
    }

    // ========================================================================
    // Input & Draft
    // ========================================================================

    /**
     * Append a message as a Markdown quote to whatever is already typed — the
     * usual way to say "about this part" without retyping it.
     */
    fun quoteIntoDraft(content: String) {
        val quoted = content.trim().lines().joinToString("\n") { "> $it" }
        if (quoted.isBlank()) return
        val current = _uiState.value.draftText
        onInputChange(if (current.isBlank()) "$quoted\n\n" else "${current.trimEnd()}\n\n$quoted\n\n")
    }

    fun onInputChange(text: String) {
        _uiState.update { it.copy(draftText = text) }
        draftSaveJob?.cancel()
        draftSaveJob = viewModelScope.launch {
            delay(500)
            if (!isSessionReady) return@launch
            if (text.isNotEmpty()) {
                messageRepository.saveDraft(sessionId, text)
            } else {
                messageRepository.clearDraft(sessionId)
            }
            // Mirror to the server so the draft follows the account to other
            // devices. Local Room stays authoritative while offline.
            runCatching {
                api.putSessionDraft(sessionId, text, _uiState.value.activeChatId)
            }
        }
    }

    private fun clearDraft() {
        draftSaveJob?.cancel()
        viewModelScope.launch {
            messageRepository.clearDraft(sessionId)
            runCatching { api.putSessionDraft(sessionId, "", _uiState.value.activeChatId) }
        }
    }

    /**
     * Adopt a newer draft written on another device. Only applies when the
     * local composer is empty, so it can never clobber what is being typed.
     */
    private fun syncRemoteDraft() {
        viewModelScope.launch {
            val remote = runCatching {
                api.getSessionDraft(sessionId, _uiState.value.activeChatId).data
            }.getOrNull() ?: return@launch
            val text = remote.content
            if (text.isNotBlank() && _uiState.value.draftText.isBlank()) {
                _uiState.update { it.copy(draftText = text) }
            }
        }
    }

    /** Working-tree changes recorded for the finished turns of this session. */
    private fun loadTurnDiffs() {
        viewModelScope.launch {
            val diffs = runCatching { api.getTurnDiffs(sessionId).data }.getOrNull().orEmpty()
            _uiState.update { it.copy(turnDiffs = diffs) }
        }
    }

    fun openTurnDiff(diffId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(openTurnDiff = null) }
            val detail = runCatching { api.getTurnDiff(diffId).data }.getOrNull()
            _uiState.update { it.copy(openTurnDiff = detail) }
        }
    }

    /** Peer sessions this one can delegate to; empty when the mesh is unused. */
    private fun loadMeshPeers() {
        viewModelScope.launch {
            val peers = runCatching { api.getSessionPeers(sessionId).data }.getOrNull().orEmpty()
            _uiState.update { it.copy(meshPeers = peers) }
        }
    }

    /** Whether the server can transcribe; hides the mic button when it cannot. */
    private fun probeVoiceInput() {
        viewModelScope.launch {
            val available = runCatching {
                val payload = api.transcriptionAvailable().data
                (payload as? kotlinx.serialization.json.JsonObject)
                    ?.get("available")
                    ?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content == "true" }
                    ?: false
            }.getOrDefault(false)
            _uiState.update { it.copy(voiceAvailable = available) }
        }
    }

    /** Send the recorded clip for transcription and append the text. */
    fun transcribeAndAppend(audio: ByteArray) {
        viewModelScope.launch {
            _uiState.update { it.copy(isTranscribing = true) }
            val text = runCatching { api.transcribe(audio).data?.text }.getOrNull()
            _uiState.update { state ->
                val merged = when {
                    text.isNullOrBlank() -> state.draftText
                    state.draftText.isBlank() -> text
                    else -> state.draftText.trimEnd() + " " + text
                }
                state.copy(
                    isTranscribing = false,
                    draftText = merged,
                    error = if (text.isNullOrBlank()) "Nothing was recognised" else state.error,
                )
            }
        }
    }

    fun dismissTurnDiff() {
        _uiState.update { it.copy(openTurnDiff = null) }
    }

    // ========================================================================
    // Session settings
    // ========================================================================

    /**
     * Load the model list the active provider offers.
     *
     * The session carries only the chosen model, so the candidate list comes
     * from the CLI provider registry.
     */
    fun loadAvailableModels(providerOverride: CLIProvider? = null) {
        viewModelScope.launch {
            val provider = providerOverride ?: session.value?.cliProvider ?: return@launch
            settingsRepository.getCLIProviders()
                .onSuccess { configs ->
                    val offered = configs
                        .firstOrNull { it.id.equals(provider.name, ignoreCase = true) }
                        ?.models
                        .orEmpty()
                    // The session may run a model the registry no longer lists;
                    // without this it would be invisible and unselectable.
                    val current = session.value?.cliModel
                    val models = if (current.isNullOrBlank() || current in offered) {
                        offered
                    } else {
                        offered + current
                    }
                    _uiState.update { it.copy(availableModels = models) }
                }
                .onFailure { failure ->
                    _uiState.update {
                        it.copy(settingsNotice = "Model list unavailable: ${failure.message}")
                    }
                }
        }
    }

    fun setModel(model: String?) {
        applySessionChange("Model updated") { sessionRepository.setModel(sessionId, model) }
    }

    fun setReasoning(level: String?) {
        applySessionChange("Reasoning updated") { sessionRepository.setReasoning(sessionId, level) }
    }

    fun switchProvider(provider: CLIProvider) {
        // The old list would offer models the new provider can't run; it
        // refills once the PATCH has come back.
        _uiState.update { it.copy(availableModels = emptyList()) }
        applySessionChange(
            "Provider switched to ${provider.displayName}",
            onApplied = { updated -> loadAvailableModels(updated.cliProvider) },
        ) {
            sessionRepository.switchProvider(sessionId, provider)
        }
    }

    /**
     * Mode is a live setting on the running process, so it goes over the socket
     * rather than through a REST write.
     */
    fun setMode(mode: SessionMode) {
        socketManager.setMode(sessionId, mode)
        _uiState.update { it.copy(sessionMode = mode, settingsNotice = "Mode set to ${mode.label}") }
    }

    fun loadAllowedDirectories() {
        viewModelScope.launch {
            _uiState.update { it.copy(directoriesLoading = true) }
            sessionRepository.getAllowedDirectories(sessionId)
                .onSuccess { directories ->
                    _uiState.update { it.copy(allowedDirectories = directories, directoriesLoading = false) }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(directoriesLoading = false, error = error.message) }
                }
        }
    }

    fun addAllowedDirectory(directory: String) {
        if (directory.isBlank()) return
        viewModelScope.launch {
            _uiState.update { it.copy(directoriesLoading = true) }
            sessionRepository.addAllowedDirectory(sessionId, directory.trim())
                .onSuccess { directories ->
                    _uiState.update {
                        it.copy(
                            allowedDirectories = directories,
                            directoriesLoading = false,
                            settingsNotice = "Directory allowed for this session",
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(directoriesLoading = false, error = error.message) }
                }
        }
    }

    fun removeAllowedDirectory(directory: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(directoriesLoading = true) }
            sessionRepository.removeAllowedDirectory(sessionId, directory)
                .onSuccess { directories ->
                    _uiState.update {
                        it.copy(
                            allowedDirectories = directories,
                            directoriesLoading = false,
                            settingsNotice = "Directory access removed",
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(directoriesLoading = false, error = error.message) }
                }
        }
    }

    private fun applySessionChange(
        notice: String,
        onApplied: ((Session) -> Unit)? = null,
        block: suspend () -> Result<Session>,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(isApplyingSettings = true) }
            block()
                .onSuccess { updated ->
                    onApplied?.invoke(updated)
                    _uiState.update {
                        it.copy(
                            isApplyingSettings = false,
                            // The backend reloads an active provider process as
                            // part of the setting write, preserving its context.
                            settingsNotice = if (updated.status == SessionStatus.RUNNING) {
                                "$notice — active session reloaded"
                            } else {
                                notice
                            },
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(isApplyingSettings = false, error = error.message)
                    }
                }
        }
    }

    fun clearSettingsNotice() {
        _uiState.update { it.copy(settingsNotice = null) }
    }

    // ── Chat threads ────────────────────────────────────────────────────────

    fun loadChats() {
        viewModelScope.launch {
            sessionRepository.getChats(sessionId).onSuccess { list ->
                selectedChatId.value = list.activeChatId
                _uiState.update { it.copy(chats = list.chats, activeChatId = list.activeChatId) }
            }
        }
    }

    /** Apply a thread switch: server already swapped context and stopped the CLI. */
    private fun applyChatList(list: SessionChatList, notice: String?) {
        selectedChatId.value = list.activeChatId
        _uiState.update {
            it.copy(
                chats = list.chats,
                activeChatId = list.activeChatId,
                isSwitchingChat = false,
                streamingState = StreamingState.Idle,
                isThinking = false,
                isSending = false,
                activeTools = emptyMap(),
                queuedCount = 0,
                settingsNotice = notice,
            )
        }
        viewModelScope.launch {
            messageRepository.fetchMessages(
                sessionId,
                clearExisting = true,
                chatId = list.activeChatId,
            )
                .onSuccess(::applyInitialHistoryPage)
        }
    }

    fun switchChat(chatId: String) {
        if (chatId == _uiState.value.activeChatId) return
        _uiState.update { it.copy(isSwitchingChat = true) }
        viewModelScope.launch {
            sessionRepository.activateChat(sessionId, chatId)
                .onSuccess { list -> applyChatList(list, null) }
                .onFailure { e ->
                    _uiState.update { it.copy(isSwitchingChat = false, error = e.message) }
                }
        }
    }

    fun newChat() {
        _uiState.update { it.copy(isSwitchingChat = true) }
        viewModelScope.launch {
            sessionRepository.createChat(sessionId)
                .onSuccess { list -> applyChatList(list, "New chat started") }
                .onFailure { e ->
                    _uiState.update { it.copy(isSwitchingChat = false, error = e.message) }
                }
        }
    }

    fun deleteChat(chatId: String) {
        viewModelScope.launch {
            sessionRepository.deleteChat(sessionId, chatId)
                .onSuccess { list -> applyChatList(list, "Chat deleted") }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    // ── Interactive prompts ─────────────────────────────────────────────────

    /** Answer a hooks-based permission request over REST (the working path). */
    fun respondToPermission(action: PermissionAction) {
        val request = _uiState.value.pendingPermission ?: return
        _uiState.update { it.copy(pendingPermission = null) }
        viewModelScope.launch {
            sessionRepository.respondToPermission(
                sessionId = sessionId,
                requestId = request.requestId,
                action = action,
                pattern = request.suggestedPattern.takeIf { it.isNotBlank() },
            ).onFailure { e ->
                _uiState.update { it.copy(error = e.message ?: "Permission response failed") }
            }
        }
    }

    /** Answer a legacy (denials-based) permission request over the socket. */
    fun respondToLegacyPermission(approve: Boolean) {
        val request = _uiState.value.pendingLegacyPermission ?: return
        _uiState.update { it.copy(pendingLegacyPermission = null) }
        if (approve) {
            socketManager.approvePermission(
                sessionId = sessionId,
                toolNames = request.denials.map { it.toolName },
                originalMessage = request.originalMessage,
            )
        } else {
            socketManager.denyPermission(sessionId)
        }
    }

    /** Answer an OpenCode question prompt; answers[i] holds question i's picks. */
    fun respondToQuestion(answers: List<List<String>>) {
        val question = _uiState.value.pendingQuestion ?: return
        _uiState.update { it.copy(pendingQuestion = null) }
        viewModelScope.launch {
            sessionRepository.respondToQuestion(
                requestId = question.requestId,
                answers = answers,
                providerSessionId = question.providerSessionId,
            ).onFailure { e ->
                _uiState.update { it.copy(error = e.message ?: "Failed to answer question") }
            }
        }
    }

    fun dismissQuestion() {
        val question = _uiState.value.pendingQuestion ?: return
        _uiState.update { it.copy(pendingQuestion = null) }
        viewModelScope.launch {
            sessionRepository.rejectQuestion(question.requestId, question.providerSessionId)
        }
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    override fun onCleared() {
        socketManager.updatePresence(
            sessionId = sessionId,
            deviceId = deviceId,
            label = Build.MODEL.takeIf { it.isNotBlank() },
            state = "leave",
            lastReadMessageId = null,
        )
        presenceJob?.cancel()
        deliveryJobs.values.forEach { it.cancel() }
        socketManager.unsubscribeFromSession(sessionId)
        super.onCleared()
    }
}

internal const val STREAM_FLUSH_MS = 50L
internal const val PRESENCE_HEARTBEAT_MS = 25_000L
internal const val SEARCH_DEBOUNCE_MS = 250L
internal const val READ_POSITION_DEBOUNCE_MS = 400L
internal const val OUTBOX_ACCEPTED_RETENTION_MS = 24L * 60L * 60L * 1_000L
internal const val MAX_ATTACHMENT_COUNT = 8
// The backend persists at most 25 MB per file and Socket.IO caps the complete
// JSON frame at 50 MB. Base64 expands bytes by roughly one third, so a 32 MB
// raw total leaves room for filenames and protocol overhead.
internal const val MAX_ATTACHMENT_BYTES = 25L * 1024L * 1024L
internal const val MAX_TOTAL_ATTACHMENT_BYTES = 32L * 1024L * 1024L

private data class PreparedDelivery(
    val uploadIds: List<String>,
    val legacyAttachments: List<FileAttachmentData>,
)

internal fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { "%02x".format(it) }

internal fun prepareOutboxRetry(item: OutboxEntity): OutboxEntity = item.copy(
    status = OutboxStatus.SENDING.name,
    error = null,
    retryable = true,
)

internal fun chunkByteRange(index: Int, chunkSize: Int, totalBytes: Int): IntRange? {
    if (index < 0 || chunkSize <= 0 || totalBytes <= 0) return null
    val start = index.toLong() * chunkSize.toLong()
    if (start >= totalBytes) return null
    val endExclusive = minOf(start + chunkSize, totalBytes.toLong()).toInt()
    return start.toInt() until endExclusive
}

/** Small testable buffer used by the 50 ms streaming UI batcher. */
internal class StreamingDeltaAccumulator {
    private val value = StringBuilder()

    fun append(delta: String) {
        value.append(delta)
    }

    fun drain(): String = value.toString().also { value.clear() }
}

internal fun readUriWithLimit(
    context: Context,
    uri: Uri,
    maxBytes: Long,
    onProgress: (Long) -> Unit = {},
): ByteArray {
    val input = context.contentResolver.openInputStream(uri)
        ?: error("The selected file can no longer be opened")
    return input.use { stream ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var total = 0L
        while (true) {
            val count = stream.read(buffer)
            if (count < 0) break
            total += count
            if (total > maxBytes) {
                error("Attachment exceeds ${formatBytes(maxBytes)}")
            }
            output.write(buffer, 0, count)
            onProgress(total)
        }
        output.toByteArray()
    }
}

internal fun formatBytes(bytes: Long): String = when {
    bytes < 1_024 -> "$bytes B"
    bytes < 1_048_576 -> "%.1f KB".format(bytes / 1_024.0)
    else -> "%.1f MB".format(bytes / 1_048_576.0)
}
