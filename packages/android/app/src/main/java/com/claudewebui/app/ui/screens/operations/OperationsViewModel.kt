package com.claudewebui.app.ui.screens.operations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.AdminStats
import com.claudewebui.app.data.model.AdminUser
import com.claudewebui.app.data.model.AuditLogEntry
import com.claudewebui.app.data.model.DockerContainer
import com.claudewebui.app.data.model.DockerStatus
import com.claudewebui.app.data.model.Watchdog
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class OperationsTab { CONTAINERS, WATCHDOGS, USERS, AUDIT }

data class OperationsUiState(
    val tab: OperationsTab = OperationsTab.CONTAINERS,
    val dockerStatus: DockerStatus? = null,
    val containers: List<DockerContainer> = emptyList(),
    val watchdogs: List<Watchdog> = emptyList(),
    val stats: AdminStats? = null,
    val users: List<AdminUser> = emptyList(),
    val audit: List<AuditLogEntry> = emptyList(),
    val isLoading: Boolean = true,
    /**
     * Admin-only sections answer 403 for a normal user. That is a legitimate
     * state, not a failure, so it is tracked separately from [error].
     */
    val adminDenied: Boolean = false,
    val error: String? = null,
)

/**
 * Container, watchdog, user and audit overview.
 *
 * Sections load in parallel and each one degrades on its own: a Docker socket
 * that is down must not blank out the audit log.
 */
class OperationsViewModel(private val api: ApiClient) : ViewModel() {

    private val _uiState = MutableStateFlow(OperationsUiState())
    val uiState: StateFlow<OperationsUiState> = _uiState.asStateFlow()

    private var loaded = false

    fun ensureLoaded() {
        if (loaded) return
        loaded = true
        load()
    }

    fun selectTab(tab: OperationsTab) {
        _uiState.update { it.copy(tab = tab) }
    }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            var denied = false
            coroutineScope {
                val status = async { runCatching { api.getDockerStatus().data }.getOrNull() }
                val containers =
                    async { runCatching { api.getDockerContainers().data }.getOrNull() }
                val watchdogs = async {
                    runCatching { api.getWatchdogs().data }
                        .onFailure { denied = true }
                        .getOrNull()
                }
                val stats = async {
                    runCatching { api.getAdminStats().data }
                        .onFailure { denied = true }
                        .getOrNull()
                }
                val users = async { runCatching { api.getAdminUsers().data }.getOrNull() }
                val audit = async { runCatching { api.getAuditLog(60).data }.getOrNull() }

                val resolvedStatus = status.await()
                val resolvedContainers = containers.await().orEmpty()
                val resolvedWatchdogs = watchdogs.await().orEmpty()
                val resolvedStats = stats.await()
                val resolvedUsers = users.await().orEmpty()
                val resolvedAudit = audit.await()?.entries.orEmpty()

                _uiState.update {
                    it.copy(
                        dockerStatus = resolvedStatus,
                        containers = resolvedContainers.sortedWith(
                            compareByDescending<DockerContainer> { c -> c.isRunning }
                                .thenBy { c -> c.name.lowercase() },
                        ),
                        watchdogs = resolvedWatchdogs,
                        stats = resolvedStats,
                        users = resolvedUsers,
                        audit = resolvedAudit,
                        isLoading = false,
                        adminDenied = denied && resolvedStats == null,
                    )
                }
            }
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(error = null) }
    }
}
