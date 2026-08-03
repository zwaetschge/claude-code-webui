package com.claudewebui.app.ui.screens.chat

/**
 * Load the Room parent row before any child rows that reference it.
 *
 * Messages and drafts both have a foreign key to the session cache. Chat can
 * be opened directly from the network-backed dashboard or a deep link, so the
 * session is not guaranteed to exist in Room yet.
 */
internal suspend fun loadSessionThenMessages(
    loadSession: suspend () -> Result<Unit>,
    onSessionLoaded: suspend () -> Unit = {},
    loadMessages: suspend () -> Result<Unit>,
): Result<Unit> {
    loadSession().onFailure { return Result.failure(it) }
    onSessionLoaded()
    return loadMessages()
}
