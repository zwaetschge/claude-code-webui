package com.claudewebui.app.ui.screens.devtools

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.CreateRepoInput
import com.claudewebui.app.data.model.GitHubRepo
import com.claudewebui.app.data.model.GitHubTokenStatus
import com.claudewebui.app.data.model.OracleBrowserState
import com.claudewebui.app.data.model.PreviewConfig
import com.claudewebui.app.data.model.PreviewPort
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class DevToolsTab { PREVIEW, GITHUB, ORACLE }

data class DevToolsUiState(
    val tab: DevToolsTab = DevToolsTab.PREVIEW,
    val previewConfig: PreviewConfig? = null,
    val ports: List<PreviewPort> = emptyList(),
    val scannedAt: String = "",
    val isScanning: Boolean = false,
    val tokenStatus: GitHubTokenStatus? = null,
    val repos: List<GitHubRepo> = emptyList(),
    val isLoadingGitHub: Boolean = false,
    val gitHubAction: String? = null,
    val oracle: OracleBrowserState? = null,
    val oracleFrame: ByteArray? = null,
    val isLoadingOracle: Boolean = false,
    val isOracleActionPending: Boolean = false,
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
    private val sessionId: String,
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
        loadOracle()
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

    fun createRepo(name: String, description: String, isPrivate: Boolean) {
        val cleanName = name.trim()
        if (cleanName.isEmpty()) return
        viewModelScope.launch {
            _uiState.update { it.copy(gitHubAction = "Creating repository…", error = null) }
            runCatching {
                val response = api.createGitHubRepo(
                    CreateRepoInput(
                        name = cleanName,
                        description = description.trim().takeIf(String::isNotEmpty),
                        private = isPrivate,
                    ),
                )
                if (!response.success) error(response.error?.message ?: "Repository creation failed")
                response
            }.onSuccess { response ->
                _uiState.update {
                    it.copy(notice = "Repository ${response.data?.fullName ?: cleanName} created")
                }
                loadGitHub()
            }.onFailure { failure ->
                _uiState.update { it.copy(error = failure.message ?: "Repository creation failed") }
            }
            _uiState.update { it.copy(gitHubAction = null) }
        }
    }

    fun cloneRepo(repoUrl: String, targetDirectory: String, branch: String = "") {
        val target = targetDirectory.trim()
        if (repoUrl.isBlank() || target.isEmpty()) return
        viewModelScope.launch {
            _uiState.update { it.copy(gitHubAction = "Cloning repository…", error = null) }
            runCatching {
                val response =
                    api.cloneGitHubRepo(repoUrl, target, branch.trim().takeIf(String::isNotEmpty))
                if (!response.success) error(response.error?.message ?: "Clone failed")
                response
            }.onSuccess {
                _uiState.update { it.copy(notice = "Repository cloned to $target") }
            }.onFailure { failure ->
                _uiState.update { it.copy(error = failure.message ?: "Clone failed") }
            }
            _uiState.update { it.copy(gitHubAction = null) }
        }
    }

    fun push(remote: String = "", branch: String = "", force: Boolean = false) {
        if (workingDirectory.isBlank()) {
            _uiState.update { it.copy(error = "This session has no working directory") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(gitHubAction = "Pushing commits…", error = null) }
            runCatching {
                val response = api.pushToGitHub(
                    workingDirectory,
                    remote.trim().takeIf(String::isNotEmpty),
                    branch.trim().takeIf(String::isNotEmpty),
                    force,
                )
                if (!response.success) error(response.error?.message ?: "Push failed")
                response
            }.onSuccess {
                _uiState.update { it.copy(notice = "Push completed") }
            }.onFailure { failure ->
                _uiState.update { it.copy(error = failure.message ?: "Push failed") }
            }
            _uiState.update { it.copy(gitHubAction = null) }
        }
    }

    fun defaultCloneTarget(repo: GitHubRepo): String {
        val parent = workingDirectory.trimEnd('/').substringBeforeLast('/', "")
        return if (parent.isBlank()) repo.name else "$parent/${repo.name}"
    }

    fun loadOracle(loadFrame: Boolean = true) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingOracle = true) }
            runCatching { api.getOracleBrowser(sessionId) }
                .onSuccess { response ->
                    val browser = response.data
                    _uiState.update {
                        it.copy(
                            oracle = browser,
                            isLoadingOracle = false,
                            error = if (response.success) it.error else response.error?.message,
                        )
                    }
                    if (loadFrame && browser?.running == true) loadOracleFrame()
                }
                .onFailure { failure ->
                    _uiState.update {
                        it.copy(isLoadingOracle = false, error = failure.message)
                    }
                }
        }
    }

    fun loadOracleFrame() {
        viewModelScope.launch {
            runCatching { api.getOracleFrame(sessionId) }
                .onSuccess { frame -> _uiState.update { it.copy(oracleFrame = frame) } }
        }
    }

    private fun oracleAction(action: suspend () -> com.claudewebui.app.data.model.ApiResponse<OracleBrowserState>) {
        viewModelScope.launch {
            _uiState.update { it.copy(isOracleActionPending = true, error = null) }
            runCatching {
                val response = action()
                if (!response.success) {
                    error(response.error?.message ?: "Oracle browser action failed")
                }
                response
            }
                .onSuccess { response ->
                    _uiState.update { it.copy(oracle = response.data) }
                    if (response.data?.running == true) loadOracleFrame()
                }
                .onFailure { failure -> _uiState.update { it.copy(error = failure.message) } }
            _uiState.update { it.copy(isOracleActionPending = false) }
        }
    }

    fun startOracle(targetUrl: String) = oracleAction {
        api.startOracleBrowser(sessionId, targetUrl.trim().takeIf(String::isNotEmpty))
    }

    fun stopOracle() = oracleAction { api.stopOracleBrowser(sessionId) }

    fun reloadOracle() = oracleAction { api.reloadOracleBrowser(sessionId) }

    fun navigateOracle(targetUrl: String) {
        if (targetUrl.isBlank()) return
        oracleAction { api.navigateOracleBrowser(sessionId, targetUrl.trim()) }
    }

    fun clickOracle(xRatio: Float, yRatio: Float) {
        viewModelScope.launch {
            runCatching { api.clickOracleBrowser(sessionId, xRatio, yRatio) }
                .onFailure { failure -> _uiState.update { it.copy(error = failure.message) } }
            loadOracleFrame()
        }
    }

    fun scrollOracle(deltaY: Float) {
        viewModelScope.launch {
            runCatching { api.wheelOracleBrowser(sessionId, deltaY) }
                .onFailure { failure -> _uiState.update { it.copy(error = failure.message) } }
            loadOracleFrame()
        }
    }

    fun sendOracleText(text: String) {
        if (text.isEmpty()) return
        viewModelScope.launch {
            runCatching { api.textOracleBrowser(sessionId, text) }
                .onFailure { failure -> _uiState.update { it.copy(error = failure.message) } }
            loadOracleFrame()
        }
    }

    fun sendOracleKey(key: String, code: String? = null) {
        viewModelScope.launch {
            runCatching { api.keyOracleBrowser(sessionId, key, code) }
                .onFailure { failure -> _uiState.update { it.copy(error = failure.message) } }
            loadOracleFrame()
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
