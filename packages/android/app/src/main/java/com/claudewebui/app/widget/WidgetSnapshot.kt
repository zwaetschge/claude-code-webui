package com.claudewebui.app.widget

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Everything the home-screen widgets can display, fetched in one pass and
 * cached so widgets keep showing the last known state when the server is
 * unreachable or the device is offline.
 */
@Serializable
data class WidgetSnapshot(
    val updatedAtMs: Long = 0,
    val today: WPeriod = WPeriod(),
    val week: WPeriod = WPeriod(),
    val providers: List<WEntry> = emptyList(),
    val models: List<WEntry> = emptyList(),
    val topSessions: List<WEntry> = emptyList(),
    val days: List<WDay> = emptyList(),
    val limits: List<WLimit> = emptyList(),
    val sessions: List<WSession> = emptyList(),
    val approvals: List<WApproval> = emptyList(),
)

@Serializable
data class WPeriod(
    val inputTokens: Long = 0,
    val outputTokens: Long = 0,
    val cacheReadTokens: Long = 0,
    val totalTokens: Long = 0,
    val costUsd: Double = 0.0,
    val requests: Long = 0,
)

@Serializable
data class WEntry(
    val id: String = "",
    val name: String = "",
    val sub: String = "",
    val tokens: Long = 0,
    val costUsd: Double = 0.0,
    val colorArgb: Long = 0xFF94A3B8,
)

@Serializable
data class WDay(
    val label: String = "",
    val tokens: Long = 0,
    val costUsd: Double = 0.0,
)

@Serializable
data class WLimit(
    val provider: String = "",
    val window: String = "",
    val percent: Int = 0,
    val colorArgb: Long = 0xFF94A3B8,
)

@Serializable
data class WSession(
    val id: String = "",
    val name: String = "",
    val provider: String = "",
    val status: String = "stopped",
    val mode: String = "",
)

@Serializable
data class WApproval(
    val sessionId: String = "",
    val sessionName: String = "",
    val toolName: String = "",
    val requestId: String = "",
)

/** Plain-prefs JSON cache for the last successful widget snapshot. */
object WidgetStore {
    private const val PREFS = "plum_widget_cache"
    private const val KEY = "snapshot_v1"
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    fun load(context: Context): WidgetSnapshot? =
        runCatching {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY, null)
                ?.let { json.decodeFromString<WidgetSnapshot>(it) }
        }.getOrNull()

    fun save(context: Context, snapshot: WidgetSnapshot) {
        runCatching {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY, json.encodeToString(WidgetSnapshot.serializer(), snapshot))
                .apply()
        }
    }
}
