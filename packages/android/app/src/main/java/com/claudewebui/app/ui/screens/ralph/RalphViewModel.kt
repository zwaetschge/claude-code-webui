package com.claudewebui.app.ui.screens.ralph

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.SocketManager
import com.claudewebui.app.data.model.*
import com.claudewebui.app.data.repository.SessionRepository
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

// ── Activity Log ───────────────────────────────────────────────────────────────

enum class RalphActionType {
    THINKING, TOOL_USE, FILE_CHANGE, DECISION, ERROR, INFO, ITERATION
}

data class RalphLogEntry(
    val id: String = UUID.randomUUID().toString(),
    val timestamp: Long = System.currentTimeMillis(),
    val actionType: RalphActionType,
    val description: String,
    val detail: String? = null,
)

// ── UI State ────────────────────────────────────────────────────────────────────

data class RalphUiState(
    val isLoading: Boolean = false,
    val status: RalphStatus = RalphStatus.IDLE,
    val runId: String? = null,
    val plan: RalphPlan? = null,
    val progress: RalphProgress? = null,
    val activityLog: List<RalphLogEntry> = emptyList(),
    val costTracking: RalphCostTracking? = null,
    val circuitBreaker: RalphCircuitBreaker? = null,
    val idea: String = "",
    val elapsedSeconds: Long = 0L,
    val selectedTaskId: String? = null,
    val logFilter: RalphActionType? = null,
    val showConfigSheet: Boolean = false,
    val showInterveneDialog: Boolean = false,
    val interveneText: String = "",
    val error: String? = null,
    val exitReason: String? = null,
)

data class RalphConfigDraft(
    val idea: String = "",
    val constraints: String = "",
    val maxIterationsPerTask: Int = 10,
    val maxTotalIterations: Int = 50,
    val autoApprovePermissions: Boolean = true,
    val cliProvider: String = "claude",
    val maxCostUsd: Double? = null,
)

// ── ViewModel ───────────────────────────────────────────────────────────────────

class RalphViewModel(
    private val sessionId: String,
    private val socketManager: SocketManager,
    private val sessionRepository: SessionRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(RalphUiState())
    val uiState: StateFlow<RalphUiState> = _uiState.asStateFlow()

    private val _configDraft = MutableStateFlow(RalphConfigDraft())
    val configDraft: StateFlow<RalphConfigDraft> = _configDraft.asStateFlow()

    val session: StateFlow<Session?> = sessionRepository.observeSession(sessionId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    init {
        subscribeToSocket()
        startElapsedTimer()
    }

    // ── Socket Subscription ────────────────────────────────────────────────────

    private fun subscribeToSocket() {
        socketManager.subscribeToSession(sessionId)

        viewModelScope.launch {
            socketManager.ralphEvents.collect { event ->
                handleRalphEvent(event)
            }
        }
    }

    private fun handleRalphEvent(event: RalphEvent) {
        when (event) {
            is RalphEvent.State -> {
                if (event.sessionId == sessionId) applyRunState(event.run)
            }

            is RalphEvent.Progress -> {
                if (event.sessionId == sessionId) {
                    _uiState.update { it.copy(progress = event.progress) }
                    appendLog(
                        RalphActionType.INFO,
                        "Progress: ${event.progress.completedTasks}/${event.progress.totalTasks} tasks — ${event.progress.percentComplete.toInt()}%",
                    )
                }
            }

            is RalphEvent.Iteration -> {
                if (event.sessionId == sessionId) {
                    val iter = event.iteration
                    appendLog(
                        RalphActionType.ITERATION,
                        "Iteration ${iter.iterationNumber} — ${iter.toolCallCount} tool calls, ${iter.errorCount} errors",
                        detail = iter.promptSent.take(200),
                    )
                }
            }

            is RalphEvent.Plan -> {
                if (event.sessionId == sessionId) {
                    _uiState.update { it.copy(plan = event.plan) }
                    appendLog(
                        RalphActionType.THINKING,
                        "Plan created: \"${event.plan.title}\" — ${event.plan.tasks.size} tasks",
                    )
                }
            }

            is RalphEvent.Completed -> {
                if (event.sessionId == sessionId) {
                    _uiState.update {
                        it.copy(
                            status = RalphStatus.COMPLETED,
                            runId = event.runId,
                            exitReason = event.exitReason,
                        )
                    }
                    appendLog(RalphActionType.DECISION, "Completed: ${event.exitReason}")
                }
            }

            is RalphEvent.Error -> {
                if (event.sessionId == sessionId) {
                    _uiState.update { it.copy(error = event.error) }
                    appendLog(RalphActionType.ERROR, event.error)
                }
            }
        }
    }

    private fun applyRunState(run: RalphRunState) {
        _uiState.update {
            it.copy(
                status = run.status,
                runId = run.id,
                plan = run.plan,
                progress = run.progress,
                costTracking = run.costTracking,
                circuitBreaker = run.circuitBreaker,
                idea = run.idea,
                isLoading = false,
                error = run.lastError,
                exitReason = run.exitReason,
            )
        }
    }

    private fun appendLog(type: RalphActionType, description: String, detail: String? = null) {
        val entry = RalphLogEntry(
            actionType = type,
            description = description,
            detail = detail,
        )
        _uiState.update { it.copy(activityLog = it.activityLog + entry) }
    }

    // ── Elapsed Timer ──────────────────────────────────────────────────────────

    private fun startElapsedTimer() {
        viewModelScope.launch {
            while (true) {
                kotlinx.coroutines.delay(1_000)
                val status = _uiState.value.status
                if (status == RalphStatus.EXECUTING || status == RalphStatus.PLANNING) {
                    _uiState.update { it.copy(elapsedSeconds = it.elapsedSeconds + 1) }
                }
            }
        }
    }

    // ── Public Actions ─────────────────────────────────────────────────────────

    fun showConfigSheet() {
        _uiState.update { it.copy(showConfigSheet = true) }
    }

    fun hideConfigSheet() {
        _uiState.update { it.copy(showConfigSheet = false) }
    }

    fun updateConfigDraft(draft: RalphConfigDraft) {
        _configDraft.value = draft
    }

    fun start() {
        val draft = _configDraft.value
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isLoading = true,
                    showConfigSheet = false,
                    activityLog = emptyList(),
                    plan = null,
                    progress = null,
                    error = null,
                    elapsedSeconds = 0L,
                )
            }

            val config = JSONObject().apply {
                put("sessionId", sessionId)
                put("maxIterationsPerTask", draft.maxIterationsPerTask)
                put("maxTotalIterations", draft.maxTotalIterations)
                put("cliProvider", draft.cliProvider)
                put("dangerMode", draft.autoApprovePermissions)
                put("autoCreateSession", true)
                draft.maxCostUsd?.let { put("maxCostUsd", it) }
                if (draft.constraints.isNotBlank()) {
                    put("constraints", draft.constraints)
                }
            }

            appendLog(RalphActionType.THINKING, "Starting: \"${draft.idea}\"")
            socketManager.ralphStart(idea = draft.idea, sessionId = sessionId, config = config)
        }
    }

    fun pause() {
        val runId = _uiState.value.runId ?: return
        socketManager.ralphPause(runId)
        appendLog(RalphActionType.DECISION, "Paused by user")
        _uiState.update { it.copy(status = RalphStatus.PAUSED) }
    }

    fun resume() {
        val runId = _uiState.value.runId ?: return
        socketManager.ralphResume(runId)
        appendLog(RalphActionType.DECISION, "Resumed by user")
        _uiState.update { it.copy(status = RalphStatus.EXECUTING) }
    }

    fun stop() {
        val runId = _uiState.value.runId ?: return
        socketManager.ralphStop(runId)
        appendLog(RalphActionType.DECISION, "Stopped by user")
        _uiState.update { it.copy(status = RalphStatus.STOPPED) }
    }

    fun showInterveneDialog() {
        _uiState.update { it.copy(showInterveneDialog = true) }
    }

    fun dismissInterveneDialog() {
        _uiState.update { it.copy(showInterveneDialog = false, interveneText = "") }
    }

    fun updateInterveneText(text: String) {
        _uiState.update { it.copy(interveneText = text) }
    }

    fun intervene() {
        val text = _uiState.value.interveneText.trim()
        if (text.isEmpty()) return
        socketManager.sendMessage(sessionId, "[INTERVENTION] $text")
        appendLog(RalphActionType.DECISION, "User intervention: $text")
        _uiState.update { it.copy(showInterveneDialog = false, interveneText = "") }
    }

    fun selectTask(taskId: String?) {
        _uiState.update { it.copy(selectedTaskId = taskId) }
    }

    fun setLogFilter(filter: RalphActionType?) {
        _uiState.update { it.copy(logFilter = filter) }
    }

    fun getTaskDetail(id: String): RalphTask? =
        _uiState.value.plan?.tasks?.find { it.id == id }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
