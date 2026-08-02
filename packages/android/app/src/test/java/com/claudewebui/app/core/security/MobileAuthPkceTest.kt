package com.claudewebui.app.core.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileAuthPkceTest {
    @Test
    fun createsRfc7636Challenge() {
        val verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            MobileAuthPkce.challenge(verifier),
        )
    }

    @Test
    fun createsUrlSafePendingLogin() {
        val pending = MobileAuthPkce.create()
        assertTrue(pending.state.matches(Regex("^[A-Za-z0-9_-]{43}$")))
        assertTrue(pending.verifier.matches(Regex("^[A-Za-z0-9_-]{43}$")))
        assertEquals(MobileAuthPkce.challenge(pending.verifier), pending.challenge)
    }
}
