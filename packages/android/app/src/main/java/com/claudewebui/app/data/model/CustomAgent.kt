package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class CustomAgent(
    val id: String,
    val name: String,
    val description: String? = null,
    @SerialName("system_prompt") val systemPrompt: String,
    val model: String,
    val allowedTools: List<String> = emptyList(),
    @SerialName("permission_mode") val permissionMode: String = "manual",
    val icon: String = "bot",
    val color: String = "#6366f1",
    val enabled: Boolean = true,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String
)

// The write routes destructure camelCase (`systemPrompt`, `permissionMode`)
// from the body — only the *responses* are raw snake_case SQLite rows.
@Serializable
data class CreateCustomAgentInput(
    val name: String,
    val description: String? = null,
    val systemPrompt: String,
    val model: String,
    val allowedTools: List<String>? = null,
    val permissionMode: String? = null,
    val icon: String? = null,
    val color: String? = null,
    val enabled: Boolean? = null
)

@Serializable
data class UpdateCustomAgentInput(
    val name: String? = null,
    val description: String? = null,
    val systemPrompt: String? = null,
    val model: String? = null,
    val allowedTools: List<String>? = null,
    val permissionMode: String? = null,
    val icon: String? = null,
    val color: String? = null,
    val enabled: Boolean? = null
)
