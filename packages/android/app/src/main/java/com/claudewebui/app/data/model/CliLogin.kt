package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

/**
 * A CLI harness login run on the server.
 *
 * The server spawns the harness's own auth command and relays what it prints.
 * Depending on the provider this is either a device-code flow — open
 * [loginUrl], type [verificationCode] — or a prompt that wants a pasted code,
 * which is what `awaiting_code` signals.
 */
@Serializable
data class CliLoginSession(
    val id: String,
    val provider: String,
    val status: String,
    val loginUrl: String? = null,
    val verificationCode: String? = null,
    val output: String = "",
    val error: String? = null,
) {
    val isFinished: Boolean get() = status == "completed" || status == "error"
    val needsCode: Boolean get() = status == "awaiting_code"
}

@Serializable
data class CliLoginCodeInput(val code: String)
