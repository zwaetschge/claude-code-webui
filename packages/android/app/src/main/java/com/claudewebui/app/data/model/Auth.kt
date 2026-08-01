package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class OAuthProvider {
    @SerialName("github") GITHUB,
    @SerialName("google") GOOGLE,
    @SerialName("claude") CLAUDE,
    @SerialName("codex") CODEX,
    @SerialName("zai") ZAI,
    @SerialName("dev") DEV,
    @SerialName("cli") CLI
}

@Serializable
data class AuthUser(
    val id: String,
    val email: String,
    val name: String? = null,
    val avatarUrl: String? = null,
    val provider: OAuthProvider,
    val providerId: String,
    val createdAt: String,
    val updatedAt: String
)

@Serializable
data class LoginRequest(
    val email: String = "dev@localhost",
    val name: String = "Dev User"
)

@Serializable
data class LoginResponse(
    val token: String,
    val user: AuthUser
)

@Serializable
data class AuthProviders(
    val github: Boolean = false,
    val google: Boolean = false,
    val claude: Boolean = false,
    val codex: Boolean = false,
    val opencode: Boolean = false,
    val pi: Boolean = false,
    val zai: Boolean = false
)

@Serializable
data class BasicAuthLoginRequest(
    val username: String,
    val password: String
)
