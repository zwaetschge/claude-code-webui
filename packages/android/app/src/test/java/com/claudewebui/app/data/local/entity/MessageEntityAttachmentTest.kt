package com.claudewebui.app.data.local.entity

import com.claudewebui.app.data.model.ChatMedia
import com.claudewebui.app.data.model.Message
import com.claudewebui.app.data.model.MessageRole
import org.junit.Assert.assertEquals
import org.junit.Test

class MessageEntityAttachmentTest {

    @Test
    fun `durable attachment metadata survives room mapping`() {
        val media = listOf(
            ChatMedia("image", "screen.png", "image/png", 1_024, "Screen", "user"),
            ChatMedia("pdf", "report.pdf", "application/pdf", 2_048, source = "user"),
            ChatMedia("text", "notes.txt", "text/plain", 42, source = "user"),
            ChatMedia("file", "archive.zip", "application/octet-stream", 4_096, source = "user"),
        )
        val message = Message(
            id = "message-1",
            sessionId = "session-1",
            role = MessageRole.USER,
            content = "",
            createdAt = "2026-08-09T11:00:00.000Z",
            media = media,
        )

        assertEquals(message, message.toEntity().toModel())
    }
}
