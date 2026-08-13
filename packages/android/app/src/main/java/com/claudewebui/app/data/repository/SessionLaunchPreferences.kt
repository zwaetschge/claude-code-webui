package com.claudewebui.app.data.repository

import android.content.Context
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.SessionMode

data class SessionLaunchSetup(
    val provider: CLIProvider = CLIProvider.CODEX,
    val mode: SessionMode = SessionMode.AUTO_ACCEPT,
    val workingDirectory: String? = null,
    val categoryId: String? = null,
)

data class SessionPreset(
    val id: String,
    val label: String,
    val description: String,
    val provider: CLIProvider,
    val mode: SessionMode,
)

val DEFAULT_SESSION_PRESETS = listOf(
    SessionPreset("build", "Build", "Implement autonomously", CLIProvider.CODEX, SessionMode.AUTO_ACCEPT),
    SessionPreset("plan", "Plan", "Explore without changes", CLIProvider.CODEX, SessionMode.PLANNING),
    SessionPreset("manual", "Manual", "Ask before tools", CLIProvider.CODEX, SessionMode.MANUAL),
)

class SessionLaunchPreferences(context: Context) {
    private val values = context.getSharedPreferences("session_launch", Context.MODE_PRIVATE)

    fun load(): SessionLaunchSetup = SessionLaunchSetup(
        provider = values.getString("provider", null)
            ?.let { CLIProvider.fromId(it) }
            ?: CLIProvider.CODEX,
        mode = values.getString("mode", null)
            ?.let { runCatching { SessionMode.valueOf(it) }.getOrNull() }
            ?: SessionMode.AUTO_ACCEPT,
        workingDirectory = values.getString("working_directory", null),
        categoryId = values.getString("category_id", null),
    )

    fun save(setup: SessionLaunchSetup) {
        values.edit()
            .putString("provider", setup.provider.name)
            .putString("mode", setup.mode.name)
            .putString("working_directory", setup.workingDirectory)
            .putString("category_id", setup.categoryId)
            .apply()
    }
}
