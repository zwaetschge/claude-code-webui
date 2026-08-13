package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

/**
 * Models for the `api/workspace` routes: session templates, the notification
 * centre, cross-device drafts and per-turn working-tree diffs.
 */

@Serializable
data class SessionTemplate(
    val id: String,
    val name: String,
    val cliProvider: String? = null,
    val cliModel: String? = null,
    val cliReasoning: String? = null,
    val mode: String? = null,
    val workingDirectory: String? = null,
    val designStyleSkill: String? = null,
    val writingStyleSkill: String? = null,
    val surface: String = "code",
)

@Serializable
data class CreateSessionTemplateInput(
    val name: String,
    val cliProvider: String? = null,
    val cliModel: String? = null,
    val cliReasoning: String? = null,
    val mode: String? = null,
    val workingDirectory: String? = null,
    val designStyleSkill: String? = null,
    val writingStyleSkill: String? = null,
    val surface: String = "code",
)

@Serializable
data class AppNotification(
    val id: String,
    val sessionId: String? = null,
    val kind: String = "reply",
    val title: String = "",
    val body: String? = null,
    /** Approval rows carry the requestId so the feed can answer in place. */
    val data: NotificationPayload? = null,
    val readAt: String? = null,
    val createdAt: String = "",
)

@Serializable
data class NotificationPayload(
    val requestId: String? = null,
    val toolName: String? = null,
    val suggestedPattern: String? = null,
)

@Serializable
data class NotificationFeed(
    val items: List<AppNotification> = emptyList(),
    val unreadCount: Int = 0,
)

@Serializable
data class SessionDraft(
    val content: String = "",
    val updatedAt: String? = null,
)

@Serializable
data class TurnDiffSummary(
    val id: String,
    val turnId: String? = null,
    val filesChanged: Int = 0,
    val insertions: Int = 0,
    val deletions: Int = 0,
    val summary: String? = null,
    val createdAt: String = "",
)

@Serializable
data class TurnDiffDetail(
    val id: String,
    val sessionId: String = "",
    val turnId: String? = null,
    val filesChanged: Int = 0,
    val insertions: Int = 0,
    val deletions: Int = 0,
    val summary: String? = null,
    val diff: String = "",
    val createdAt: String = "",
)

/** Account-wide alert thresholds mirrored from `/api/settings`. */
@Serializable
data class UsageAlertSettings(
    val enabled: Boolean = true,
    val quotaPercent: Int = 80,
    val dailyCostUsd: Double = 5.0,
)

@Serializable
data class TranscriptionResult(val text: String = "")

@Serializable
data class BulkSessionInput(
    val ids: List<String>,
    val action: String,
    val categoryId: String? = null,
)

/** One connected peer session from `api/session-mesh`. */
@Serializable
data class SessionPeerTarget(
    val id: String = "",
    val name: String = "",
    val workingDirectory: String = "",
    val status: String = "stopped",
    val lastMessage: String? = null,
)

@Serializable
data class SessionPeerLink(
    val id: String = "",
    val sourceSessionId: String = "",
    val targetSessionId: String = "",
    val role: String? = null,
    val enabled: Boolean = true,
    val target: SessionPeerTarget? = null,
)
