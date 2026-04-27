package com.claudewebui.app.ui.screens.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.Checkpoint
import com.claudewebui.app.data.model.CreateCheckpointInput
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class CheckpointUiState(
    val checkpoints: List<Checkpoint> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

class CheckpointViewModel(
    private val sessionId: String,
    private val apiClient: ApiClient
) : ViewModel() {

    private val _uiState = MutableStateFlow(CheckpointUiState())
    val uiState: StateFlow<CheckpointUiState> = _uiState.asStateFlow()

    init {
        loadCheckpoints()
    }

    fun loadCheckpoints() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching {
                val response = apiClient.getCheckpoints(sessionId)
                if (response.success && response.data != null) {
                    _uiState.value = _uiState.value.copy(
                        checkpoints = response.data,
                        isLoading = false
                    )
                } else {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = response.error?.message ?: "Failed to load checkpoints"
                    )
                }
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message ?: "Unknown error"
                )
            }
        }
    }

    fun createCheckpoint(name: String, description: String?) {
        viewModelScope.launch {
            runCatching {
                apiClient.createCheckpoint(sessionId, CreateCheckpointInput(name, description))
                loadCheckpoints()
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(error = e.message)
            }
        }
    }

    fun restoreCheckpoint(checkpoint: Checkpoint) {
        viewModelScope.launch {
            runCatching {
                apiClient.restoreCheckpoint(checkpoint.id)
                loadCheckpoints()
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(error = e.message)
            }
        }
    }

    fun deleteCheckpoint(checkpoint: Checkpoint) {
        viewModelScope.launch {
            runCatching {
                apiClient.deleteCheckpoint(checkpoint.id)
                loadCheckpoints()
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(error = e.message)
            }
        }
    }
}
