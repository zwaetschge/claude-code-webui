package com.claudewebui.app.ui.components.chat

/** Matches the backend permission route's authoritative 120-second wait. */
internal const val PERMISSION_REQUEST_LIFETIME_SECONDS = 120

/** Pure countdown calculation so request switches cannot leak stale timer state. */
internal fun permissionSecondsRemaining(elapsedSeconds: Int): Int =
    (PERMISSION_REQUEST_LIFETIME_SECONDS - elapsedSeconds.coerceAtLeast(0)).coerceAtLeast(0)
