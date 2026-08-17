package com.claudewebui.app.ui.components.chat

import org.junit.Assert.assertEquals
import org.junit.Test

class PermissionRequestTimingTest {
    @Test
    fun `matches the backend 120 second lifetime`() {
        assertEquals(120, PERMISSION_REQUEST_LIFETIME_SECONDS)
        assertEquals(120, permissionSecondsRemaining(0))
        assertEquals(90, permissionSecondsRemaining(30))
        assertEquals(1, permissionSecondsRemaining(119))
    }

    @Test
    fun `remaining time is clamped instead of becoming invalid`() {
        assertEquals(120, permissionSecondsRemaining(-1))
        assertEquals(0, permissionSecondsRemaining(120))
        assertEquals(0, permissionSecondsRemaining(180))
    }
}
