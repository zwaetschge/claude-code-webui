package com.claudewebui.app.ui.screens.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ConnectionState
import com.claudewebui.app.core.network.SocketManager
import com.claudewebui.app.data.model.*
import com.claudewebui.app.data.repository.MessageRepository
import com.claudewebui.app.data.repository.SessionRepository
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

class ChatViewModel(
    private val sessionId: String,
    private val messageRepository: MessageRepository,
    private val sessionRepository: SessionRepository,
    private val socketManager: SocketManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    /** Room-backed message list — auto-updates as messages arrive */
    val messages: StateFlow<List<Message>> = messageRepository.getMessages(sessionId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** Room-backed session info */
    val session: StateFlow<Session?> = sessionRepository.observeSession(sessionId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private var draftSaveJob: Job? = null

    init {
        loadMessages()
        loadDraft()
        observeConnectionState()
        observeSocketEvents()
    }

    // ========================================================================
    // Initial Load
    // ========================================================================

    private fun loadMessages() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingHistory = true) }
            messageRepository.fetchMessages(sessionId)
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
            _uiState.update { it.copy(isLoadingHistory = false) }
        }
    }

    private fun loadDraft() {
        viewModelScope.launch {
            val draft = messageRepository.getDraft(sessionId) ?: ""
            _uiState.update { it.copy(draftText = draft) }
        }
    }

    // ========================================================================
    // Socket Connection & Events
    // ========================================================================

    private fun observeConnectionState() {
        socketManager.connectionState
            .onEach { state ->
                val isConnected = state == ConnectionState.CONNECTED
                _uiState.update { it.copy(isConnected = isConnected) }
                if (isConnected) {
                    socketManager.subscribeToSession(sessionId)
                }
            }
            .launchIn(viewModelScope)
    }

    private fun observeSocketEvents() {
        // Streaming text deltas — accumulate into partialText
        socketManager.output
            .filter { it.sessionId == sessionId }
            .onEach { streaming ->
                val current = (_uiState.value.streamingState as? StreamingState.Streaming)?.partialText ?: ""
                _uiState.update { state ->
                    state.copy(
                        streamingState = StreamingState.Streaming(current + streaming.content),
                        isThinking = false,
                        isSending = false,
                    )
                }
            }
            .launchIn(viewModelScope)

        // Complete persisted messages — cache in Room and clear streaming state
        socketManager.messages
            .filter { it.sessionId == sessionId }
            .onEach { message ->
                messageRepository.cacheMessage(message)
                _uiState.update { state ->
                    state.copy(
                        streamingState = StreamingState.Idle,
                        isSending = false,
                    )
                }
            }
            .launchIn(viewModelScope)

        // Thinking indicator
        socketManager.thinking
            .filter { (id, _) -> id == sessionId }
            .onEach { (_, isThinking) ->
                _uiState.update { state ->
                    state.copy(
                        isThinking = isThinking,
                        thinkingStartTime = if (isThinking) System.currentTimeMillis() else 0L,
                        streamingState = if (isThinking) StreamingState.Idle else state.streamingState,
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
                    timestamp = System.currentTimeMillis(),
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

    // ========================================================================
    // User Actions
    // ========================================================================

    fun loadHistory() {
        loadMessages()
    }

    fun sendMessage(content: String) {
        val attachments = _uiState.value.pendingAttachments.takeIf { it.isNotEmpty() }
        if (content.isBlank() && attachments.isNullOrEmpty()) return
        if (_uiState.value.isWorking) return

        val trimmed = content.trim()
        clearDraft()
        _uiState.update {
            it.copy(isSending = true, draftText = "", pendingAttachments = emptyList())
        }
        socketManager.sendMessage(sessionId, trimmed, attachments)
    }

    fun addAttachments(attachments: List<FileAttachmentData>) {
        if (attachments.isEmpty()) return
        _uiState.update { state ->
            state.copy(pendingAttachments = state.pendingAttachments + attachments)
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

    // ========================================================================
    // Input & Draft
    // ========================================================================

    fun onInputChange(text: String) {
        _uiState.update { it.copy(draftText = text) }
        draftSaveJob?.cancel()
        draftSaveJob = viewModelScope.launch {
            delay(500)
            if (text.isNotEmpty()) {
                messageRepository.saveDraft(sessionId, text)
            } else {
                messageRepository.clearDraft(sessionId)
            }
        }
    }

    private fun clearDraft() {
        draftSaveJob?.cancel()
        viewModelScope.launch { messageRepository.clearDraft(sessionId) }
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    override fun onCleared() {
        super.onCleared()
        socketManager.unsubscribeFromSession(sessionId)
    }
}
