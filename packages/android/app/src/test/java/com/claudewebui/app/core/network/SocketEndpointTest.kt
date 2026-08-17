package com.claudewebui.app.core.network

import org.junit.Assert.assertEquals
import org.junit.Test

class SocketEndpointTest {
    @Test
    fun directServerUsesDefaultSocketPath() {
        assertEquals(
            SocketEndpoint("https://example.test", "/socket.io"),
            socketEndpoint("https://example.test"),
        )
    }

    @Test
    fun mobileGatewayKeepsPrefixInSocketPath() {
        assertEquals(
            SocketEndpoint("https://example.test", "/mobile/socket.io"),
            socketEndpoint("https://example.test/mobile"),
        )
    }
}
