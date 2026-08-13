package com.claudewebui.app.widget

import android.content.Context

/**
 * Per-widget-instance options chosen in [WidgetConfigActivity] when the widget
 * is placed. Stored in the widget prefs keyed by appWidgetId; deleted widgets
 * simply leave stale keys behind, which is harmless.
 */
data class WidgetConfig(
    /** "24h" shows today's numbers, "7d" the weekly ones (stat widgets). */
    val period: String = "24h",
    /** Provider display-name filter for list widgets; null = all providers. */
    val provider: String? = null,
    /** Use the more see-through background variant. */
    val translucent: Boolean = false,
)

object WidgetConfigStore {
    private const val PREFS = "plum_widget_cache"

    fun load(context: Context, appWidgetId: Int): WidgetConfig {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return WidgetConfig(
            period = prefs.getString("cfg_${appWidgetId}_period", "24h") ?: "24h",
            provider = prefs.getString("cfg_${appWidgetId}_provider", null),
            translucent = prefs.getBoolean("cfg_${appWidgetId}_translucent", false),
        )
    }

    fun save(context: Context, appWidgetId: Int, config: WidgetConfig) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().apply {
            putString("cfg_${appWidgetId}_period", config.period)
            if (config.provider == null) {
                remove("cfg_${appWidgetId}_provider")
            } else {
                putString("cfg_${appWidgetId}_provider", config.provider)
            }
            putBoolean("cfg_${appWidgetId}_translucent", config.translucent)
        }.apply()
    }
}
