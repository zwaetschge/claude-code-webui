package com.claudewebui.app.ui.screens.chat

import org.junit.Assert.assertEquals
import org.junit.Test

class StreamingBatchingTest {
    @Test
    fun `delta accumulator preserves order and drains once`() {
        val accumulator = StreamingDeltaAccumulator()
        accumulator.append("Hello")
        accumulator.append(" ")
        accumulator.append("world")

        assertEquals("Hello world", accumulator.drain())
        assertEquals("", accumulator.drain())
        assertEquals(50L, STREAM_FLUSH_MS)
    }

    @Test
    fun `attachment limits match the mobile contract`() {
        assertEquals(8, MAX_ATTACHMENT_COUNT)
        assertEquals(25L * 1024L * 1024L, MAX_ATTACHMENT_BYTES)
        assertEquals("32.0 MB", formatBytes(MAX_TOTAL_ATTACHMENT_BYTES))
    }
}
