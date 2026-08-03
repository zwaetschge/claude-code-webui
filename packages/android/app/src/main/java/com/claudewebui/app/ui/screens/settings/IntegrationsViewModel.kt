package com.claudewebui.app.ui.screens.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.ComfyUiSettings
import com.claudewebui.app.data.model.DiscordSettings
import com.claudewebui.app.data.model.HomeAssistantSettings
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Result of a connection probe, kept per integration. */
data class TestState(
    val running: Boolean = false,
    val ok: Boolean? = null,
    val message: String? = null,
)

data class IntegrationsUiState(
    val comfyUi: ComfyUiSettings? = null,
    val discord: DiscordSettings? = null,
    val homeAssistant: HomeAssistantSettings? = null,
    val isLoading: Boolean = true,
    val comfyTest: TestState = TestState(),
    val discordTest: TestState = TestState(),
    val haTest: TestState = TestState(),
)

/**
 * Read-only view of the ComfyUI, Discord and Home Assistant integrations plus
 * their connection probes.
 *
 * Credentials are deliberately not editable here: the backend only ever returns
 * `*Configured` flags, never the token itself, so a mobile edit form could not
 * round-trip a value it is never shown.
 */
class IntegrationsViewModel(private val api: ApiClient) : ViewModel() {

    private val _uiState = MutableStateFlow(IntegrationsUiState())
    val uiState: StateFlow<IntegrationsUiState> = _uiState.asStateFlow()

    private var loaded = false

    fun ensureLoaded() {
        if (loaded) return
        loaded = true
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            coroutineScope {
                val comfy = async { runCatching { api.getComfyUiSettings().data }.getOrNull() }
                val discord = async { runCatching { api.getDiscordSettings().data }.getOrNull() }
                val ha = async { runCatching { api.getHomeAssistantSettings().data }.getOrNull() }
                _uiState.update {
                    it.copy(
                        comfyUi = comfy.await(),
                        discord = discord.await(),
                        homeAssistant = ha.await(),
                        isLoading = false,
                    )
                }
            }
        }
    }

    fun testComfyUi() = probe(
        set = { state, value -> state.copy(comfyTest = value) },
        call = { api.testComfyUi().success },
    )

    fun testDiscord() = probe(
        set = { state, value -> state.copy(discordTest = value) },
        call = { api.testDiscord().success },
    )

    fun testHomeAssistant() = probe(
        set = { state, value -> state.copy(haTest = value) },
        call = { api.testHomeAssistant().success },
    )

    private fun probe(
        set: (IntegrationsUiState, TestState) -> IntegrationsUiState,
        call: suspend () -> Boolean,
    ) {
        viewModelScope.launch {
            _uiState.update { set(it, TestState(running = true)) }
            val result = runCatching { call() }
            _uiState.update {
                set(
                    it,
                    TestState(
                        running = false,
                        ok = result.getOrNull() ?: false,
                        message = result.exceptionOrNull()?.message
                            ?: if (result.getOrNull() == true) "Reachable" else "Failed",
                    ),
                )
            }
        }
    }
}
