package com.claudewebui.app.ui.theme

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector

// ── Provider Identifiers ─────────────────────────────────────────────────────

enum class CliProvider(val displayName: String, val id: String) {
    CLAUDE("Claude", "claude"),
    CODEX("Codex", "codex"),
    GEMINI("Gemini", "gemini"),
    GLM("GLM", "glm"),
    KIMI("Kimi", "kimi"),
    UNKNOWN("Unknown", "unknown"),
    ;

    companion object {
        fun fromId(id: String): CliProvider =
            entries.find { it.id.equals(id, ignoreCase = true) } ?: UNKNOWN
    }
}

// ── Provider Theme Data ──────────────────────────────────────────────────────

@Immutable
data class ProviderTheme(
    val color: Color,
    val colorDark: Color,
    val containerColor: Color,
    val containerColorDark: Color,
    val onContainerColor: Color,
    val onContainerColorDark: Color,
    val icon: ImageVector,
    val displayName: String,
)

// ── Provider Theme Registry ──────────────────────────────────────────────────

object ProviderThemes {

    private val themes = mapOf(
        CliProvider.CLAUDE to ProviderTheme(
            color = ClaudeColor,
            colorDark = Color(0xFFE0A08A),
            containerColor = Color(0xFFFFF1EC),
            containerColorDark = Color(0xFF3D1F13),
            onContainerColor = Color(0xFF7A3D28),
            onContainerColorDark = Color(0xFFE0A08A),
            icon = Icons.Filled.AutoAwesome,
            displayName = "Claude",
        ),
        CliProvider.CODEX to ProviderTheme(
            color = CodexColor,
            colorDark = Color(0xFF4DD8A8),
            containerColor = Color(0xFFE6F9F1),
            containerColorDark = Color(0xFF0A3323),
            onContainerColor = Color(0xFF0A5C3F),
            onContainerColorDark = Color(0xFF4DD8A8),
            icon = Icons.Filled.Code,
            displayName = "Codex",
        ),
        CliProvider.GEMINI to ProviderTheme(
            color = GeminiColor,
            colorDark = Color(0xFF8AB4F8),
            containerColor = Color(0xFFE8F0FE),
            containerColorDark = Color(0xFF102A56),
            onContainerColor = Color(0xFF1A56C4),
            onContainerColorDark = Color(0xFF8AB4F8),
            icon = Icons.Filled.Psychology,
            displayName = "Gemini",
        ),
        CliProvider.GLM to ProviderTheme(
            color = GlmColor,
            colorDark = Color(0xFFFFA070),
            containerColor = Color(0xFFFFF0E8),
            containerColorDark = Color(0xFF4A1E08),
            onContainerColor = Color(0xFFCC4400),
            onContainerColorDark = Color(0xFFFFA070),
            icon = Icons.Filled.FlashOn,
            displayName = "GLM",
        ),
        CliProvider.KIMI to ProviderTheme(
            color = KimiColor,
            colorDark = Color(0xFFA78BFA),
            containerColor = Color(0xFFF0EBFF),
            containerColorDark = Color(0xFF2E1065),
            onContainerColor = Color(0xFF5B21B6),
            onContainerColorDark = Color(0xFFA78BFA),
            icon = Icons.Filled.Cloud,
            displayName = "Kimi",
        ),
    )

    private val fallbackTheme = ProviderTheme(
        color = Color(0xFF6B7280),
        colorDark = Color(0xFF9CA3AF),
        containerColor = Color(0xFFF3F4F6),
        containerColorDark = Color(0xFF1F2937),
        onContainerColor = Color(0xFF374151),
        onContainerColorDark = Color(0xFF9CA3AF),
        icon = Icons.Filled.Code,
        displayName = "Unknown",
    )

    fun get(provider: CliProvider): ProviderTheme =
        themes[provider] ?: fallbackTheme

    /**
     * Returns the appropriate foreground color for a provider based on the
     * current dark/light theme.
     */
    @Composable
    fun color(provider: CliProvider, isDark: Boolean): Color {
        val theme = get(provider)
        return if (isDark) theme.colorDark else theme.color
    }

    /**
     * Returns the appropriate container color for a provider badge/chip.
     */
    @Composable
    fun containerColor(provider: CliProvider, isDark: Boolean): Color {
        val theme = get(provider)
        return if (isDark) theme.containerColorDark else theme.containerColor
    }

    /**
     * Returns the text/icon color to use on the container background.
     */
    @Composable
    fun onContainerColor(provider: CliProvider, isDark: Boolean): Color {
        val theme = get(provider)
        return if (isDark) theme.onContainerColorDark else theme.onContainerColor
    }
}
