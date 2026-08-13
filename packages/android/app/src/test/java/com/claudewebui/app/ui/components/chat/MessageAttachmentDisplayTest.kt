package com.claudewebui.app.ui.components.chat

import com.claudewebui.app.data.model.AttachmentType
import com.claudewebui.app.data.model.ChatMedia
import com.claudewebui.app.data.model.Message
import com.claudewebui.app.data.model.MessageAttachment
import com.claudewebui.app.data.model.MessageRole
import org.junit.Assert.assertEquals
import org.junit.Test

class MessageAttachmentDisplayTest {

    @Test
    fun `history exposes pdf text and generic file chips while images stay previews`() {
        val message = Message(
            id = "message-1",
            sessionId = "session-1",
            role = MessageRole.USER,
            content = "",
            createdAt = "2026-08-09T11:00:00.000Z",
            media = listOf(
                ChatMedia("image", "screen.png", "image/png", 1_024, source = "user"),
                ChatMedia("pdf", "report.pdf", "application/pdf", 2_048, source = "user"),
                ChatMedia("text", "notes.txt", "text/plain", 42, source = "user"),
                ChatMedia("file", "archive.zip", "application/octet-stream", 4_096, source = "user"),
            ),
        )

        val items = historyFileAttachments(message)

        assertEquals(listOf("report.pdf", "notes.txt", "archive.zip"), items.map { it.filename })
        assertEquals(
            listOf(
                HistoryAttachmentKind.PDF,
                HistoryAttachmentKind.TEXT,
                HistoryAttachmentKind.DOCUMENT,
            ),
            items.map { it.kind },
        )
        assertEquals("2.0 KB", formatAttachmentSize(2_048))
    }

    @Test
    fun `legacy socket attachment remains visible without durable media`() {
        val message = Message(
            id = "message-2",
            sessionId = "session-1",
            role = MessageRole.USER,
            content = "legacy",
            createdAt = "2026-08-09T11:00:00.000Z",
            attachments = listOf(
                MessageAttachment("", "fallback.md", "text/markdown", AttachmentType.TEXT),
            ),
        )

        assertEquals("fallback.md", historyFileAttachments(message).single().filename)
        assertEquals(HistoryAttachmentKind.TEXT, historyFileAttachments(message).single().kind)
    }

    @Test
    fun `markdown link retains its clickable target`() {
        val parsed = parseInline("Read [the guide](https://example.com/guide).")
        val annotation = parsed.getStringAnnotations("URL", 0, parsed.length).single()

        assertEquals("https://example.com/guide", annotation.item)
        assertEquals("the guide", parsed.text.substring(annotation.start, annotation.end))
    }
}
