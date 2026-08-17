package com.claudewebui.app.data.repository

import com.claudewebui.app.data.model.SessionMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class SessionPresetTest {
    @Test
    fun `quick starts stay safe and cover plan build manual`() {
        assertEquals(listOf("build", "plan", "manual"), DEFAULT_SESSION_PRESETS.map { it.id })
        assertFalse(DEFAULT_SESSION_PRESETS.any { it.mode == SessionMode.DANGER })
    }
}
