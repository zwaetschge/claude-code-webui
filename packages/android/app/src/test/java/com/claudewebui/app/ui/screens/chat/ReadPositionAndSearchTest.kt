package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.data.model.Message
import com.claudewebui.app.data.model.MessageRole
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReadPositionAndSearchTest {
    private fun message(id: String) = Message(
        id = id,
        sessionId = "session",
        role = MessageRole.ASSISTANT,
        content = id,
        createdAt = "2026-08-09T12:00:00Z",
    )

    @Test
    fun `divider starts immediately after known read marker`() {
        val messages = listOf(message("one"), message("two"), message("three"))
        assertEquals(1, unreadDividerIndex(messages, "one", 2))
        assertNull(unreadDividerIndex(messages, "three", 0))
    }

    @Test
    fun `divider falls back to unread count if marker is outside cached window`() {
        val messages = listOf(message("one"), message("two"), message("three"))
        assertEquals(2, unreadDividerIndex(messages, "older", 1))
    }

    @Test
    fun `search snippet is centred around match`() {
        val content = "prefix ".repeat(30) + "needle" + " suffix".repeat(30)
        val snippet = searchSnippet(content, "needle", radius = 20)
        assertTrue(snippet.contains("needle"))
        assertTrue(snippet.startsWith("…"))
        assertTrue(snippet.endsWith("…"))
    }
}
