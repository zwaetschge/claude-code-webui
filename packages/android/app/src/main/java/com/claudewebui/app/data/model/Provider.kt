package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class CLIProviderConfig(
    val id: String,
    val name: String,
    val defaultModel: String? = null,
    val models: List<String> = emptyList(),
    val enabled: Boolean = true,
    val available: Boolean = false,
)

@Serializable
data class OpenCodeProvider(
    val id: String,
    val name: String,
    val apiKey: String = "",
    val hasKey: Boolean = false,
    val envVars: List<String> = emptyList(),
    val baseUrl: String? = null,
    val enabled: Boolean = true,
)

@Serializable
data class SaveOpenCodeProviderInput(
    val id: String,
    val name: String,
    val apiKey: String? = null,
    val baseUrl: String? = null,
    val enabled: Boolean = true,
)

@Serializable
data class OpenCodeProviderTest(
    val connected: Boolean = false,
    val message: String = "",
    val envVars: List<String> = emptyList(),
    val modelCount: Int = 0,
)
