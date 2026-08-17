package com.claudewebui.app.ui.screens.auth

import com.claudewebui.app.data.model.AuthUser

// ── Server Info ───────────────────────────────────────────────────────────────

data class ServerInfo(
    val url: String,
    val version: String? = null,
    val name: String? = null,
    val reachable: Boolean = false,
)

// ── Auth Config ───────────────────────────────────────────────────────────────

data class AuthConfig(
    val basicAuthEnabled: Boolean = false,
    val googleOAuthEnabled: Boolean = false,
    val githubOAuthEnabled: Boolean = false,
    val claudeOAuthEnabled: Boolean = false,
    val proxyAuthEnabled: Boolean = false,
    val devLoginEnabled: Boolean = false,
)

// ── Auth UI State ─────────────────────────────────────────────────────────────

sealed class AuthState {

    /** Initial state — nothing has happened yet */
    object Idle : AuthState()

    /** Testing connection to the server */
    object Connecting : AuthState()

    /**
     * Server is reachable. Auth method selection should be shown.
     * @param serverInfo Details about the connected server.
     * @param authConfig Which auth methods the server supports.
     */
    data class Connected(
        val serverInfo: ServerInfo,
        val authConfig: AuthConfig,
    ) : AuthState()

    /** User picked an auth method and credentials are being verified */
    object Authenticating : AuthState()

    /**
     * Auth succeeded — user is logged in.
     * @param user The authenticated user returned from the server.
     */
    data class Authenticated(val user: AuthUser) : AuthState()

    /**
     * Something went wrong.
     * @param message Human-readable error description.
     * @param isConnectionError True if the server was unreachable (vs auth failure).
     */
    data class Error(
        val message: String,
        val isConnectionError: Boolean = false,
    ) : AuthState()
}

// ── Server Setup UI State ─────────────────────────────────────────────────────

sealed class ServerSetupState {
    object Idle : ServerSetupState()
    object Testing : ServerSetupState()
    data class Success(val serverInfo: ServerInfo) : ServerSetupState()
    data class Error(val message: String) : ServerSetupState()
}
