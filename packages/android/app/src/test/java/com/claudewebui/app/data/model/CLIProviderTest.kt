package com.claudewebui.app.data.model

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CLIProviderTest {
    @Test
    fun kimiUsesBackendWireId() {
        assertEquals("\"kimi\"", Json.encodeToString(CLIProvider.KIMI))
        assertEquals(CLIProvider.KIMI, Json.decodeFromString<CLIProvider>("\"kimi\""))
    }

    @Test
    fun kimiIsAnActiveStandaloneProvider() {
        assertTrue(CLIProvider.KIMI in CLIProvider.active)
        assertEquals("Kimi", CLIProvider.KIMI.displayName)
        assertEquals(CLIProvider.KIMI, CLIProvider.fromId("kimi"))
    }
}
