package com.claudewebui.app.ui.screens.chat

import com.claudewebui.app.data.local.entity.OutboxEntity
import com.claudewebui.app.data.local.entity.OutboxStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeliveryStateTest {
    @Test
    fun `retry preserves the idempotency key`() {
        val failed = OutboxEntity(
            clientMessageId = "stable-client-id",
            sessionId = "session",
            content = "hello",
            status = OutboxStatus.FAILED.name,
            error = "timeout",
            retryable = true,
        )

        val retry = prepareOutboxRetry(failed)

        assertEquals("stable-client-id", retry.clientMessageId)
        assertEquals(OutboxStatus.SENDING, retry.deliveryStatus)
        assertNull(retry.error)
        assertTrue(retry.retryable)
    }

    @Test
    fun `chunk ranges cover final short chunk without overlap`() {
        assertEquals(0..3, chunkByteRange(0, 4, 10))
        assertEquals(4..7, chunkByteRange(1, 4, 10))
        assertEquals(8..9, chunkByteRange(2, 4, 10))
        assertNull(chunkByteRange(3, 4, 10))
    }

    @Test
    fun `sha256 is deterministic`() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            sha256Hex("abc".encodeToByteArray()),
        )
    }
}
