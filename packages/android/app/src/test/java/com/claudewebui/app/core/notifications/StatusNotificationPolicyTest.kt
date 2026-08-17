package com.claudewebui.app.core.notifications

import com.claudewebui.app.data.model.SessionStatus
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StatusNotificationPolicyTest {
    @Test
    fun `stopped status cannot replace a rich reply notification`() {
        assertFalse(shouldPostGenericStatusNotification(SessionStatus.STOPPED))
    }

    @Test
    fun `errors still produce an urgent status notification`() {
        assertTrue(shouldPostGenericStatusNotification(SessionStatus.ERROR))
    }
}
