package com.claudewebui.app.core.shortcuts

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import com.claudewebui.app.MainActivity
import com.claudewebui.app.R
import com.claudewebui.app.data.model.Session

/**
 * Long-press shortcuts on the launcher icon for the sessions you actually
 * return to. Getting back into a running session otherwise costs a cold start
 * plus a scroll through the list.
 */
object SessionShortcuts {

    /** Android caps these low; four leaves room for the launcher's own entries. */
    private const val MAX_SHORTCUTS = 4

    fun publish(context: Context, sessions: List<Session>) {
        val shortcuts = sessions
            .sortedByDescending { it.updatedAt }
            .take(MAX_SHORTCUTS)
            .map { session ->
                val label = session.name.ifBlank { "Session" }.take(24)
                ShortcutInfoCompat.Builder(context, "session_${session.id}")
                    .setShortLabel(label)
                    .setLongLabel(label)
                    .setIcon(IconCompat.createWithResource(context, R.drawable.ic_notification))
                    .setIntent(
                        Intent(
                            Intent.ACTION_VIEW,
                            Uri.parse("claudewebui://session/${session.id}"),
                            context,
                            MainActivity::class.java,
                        )
                    )
                    .build()
            }

        // Never let shortcut upkeep take the app down: an OEM launcher that
        // rejects the update is not worth a crash on the dashboard.
        runCatching { ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts) }
    }
}
