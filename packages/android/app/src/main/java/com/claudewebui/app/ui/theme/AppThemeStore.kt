package com.claudewebui.app.ui.theme

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class AppThemeOption(val label: String, val description: String) {
    SYSTEM("System", "Follow device setting"),
    DARK("Dark", "Graphite glass surface"),
    LIGHT("Light", "Bright glass surface"),
    EINK("E-Ink", "High contrast, no glow"),
}

/**
 * Holds the selected theme for the whole app.
 *
 * The activity has to observe this — it sits above the navigation graph and
 * owns the system bar colours, so a preference kept only inside the settings
 * ViewModel could never repaint anything. Backed by the same SharedPreferences
 * file the rest of the local settings use, so the choice survives restarts and
 * is readable before Compose starts.
 */
object AppThemeStore {

    private const val PREFS_NAME = "settings_prefs"
    private const val KEY_THEME = "theme"

    private val _theme = MutableStateFlow(AppThemeOption.SYSTEM)
    val theme: StateFlow<AppThemeOption> = _theme.asStateFlow()

    fun initialize(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val stored = prefs.getString(KEY_THEME, AppThemeOption.SYSTEM.name)
        _theme.value = AppThemeOption.entries.firstOrNull { it.name == stored }
            ?: AppThemeOption.SYSTEM
    }

    fun set(context: Context, option: AppThemeOption) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_THEME, option.name)
            .apply()
        _theme.value = option
    }
}
