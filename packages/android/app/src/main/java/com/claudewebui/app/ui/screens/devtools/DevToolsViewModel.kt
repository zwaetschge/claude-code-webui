package com.claudewebui.app.ui.screens.devtools

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.GitHubRepo
import com.claudewebui.app.data.model.GitHubTokenStatus
import com.claudewebui.app.data.model.PreviewConfig
import com.claudewebui.app.data.model.PreviewPort
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class DevToolsTab { PREVIEW, GITHUB }

data class DevToolsUiState(
    val tab: DevToolsTab = DevToolsTab.PREVIEW,
    val previewConfig: PreviewConfig? = null,
    val ports: List<PreviewPort> = emptyList(),
    val scannedAt: String = "",
    val isScanning: Boolean = false,
    val tokenStatus: GitHubTokenStatus? = null,
    val repos: List<GitHubRepo> = emptyList(),
    val isLoadingGitHub: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
)

/**
 * Dev-server preview ports and the GitHub connection.
 *
 * The preview routes answer without the usual ApiResponse envelope, so their
 * calls are not unwrapped the way the GitHub ones are.
 */
class DevToolsViewModel(
    private val workingDirectory: String,
    private val api: ApiClient,
) : ViewModel() {

    private val _uiState = MutableStateFlow(DevToolsUiState())
    val uiState: StateFlow<DevToolsUiState> = _uiState.asStateFlow()

    private var loaded = false

    fun ensureLoaded() {
        if (loaded) return
        loaded = true
        scanPorts()
        loadGitHub()
    }

    fun selectTab(tab: DevToolsTab) {
        _uiState.update { it.copy(tab = tab) }
    }

    fun scanPorts() {
        viewModelScope.launch {
            _uiState.update { it.copy(isScanning = true, error = null) }
            coroutineScope {
                val config = async { runCatching { api.getPreviewConfig() }.getOrNull() }
                val scan = async {
                    runCatching {
                        api.getPreviewPorts(workingDirectory.takeIf { it.isNotBlank() })
                    }
                }
                val resolvedConfig = config.await()
                scan.await()
                    .onSuccess { result ->
                        _uiState.update {
                            it.copy(
                                previewConfig = resolvedConfig,
                                // Reachable ports first: an unreachable port is
                                // the common case and would otherwise bury the
                                // one server that is actually up.
                                ports = result.ports.sortedWith(
                                    compareByDescending<PreviewPort> { p -> p.reachable }
                                        .thenBy { p -> p.port },
                                ),
                                scannedAt = result.scannedAt,
                                isScanning = false,
                            )
                        }
                    }
                    .onFailure { failure ->
                        _uiState.update {
                            it.copy(
                                previewConfig = resolvedConfig,
                                isScanning = false,
                                error = failure.message,
                            )
                        }
                    }
            }
        }
    }

    fun loadGitHub() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingGitHub = true) }
            coroutineScope {
                val token = async { runCatching { api.validateGitHubToken().data }.getOrNull() }
                val repos = async { runCatching { api.getGitHubRepos().data?.repos }.getOrNull() }
                _uiState.update {
                    it.copy(
                        tokenStatus = token.await(),
                        repos = repos.await().orEmpty(),
                        isLoadingGitHub = false,
                    )
                }
            }
        }
    }

    fun startPreview(script: String = "") {
        if (workingDirectory.isBlank()) {
            _uiState.update { it.copy(error = "This session has no working directory") }
            return
        }
        viewModelScope.launch {
            runCatching { api.startPreview(workingDirectory, script) }
                .onSuccess { process ->
                    _uiState.update {
                        it.copy(
                            notice = process.error
                                ?: "${process.name.ifBlank { "Dev server" }} ${process.status}",
                        )
                    }
                    scanPorts()
                }
                .onFailure { failure -> _uiState.update { it.copy(error = failure.message) } }
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(error = null, notice = null) }
    }
}
