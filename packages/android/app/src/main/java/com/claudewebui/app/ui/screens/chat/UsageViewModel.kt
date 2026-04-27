package com.claudewebui.app.ui.screens.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.UsageData
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

data class UsageUiState(
    val usageData: UsageData? = null,
    // List of (messageIndex, cumulativeTokens) pairs for chart
    val usageHistory: List<Pair<Int, Long>> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

class UsageViewModel(
    private val sessionId: String,
    private val apiClient: ApiClient
) : ViewModel() {

    private val _uiState = MutableStateFlow(UsageUiState())
    val uiState: StateFlow<UsageUiState> = _uiState.asStateFlow()

    init {
        refreshUsage()
    }

    fun refreshUsage() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching {
                val response = apiClient.getSessionUsage(sessionId)
                if (response.success && response.data != null) {
                    val root = response.data.jsonObject
                    val summary = root["summary"]?.jsonObject
                    val usageData = summary?.let { s ->
                        UsageData(
                            sessionId = sessionId,
                            inputTokens = s["inputTokens"]?.jsonPrimitive?.longOrNull ?: 0L,
                            outputTokens = s["outputTokens"]?.jsonPrimitive?.longOrNull ?: 0L,
                            cacheReadTokens = s["cacheReadTokens"]?.jsonPrimitive?.longOrNull ?: 0L,
                            cacheCreationTokens = s["cacheCreationTokens"]?.jsonPrimitive?.longOrNull ?: 0L,
                            totalTokens = s["totalTokens"]?.jsonPrimitive?.longOrNull ?: 0L,
                            contextWindow = s["contextWindow"]?.jsonPrimitive?.longOrNull ?: 0L,
                            contextUsedPercent = s["contextUsedPercent"]?.jsonPrimitive?.doubleOrNull ?: 0.0,
                            totalCostUsd = s["totalCostUsd"]?.jsonPrimitive?.doubleOrNull ?: 0.0,
                            model = s["model"]?.jsonPrimitive?.content ?: ""
                        )
                    }
                    // Build usage history from timeline array if present
                    val history = root["timeline"]?.jsonArray?.mapIndexed { idx, el ->
                        val tokens = el.jsonObject["totalTokens"]?.jsonPrimitive?.longOrNull ?: 0L
                        Pair(idx, tokens)
                    } ?: emptyList()

                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        usageData = usageData,
                        usageHistory = history
                    )
                } else {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = response.error?.message ?: "Failed to load usage"
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
}
