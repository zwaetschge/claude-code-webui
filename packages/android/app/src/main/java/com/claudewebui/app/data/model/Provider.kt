package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class ProviderType {
    @SerialName("openai") OPENAI,
    @SerialName("anthropic") ANTHROPIC,
    @SerialName("google") GOOGLE,
    @SerialName("openrouter") OPENROUTER,
    @SerialName("zai") ZAI,
    @SerialName("ollama") OLLAMA,
    @SerialName("custom") CUSTOM
}

@Serializable
enum class AuthMethod {
    @SerialName("api_key") API_KEY,
    @SerialName("oauth") OAUTH
}

@Serializable
data class AIProvider(
    val id: String,
    @SerialName("user_id") val userId: String,
    val name: String,
    val type: ProviderType,
    @SerialName("base_url") val baseUrl: String? = null,
    val models: String? = null, // JSON array of model IDs
    @SerialName("default_model") val defaultModel: String? = null,
    val enabled: Boolean = true,
    @SerialName("auth_method") val authMethod: AuthMethod? = null,
    @SerialName("has_oauth_token") val hasOauthToken: Boolean = false,
    @SerialName("oauth_expires_at") val oauthExpiresAt: String? = null,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String
)

@Serializable
data class CreateProviderInput(
    val name: String,
    val type: ProviderType,
    @SerialName("api_key") val apiKey: String? = null,
    @SerialName("base_url") val baseUrl: String? = null,
    val models: List<String>? = null,
    @SerialName("default_model") val defaultModel: String? = null,
    val enabled: Boolean = true
)

@Serializable
data class UpdateProviderInput(
    val name: String? = null,
    val type: ProviderType? = null,
    @SerialName("api_key") val apiKey: String? = null,
    @SerialName("base_url") val baseUrl: String? = null,
    val models: List<String>? = null,
    @SerialName("default_model") val defaultModel: String? = null,
    val enabled: Boolean? = null
)

@Serializable
data class CLIProviderStatus(
    val claude: Boolean = false,
    val codex: Boolean = false,
    val opencode: Boolean = false,
    val pi: Boolean = false
)
