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
    /** Codex "fast" service tier; null everywhere else. */
    val cliServiceTier: String? = null,
    /** Permission mode persisted on the session row. */
    val mode: SessionMode = SessionMode.AUTO_ACCEPT,
    /** Presentation presets applied to this session's turns; null = none. */
    val designStyleSkill: String? = null,
    val writingStyleSkill: String? = null,
    val surface: String = "code",
    val category: String? = null,
    val createdAt: String,
    val updatedAt: String,
    /** Local/server read marker merged into the Room-backed dashboard model. */
    val unreadCount: Int = 0,
)

/** `PATCH /api/sessions/:id/star` returns only the flag, not the session. */
@Serializable
data class StarResult(val starred: Boolean = false)

/** `PATCH /api/sessions/:id/category` returns only the assignment. */
@Serializable
data class CategoryAssignment(val category: String? = null)

/**
 * Reasoning levels offered in the session settings.
 *
 * Codex names its fastest tier "fast"; the backend maps that to "no reasoning"
 * and clears the column, so it is sent as-is rather than translated here.
 */
enum class ReasoningLevel(val id: String, val label: String) {
    NONE("none", "None"),
    MINIMAL("minimal", "Minimal"),
    LOW("low", "Low"),
    MEDIUM("medium", "Medium"),
    HIGH("high", "High"),
    XHIGH("xhigh", "XHigh"),
    MAX("max", "Max"),
    ULTRA("ultra", "Ultra");

    companion object {
        /**
         * Which levels a provider actually accepts — mirrors `reasoningOptions`
         * in the WebUI's SessionPage/DashboardPage. Offering a level the
         * harness rejects silently downgrades the turn, so the lists must match.
         */
        fun forProvider(provider: CLIProvider): List<ReasoningLevel> = when (provider) {
            CLIProvider.CLAUDE, CLIProvider.ZAI -> listOf(LOW, MEDIUM, HIGH, MAX)
            CLIProvider.OPENCODE, CLIProvider.PI -> listOf(MINIMAL, LOW, MEDIUM, HIGH, MAX)
            else -> listOf(NONE, MINIMAL, LOW, MEDIUM, HIGH, XHIGH, MAX, ULTRA)
        }

        fun fromId(id: String?): ReasoningLevel? =
            id?.trim()?.takeIf { it.isNotEmpty() }?.let { value ->
                entries.firstOrNull { it.id.equals(value, ignoreCase = true) }
            }
    }
}

/**
 * Codex service tier. `fast` trades reasoning depth for latency and lives in
 * its own column server-side, so it is a separate control rather than another
 * reasoning level.
 */
enum class ServiceTier(val id: String, val label: String) {
    FAST("fast", "Fast"),
}

@Serializable
data class CreateSessionInput(
    val name: String,
    val workingDirectory: String? = null,
    val cliProvider: CLIProvider? = null,
    val mode: SessionMode? = null
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

// ── Multi-chat threads ───────────────────────────────────────────────────────

@Serializable
data class SessionChat(
    val id: String,
    val title: String,
    val createdAt: String? = null,
    val updatedAt: String? = null
)

@Serializable
data class SessionChatList(
    val chats: List<SessionChat> = emptyList(),
    val activeChatId: String? = null
)
