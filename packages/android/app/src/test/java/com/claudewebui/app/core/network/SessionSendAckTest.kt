package com.claudewebui.app.core.network

import com.claudewebui.app.data.model.SessionSendAck
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionSendAckTest {
    @Test
    fun `accepted acknowledgement keeps durable ids and cursor`() {
        val ack = parseSessionSendAck(
            JSONObject(
                """{
                    "clientMessageId":"client-1",
                    "status":"accepted",
                    "acceptedAt":"2026-08-09T12:00:00Z",
                    "messageId":"message-1",
                    "disposition":"queued",
                    "highWatermark":42
                }"""
            ),
            "fallback",
        )

        assertEquals(SessionSendAck.SendStatus.ACCEPTED, ack.status)
        assertEquals("client-1", ack.clientMessageId)
        assertEquals("message-1", ack.messageId)
        assertEquals("queued", ack.disposition)
        assertEquals(42L, ack.highWatermark)
        assertFalse(ack.retryable)
    }

    @Test
    fun `rejected acknowledgement exposes retryability`() {
        val ack = parseSessionSendAck(
            JSONObject("""{"status":"rejected","error":"busy","retryable":true}"""),
            "client-2",
        )

        assertEquals(SessionSendAck.SendStatus.REJECTED, ack.status)
        assertEquals("client-2", ack.clientMessageId)
        assertEquals("busy", ack.error)
        assertTrue(ack.retryable)
    }
}
