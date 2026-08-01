package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
enum class PermissionAction {
    @SerialName("allow_once") ALLOW_ONCE,
    @SerialName("allow_project") ALLOW_PROJECT,
    @SerialName("allow_global") ALLOW_GLOBAL,
    @SerialName("deny") DENY
}

@Serializable
data class PermissionRequest(
    val sessionId: String,
    val requestId: String,
    val toolName: String,
    val toolInput: JsonElement? = null,
    val description: String,
    val suggestedPattern: String
)

@Serializable
data class PermissionResponse(
    val sessionId: String,
    val requestId: String,
    val action: PermissionAction,
    val pattern: String? = null
)

@Serializable
data class PermissionDenial(
    @SerialName("tool_name") val toolName: String,
    @SerialName("tool_use_id") val toolUseId: String,
    @SerialName("tool_input") val toolInput: JsonElement? = null
)

@Serializable
data class PermissionRequestData(
    val sessionId: String,
    val denials: List<PermissionDenial>,
    val originalMessage: String
)
