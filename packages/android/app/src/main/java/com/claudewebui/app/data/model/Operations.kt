package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

// ============================================================================
// Integrations
// ============================================================================

@Serializable
data class ComfyUiSettings(
    val url: String = "",
    val enabled: Boolean = false,
)

/**
 * Discord alert settings.
 *
 * Only `*Configured` booleans and a masked webhook preview cross the wire — the
 * bot token and full webhook URL never leave the server, so there is nothing
 * here to render as a secret.
 */
@Serializable
data class DiscordSettings(
    val enabled: Boolean = false,
    val configured: Boolean = false,
    val transport: String = "",
    val webhookConfigured: Boolean = false,
    val botTokenConfigured: Boolean = false,
    val channelId: String? = null,
    val channelLabel: String? = null,
    val minSeverity: String = "",
    val gatewayMode: String = "",
    val outboxPending: Int = 0,
    val outboxFailed: Int = 0,
    val lastSentAt: String? = null,
    val lastError: String? = null,
)

@Serializable
data class HomeAssistantSettings(
    val enabled: Boolean = false,
    val configured: Boolean = false,
    val baseUrl: String = "",
    val accessTokenConfigured: Boolean = false,
)

// ============================================================================
// Docker / watchdogs
// ============================================================================

@Serializable
data class DockerStatus(
    val enabled: Boolean = false,
    val available: Boolean = false,
    val serverVersion: String? = null,
    val socketPath: String? = null,
    val error: String? = null,
)

@Serializable
data class DockerPort(val raw: String = "")

@Serializable
data class DockerContainer(
    val id: String,
    val shortId: String = "",
    val name: String = "",
    val image: String = "",
    val state: String = "",
    val status: String = "",
    val health: String = "unknown",
    val runningFor: String = "",
    val ports: List<DockerPort> = emptyList(),
    val networks: List<String> = emptyList(),
    val composeProject: String? = null,
    val composeService: String? = null,
) {
    val isRunning: Boolean get() = state.equals("running", ignoreCase = true)
}

@Serializable
data class Watchdog(
    val id: String,
    val containerId: String = "",
    val containerName: String = "",
    val sessionId: String? = null,
    val sessionName: String = "",
    val sessionProvider: String = "",
    val enabled: Boolean = false,
    val autonomyLevel: String = "",
    val lastSnapshotAt: String? = null,
    val lastIncidentAt: String? = null,
)

// ============================================================================
// Admin
// ============================================================================

@Serializable
data class AdminStats(
    val userCount: Int = 0,
    val adminCount: Int = 0,
    val suspendedCount: Int = 0,
    val sessionCount: Int = 0,
    val runningSessionCount: Int = 0,
    val auditCount: Int = 0,
)

@Serializable
data class AdminUser(
    val id: String,
    val email: String = "",
    val name: String? = null,
    val provider: String = "",
    val role: String = "user",
    val status: String = "active",
    val lastLoginAt: String? = null,
    val sessionCount: Int = 0,
)

@Serializable
data class AuditLogEntry(
    val id: Int,
    val actorEmail: String? = null,
    val action: String = "",
    val resourceType: String? = null,
    val resourceId: String? = null,
    val ip: String? = null,
    val createdAt: String = "",
)

@Serializable
data class AuditLogPage(
    val entries: List<AuditLogEntry> = emptyList(),
    val total: Int = 0,
)
