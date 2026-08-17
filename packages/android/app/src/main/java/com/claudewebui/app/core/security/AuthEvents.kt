package com.claudewebui.app.core.security

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

/**
 * Signals that the server rejected our credentials.
 *
 * Without this an expired token was invisible: requests kept failing, the UI
 * kept rendering whatever Room had cached, and nothing ever asked the user to
 * sign in again. Anything that lives only on the server — categories, for
 * instance — simply stayed empty.
 */
object AuthEvents {

    // Replay so a rejection that lands before navigation is collecting is not
    // lost; extra emissions while already signed out are harmless.
    private val _sessionExpired = MutableSharedFlow<Unit>(
        replay = 1,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val sessionExpired: SharedFlow<Unit> = _sessionExpired

    fun notifySessionExpired() {
        _sessionExpired.tryEmit(Unit)
    }

    /** Called once the user is back on the login screen. */
    fun consume() {
        _sessionExpired.resetReplayCache()
    }
}
