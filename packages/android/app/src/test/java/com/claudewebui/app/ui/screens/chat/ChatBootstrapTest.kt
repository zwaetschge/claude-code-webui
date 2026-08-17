package com.claudewebui.app.ui.screens.chat

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatBootstrapTest {

    @Test
    fun `session parent is cached before messages`() = runBlocking {
        val calls = mutableListOf<String>()

        val result = loadSessionThenMessages(
            loadSession = {
                calls += "session"
                Result.success(Unit)
            },
            onSessionLoaded = { calls += "ready" },
            loadMessages = {
                calls += "messages"
                Result.success(Unit)
            },
        )

        assertTrue(result.isSuccess)
        assertEquals(listOf("session", "ready", "messages"), calls)
    }

    @Test
    fun `messages are not cached when session load fails`() = runBlocking {
        val failure = IllegalStateException("session unavailable")
        val calls = mutableListOf<String>()

        val result = loadSessionThenMessages(
            loadSession = {
                calls += "session"
                Result.failure(failure)
            },
            onSessionLoaded = { calls += "ready" },
            loadMessages = {
                calls += "messages"
                Result.success(Unit)
            },
        )

        assertSame(failure, result.exceptionOrNull())
        assertEquals(listOf("session"), calls)
    }
}
