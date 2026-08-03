package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class SessionStatus {
    @SerialName("running") RUNNING,
    @SerialName("stopped") STOPPED,
    @SerialName("error") ERROR
}

@Serializable
enum class CLIProvider(val displayName: String) {
    @SerialName("claude") CLAUDE("Claude"),
    @SerialName("codex") CODEX("Codex"),
    @SerialName("opencode") OPENCODE("OpenCode"),
    @SerialName("pi") PI("Pi"),
    @SerialName("kimi") KIMI("Kimi"),
    @SerialName("zai") ZAI("Z.AI");

    companion object {
        val active: List<CLIProvider> = listOf(CODEX, OPENCODE, PI, KIMI, ZAI, CLAUDE)

        fun fromId(id: String): CLIProvider? =
            entries.firstOrNull { it.name.equals(id, ignoreCase = true) }
    }
}

@Serializable
enum class SessionMode(val label: String, val description: String) {
    @SerialName("planning") PLANNING("Plan", "Think it through, change nothing"),
    @SerialName("auto-accept") AUTO_ACCEPT("Auto", "Run tools without asking"),
    @SerialName("manual") MANUAL("Manual", "Ask before each tool"),
    @SerialName("danger") DANGER("Danger", "Skip all permission checks")
}

@Serializable
data class Session(
    val id: String,
    val userId: String,
    val name: String,
    val workingDirectory: String,
    val claudeSessionId: String? = null,
    val status: SessionStatus,
    val lastMessage: String? = null,
    val starred: Boolean = false,
    val cliProvider: CLIProvider = CLIProvider.CODEX,
    /** Model the harness runs for this session; null means the provider default. */
    val cliModel: String? = null,
    /** Reasoning level, where the provider supports one. */
    val cliReasoning: String? = null,
    val category: String? = null,
    val createdAt: String,
    val updatedAt: String
)

/**
 * Reasoning levels offered in the session settings.
 *
 * Codex names its fastest tier "fast"; the backend maps that to "no reasoning"
 * and clears the column, so it is sent as-is rather than translated here.
 */
enum class ReasoningLevel(val id: String, val label: String) {
    MINIMAL("minimal", "Minimal"),
    LOW("low", "Low"),
    MEDIUM("medium", "Medium"),
    HIGH("high", "High"),
}

@Serializable
data class CreateSessionInput(
    val name: String,
    val workingDirectory: String? = null,
    val cliProvider: CLIProvider? = null
)

@Serializable
data class UpdateSessionInput(
    val name: String? = null,
    val workingDirectory: String? = null
)

@Serializable
data class SwitchProviderInput(
    val cliProvider: CLIProvider
)
