package com.claudewebui.app.core.security

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

data class PendingMobileAuth(
    val state: String,
    val verifier: String,
    val challenge: String,
)

object MobileAuthPkce {
    private val encoder = Base64.getUrlEncoder().withoutPadding()

    fun create(): PendingMobileAuth {
        val random = SecureRandom()
        val state = ByteArray(32).also(random::nextBytes).let(encoder::encodeToString)
        val verifier = ByteArray(32).also(random::nextBytes).let(encoder::encodeToString)
        return PendingMobileAuth(
            state = state,
            verifier = verifier,
            challenge = challenge(verifier),
        )
    }

    fun challenge(verifier: String): String =
        encoder.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
}
