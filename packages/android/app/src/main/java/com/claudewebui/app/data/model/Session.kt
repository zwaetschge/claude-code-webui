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
enum class CLIProvider {
    @SerialName("claude") CLAUDE,
    @SerialName("codex") CODEX,
    @SerialName("opencode") OPENCODE,
    @SerialName("pi") PI;

    companion object {
        val active: List<CLIProvider> = listOf(CODEX, OPENCODE, PI, CLAUDE)
    }
}

@Serializable
enum class SessionMode {
    @SerialName("planning") PLANNING,
    @SerialName("auto-accept") AUTO_ACCEPT,
    @SerialName("manual") MANUAL,
    @SerialName("danger") DANGER
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
    val category: String? = null,
    val createdAt: String,
    val updatedAt: String
)

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
