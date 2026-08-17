package com.claudewebui.app.core.notifications

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** Single source of truth for the user switch and Android notification access. */
object NotificationPreferences {
    private const val PREFS_NAME = "settings_prefs"
    private const val KEY_ENABLED = "notifications_enabled"

    fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(KEY_ENABLED, true)

    fun setEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_ENABLED, enabled)
            .apply()
    }

    fun hasRuntimePermission(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(
                context,
                android.Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED

    fun systemAllowsNotifications(context: Context): Boolean =
        hasRuntimePermission(context) &&
            NotificationManagerCompat.from(context).areNotificationsEnabled()

    fun canPostNotifications(context: Context): Boolean =
        isEnabled(context) && systemAllowsNotifications(context)
}
