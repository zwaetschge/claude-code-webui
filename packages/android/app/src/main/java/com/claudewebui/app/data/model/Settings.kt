package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class Theme {
    @SerialName("dark") DARK,
    @SerialName("light") LIGHT,
    @SerialName("system") SYSTEM
}

@Serializable
enum class UiProvider {
    @SerialName("plum") PLUM,
    @SerialName("claude") CLAUDE,
    @SerialName("codex") CODEX,
    @SerialName("opencode") OPENCODE,
    @SerialName("pi") PI,
    @SerialName("kimi") KIMI
}

@Serializable
data class UserSettings(
    val userId: String,
    val theme: Theme = Theme.DARK,
    val defaultWorkingDir: String? = null,
    val allowedTools: List<String> = emptyList(),
    val customSystemPrompt: String? = null,
    val uiProvider: UiProvider? = null,
    val defaultCliProvider: CLIProvider? = null,
    val cliProviderModels: Map<String, String>? = null,
    val cliProviderModelLists: Map<String, List<String>>? = null,
    val cliProviderReasoning: Map<String, String>? = null,
    val cliProviderServiceTiers: Map<String, String>? = null,
    val codexWebSearch: String? = null,
    val localUsageBudgets: Map<String, LocalUsageBudget>? = null
)

@Serializable
data class UpdateSettingsInput(
    val theme: Theme? = null,
    val defaultWorkingDir: String? = null,
    val allowedTools: List<String>? = null,
    val customSystemPrompt: String? = null,
    val uiProvider: UiProvider? = null,
    val defaultCliProvider: CLIProvider? = null,
    val cliProviderModels: Map<String, String>? = null,
    val cliProviderModelLists: Map<String, List<String>>? = null,
    val cliProviderReasoning: Map<String, String>? = null,
    val cliProviderServiceTiers: Map<String, String>? = null,
    val codexWebSearch: String? = null,
    val localUsageBudgets: Map<String, LocalUsageBudget>? = null
)

@Serializable
data class LocalUsageBudget(
    val dailyUsd: Double? = null,
    val weeklyUsd: Double? = null
)

@Serializable
data class HomePaths(
    val home: String,
    val defaultWorkingDir: String? = null
)

@Serializable
data class ZaiApiStatus(
    val configured: Boolean = false,
    val baseUrl: String = "",
    val hasAuthToken: Boolean = false,
    val authTokenPreview: String? = null,
    val opusModel: String = "",
    val sonnetModel: String = "",
    val haikuModel: String = "",
)

@Serializable
data class UpdateZaiApiInput(
    val baseUrl: String,
    val authToken: String? = null,
    val opusModel: String? = null,
    val sonnetModel: String? = null,
    val haikuModel: String? = null,
)
