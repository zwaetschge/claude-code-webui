package com.claudewebui.app.data.model

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagePageResponseTest {
    @Test
    fun `decodes root pagination next to list data`() {
        val response = Json { ignoreUnknownKeys = true }.decodeFromString<MessagePageResponse<Message>>(
            """{
              "success": true,
              "data": [{
                "id": "m2", "sessionId": "s1", "role": "user",
                "content": "hello", "createdAt": "2026-08-09T00:00:00Z"
              }],
              "pagination": {
                "total": 501, "limit": 200, "hasMore": true,
                "hasMoreBefore": true, "hasMoreAfter": true,
                "oldestId": "m2", "newestId": "m80",
                "aroundId": "m42", "anchorIndex": 41
              }
            }""",
        )

        assertEquals("m2", response.data?.single()?.id)
        assertEquals(501, response.pagination.total)
        assertTrue(response.pagination.hasMore)
        assertTrue(response.pagination.hasMoreBefore)
        assertTrue(response.pagination.hasMoreAfter)
        assertEquals("m80", response.pagination.newestId)
        assertEquals("m42", response.pagination.aroundId)
        assertEquals(41, response.pagination.anchorIndex)
    }
}
