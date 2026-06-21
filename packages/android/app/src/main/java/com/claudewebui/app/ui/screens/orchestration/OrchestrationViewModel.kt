package com.claudewebui.app.ui.screens.orchestration

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.SocketManager
import com.claudewebui.app.data.model.*
import com.claudewebui.app.data.repository.SessionRepository
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

// ── UI State ─────────────────────────────────────────────────────────────────

data class OrchestrationUiState(
    val isLoading: Boolean = false,
    val isRunning: Boolean = false,
    val currentPhase: OrchestrationPhase = OrchestrationPhase.IDLE,
    val phaseMessage: String? = null,
    val workers: List<WorkerState> = emptyList(),
    val tasks: List<OrchestrationTask> = emptyList(),
    val config: OrchestrationConfig = OrchestrationConfig(),
    val startedAt: String? = null,
    val completedAt: String? = null,
    val workerOutputs: Map<String, String> = emptyMap(),
    val taskProgress: Map<String, Float> = emptyMap(),
    val error: String? = null,
    val showConfigSheet: Boolean = false,
    val selectedWorkerDetail: WorkerDetailState? = null,
)

data class WorkerDetailState(
    val worker: WorkerState,
    val output: String,
    val tasks: List<OrchestrationTask>,
)

data class OrchestrationConfigDraft(
    val task: String = "",
    val masterProvider: CLIProvider = CLIProvider.CODEX,
    val workers: List<WorkerConfig> = listOf(
        WorkerConfig(provider = CLIProvider.CODEX),
        WorkerConfig(provider = CLIProvider.OPENCODE),
    ),
    val strategy: TaskRouting = TaskRouting.AUTO,
    val parallelExecution: Boolean = true,
    val maxParallelTasks: Int = 3,
)

// ── ViewModel ─────────────────────────────────────────────────────────────────

class OrchestrationViewModel(
    private val sessionId: String,
    private val socketManager: SocketManager,
    private val sessionRepository: SessionRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(OrchestrationUiState())
    val uiState: StateFlow<OrchestrationUiState> = _uiState.asStateFlow()

    private val _configDraft = MutableStateFlow(OrchestrationConfigDraft())
    val configDraft: StateFlow<OrchestrationConfigDraft> = _configDraft.asStateFlow()

    val session: StateFlow<Session?> = sessionRepository.observeSession(sessionId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    // Elapsed time ticker
    private val _elapsedSeconds = MutableStateFlow(0L)
    val elapsedSeconds: StateFlow<Long> = _elapsedSeconds.asStateFlow()

    init {
        subscribeToSocket()
        startElapsedTimer()
    }

    // ── Socket subscription ────────────────────────────────────────────────────

    private fun subscribeToSocket() {
        socketManager.subscribeToSession(sessionId)

        // Full orchestration state snapshots
        viewModelScope.launch {
            socketManager.orchestrationState.collect { state ->
                if (state.sessionId == sessionId) {
                    applyState(state)
                }
            }
        }

        // Granular orchestration events
        viewModelScope.launch {
            socketManager.orchestrationEvents.collect { event ->
                handleEvent(event)
            }
        }
    }

    private fun applyState(state: OrchestrationState) {
        _uiState.update {
            it.copy(
                isRunning = state.isOrchestrating,
                currentPhase = state.currentPhase,
                phaseMessage = state.phaseMessage,
                workers = state.workers,
                tasks = state.tasks,
                config = state.config,
                startedAt = state.startedAt,
                completedAt = state.completedAt,
                isLoading = false,
            )
        }
    }

    private fun handleEvent(event: OrchestrationEvent) {
        when (event) {
            is OrchestrationEvent.State -> {
                if (event.data.sessionId == sessionId) applyState(event.data)
            }

            is OrchestrationEvent.Phase -> {
                if (event.sessionId == sessionId) {
                    _uiState.update {
                        it.copy(
                            currentPhase = event.phase,
                            phaseMessage = event.message,
                        )
                    }
                }
            }

            is OrchestrationEvent.WorkerStatusUpdate -> {
                if (event.sessionId == sessionId) {
                    _uiState.update { state ->
                        val updated = state.workers.map { w ->
                            if (w.id == event.worker.id) event.worker else w
                        }
                        state.copy(workers = updated)
                    }
                }
            }

            is OrchestrationEvent.WorkerOutput -> {
                if (event.sessionId == sessionId) {
                    _uiState.update { state ->
                        val current = state.workerOutputs[event.workerId] ?: ""
                        val newOutput = if (event.isPartial) current + event.content else event.content
                        state.copy(workerOutputs = state.workerOutputs + (event.workerId to newOutput))
                    }
                }
            }

            is OrchestrationEvent.TaskDelegated -> {
                if (event.sessionId == sessionId) {
                    _uiState.update { state ->
                        val existing = state.tasks.map { t ->
                            if (t.id == event.task.id) event.task else t
                        }
                        val tasks = if (existing.any { it.id == event.task.id }) existing
                        else existing + event.task
                        state.copy(tasks = tasks)
                    }
                }
            }

            is OrchestrationEvent.TaskProgress -> {
                if (event.sessionId == sessionId) {
                    // We don't have a percentage from the server, use a heuristic
                    _uiState.update { state ->
                        val currentProgress = state.taskProgress[event.taskId] ?: 0f
                        val nudge = minOf(currentProgress + 0.05f, 0.95f)
                        state.copy(taskProgress = state.taskProgress + (event.taskId to nudge))
                    }
                }
            }

            is OrchestrationEvent.TaskCompleted -> {
                if (event.sessionId == sessionId) {
                    _uiState.update { state ->
                        val tasks = state.tasks.map { t ->
                            if (t.id == event.task.id) event.task else t
                        }
                        val progress = state.taskProgress + (event.task.id to 1f)
                        state.copy(tasks = tasks, taskProgress = progress)
                    }
                }
            }

            is OrchestrationEvent.Error -> {
                if (event.sessionId == sessionId) {
                    _uiState.update { it.copy(error = event.error) }
                }
            }
        }
    }

    // ── Elapsed Timer ──────────────────────────────────────────────────────────

    private fun startElapsedTimer() {
        viewModelScope.launch {
            while (true) {
                kotlinx.coroutines.delay(1_000)
                if (_uiState.value.isRunning) {
                    _elapsedSeconds.update { it + 1 }
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

    fun updateConfigDraft(draft: OrchestrationConfigDraft) {
        _configDraft.value = draft
    }

    fun startOrchestration() {
        val draft = _configDraft.value
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, showConfigSheet = false, error = null) }
            _elapsedSeconds.value = 0L

            val configJson = JSONObject().apply {
                put("master", draft.masterProvider.name.lowercase())
                put("taskRouting", if (draft.strategy == TaskRouting.AUTO) "auto" else "manual")
                put("parallelExecution", draft.parallelExecution)
                put("maxParallelTasks", draft.maxParallelTasks)
                val workersArray = JSONArray()
                draft.workers.forEach { w ->
                    workersArray.put(JSONObject().apply {
                        put("provider", w.provider.name.lowercase())
                        put("maxConcurrent", w.maxConcurrent)
                        put("enabled", w.enabled)
                        w.specialization?.let { put("specialization", it) }
                    })
                }
                put("workers", workersArray)
            }

            socketManager.orchestrationConfigure(sessionId, configJson)
            socketManager.sendMessage(sessionId, draft.task)
            socketManager.orchestrationStart(sessionId)
        }
    }

    fun stop() {
        socketManager.orchestrationStop(sessionId)
    }

    fun interruptWorker(workerId: String) {
        socketManager.orchestrationInterruptWorker(sessionId, workerId)
    }

    fun retryTask(taskId: String) {
        socketManager.orchestrationRetryTask(sessionId, taskId)
    }

    fun cancelTask(taskId: String) {
        socketManager.orchestrationCancelTask(sessionId, taskId)
    }

    fun showWorkerDetail(worker: WorkerState) {
        val output = _uiState.value.workerOutputs[worker.id] ?: ""
        val tasks = _uiState.value.tasks.filter { it.workerId == worker.id }
        _uiState.update {
            it.copy(selectedWorkerDetail = WorkerDetailState(worker, output, tasks))
        }
    }

    fun dismissWorkerDetail() {
        _uiState.update { it.copy(selectedWorkerDetail = null) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun getWorkerProgress(workerId: String): Float {
        val state = _uiState.value
        val workerTasks = state.tasks.filter { it.workerId == workerId }
        if (workerTasks.isEmpty()) return 0f
        val completed = workerTasks.count {
            it.status == OrchestrationTaskStatus.COMPLETED
        }
        return completed.toFloat() / workerTasks.size.toFloat()
    }
}
