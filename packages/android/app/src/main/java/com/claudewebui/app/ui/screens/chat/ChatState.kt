package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.data.model.FileAttachmentData
import com.claudewebui.app.data.model.Message
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.ToolExecution
import com.claudewebui.app.data.model.UsageData
import com.claudewebui.app.data.model.SessionMode

// ── Streaming State ───────────────────────────────────────────────────────────

sealed class StreamingState {
    object Idle : StreamingState()
    data class Streaming(val partialText: String, val messageId: String = "streaming") : StreamingState()
    data class ToolExecuting(val toolName: String, val toolId: String = "") : StreamingState()
    data class AgentRunning(val agentType: String, val description: String? = null) : StreamingState()
    object Complete : StreamingState()
}

// ── Chat UI State ─────────────────────────────────────────────────────────────

data class ChatUiState(
    // Session info
    val session: Session? = null,
    val isLoadingSession: Boolean = true,

    // Messages
    val messages: List<Message> = emptyList(),
    val isLoadingHistory: Boolean = false,
    val hasMoreHistory: Boolean = false,

    // Real-time state
    val streamingState: StreamingState = StreamingState.Idle,
    val isThinking: Boolean = false,
    val thinkingStartTime: Long = 0L,
    val activeTools: Map<String, ToolExecution> = emptyMap(),

    // Connection
    val isConnected: Boolean = false,
    val connectionError: String? = null,

    // Usage
    val usageData: UsageData? = null,
    val showUsageBanner: Boolean = false,

    // Input
    val draftText: String = "",
    val isSending: Boolean = false,
    val pendingAttachments: List<FileAttachmentData> = emptyList(),

    // Session settings (provider / model / reasoning / mode)
    val sessionMode: SessionMode = SessionMode.MANUAL,
    val availableModels: List<String> = emptyList(),
    val isApplyingSettings: Boolean = false,
    val settingsNotice: String? = null,

    // UI state
    val error: String? = null,
    val isEditingTitle: Boolean = false,
) {
    val isWorking: Boolean
        get() = isThinking ||
                streamingState is StreamingState.Streaming ||
                streamingState is StreamingState.ToolExecuting ||
                streamingState is StreamingState.AgentRunning ||
                isSending

    val currentToolName: String?
        get() = (streamingState as? StreamingState.ToolExecuting)?.toolName

    val streamingText: String?
        get() = (streamingState as? StreamingState.Streaming)?.partialText
}
