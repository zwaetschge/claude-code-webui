package com.claudewebui.app.ui.theme

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MotionPreferencesTest {
    @Test
    fun `zero animator scale enables reduced motion`() {
        assertTrue(isReducedMotionScale(0f))
        assertTrue(isReducedMotionScale(.001f))
        assertFalse(isReducedMotionScale(1f))
    }
}
