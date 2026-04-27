package com.claudewebui.app.ui.screens.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.GitBranch
import com.claudewebui.app.data.model.GitCommit
import com.claudewebui.app.data.model.GitCommitInput
import com.claudewebui.app.data.model.GitFileDiff
import com.claudewebui.app.data.model.GitPushInput
import com.claudewebui.app.data.model.GitStatus
import com.claudewebui.app.data.repository.SessionRepository
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class GitUiState(
    val workingDirectory: String = "",
    val gitStatus: GitStatus? = null,
    val commits: List<GitCommit> = emptyList(),
    val diffs: List<GitFileDiff> = emptyList(),
    val branches: List<GitBranch> = emptyList(),
    val isLoading: Boolean = false,
    val isCommitting: Boolean = false,
    val isPushing: Boolean = false,
    val error: String? = null
)

class GitViewModel(
    private val sessionId: String,
    private val apiClient: ApiClient,
    private val sessionRepository: SessionRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(GitUiState())
    val uiState: StateFlow<GitUiState> = _uiState.asStateFlow()

    init {
        loadSessionAndGit()
    }

    private fun loadSessionAndGit() {
        viewModelScope.launch {
            // Get working directory from session
            val session = sessionRepository.getSession(sessionId).getOrNull()
            val workingDir = session?.workingDirectory ?: ""
            _uiState.value = _uiState.value.copy(workingDirectory = workingDir)
            if (workingDir.isNotEmpty()) {
                refreshGitStatus(workingDir)
            }
        }
    }

    fun refreshGitStatus() {
        val workingDir = _uiState.value.workingDirectory
        if (workingDir.isEmpty()) return
        refreshGitStatus(workingDir)
    }

    private fun refreshGitStatus(path: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching {
                val statusDeferred = async { apiClient.gitStatus(path) }
                val logDeferred = async { apiClient.gitLog(path) }
                val diffDeferred = async { apiClient.gitDiff(path) }
                val branchesDeferred = async { apiClient.gitBranches(path) }

                val statusResult = statusDeferred.await()
                val logResult = logDeferred.await()
                val diffResult = diffDeferred.await()
                val branchesResult = branchesDeferred.await()

                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    gitStatus = if (statusResult.success) statusResult.data else null,
                    commits = if (logResult.success) logResult.data ?: emptyList() else emptyList(),
                    diffs = if (diffResult.success) diffResult.data ?: emptyList() else emptyList(),
                    branches = if (branchesResult.success) branchesResult.data ?: emptyList() else emptyList()
                )
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message ?: "Failed to load git status"
                )
            }
        }
    }

    fun stageAll() {
        // No explicit stageAll API — refresh status which includes staged changes
        refreshGitStatus()
    }

    fun commit(message: String) {
        val workingDir = _uiState.value.workingDirectory
        if (workingDir.isEmpty()) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isCommitting = true, error = null)
            runCatching {
                apiClient.gitCommit(workingDir, GitCommitInput(message = message))
                refreshGitStatus(workingDir)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(error = e.message)
            }
            _uiState.value = _uiState.value.copy(isCommitting = false)
        }
    }

    fun push() {
        val workingDir = _uiState.value.workingDirectory
        if (workingDir.isEmpty()) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isPushing = true, error = null)
            runCatching {
                apiClient.gitPush(workingDir, GitPushInput())
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(error = e.message)
            }
            _uiState.value = _uiState.value.copy(isPushing = false)
        }
    }

    fun switchBranch(branch: String) {
        // Branch switching not directly available in API — log for future
        refreshGitStatus()
    }
}
