package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class McpServerType {
    @SerialName("subprocess") SUBPROCESS,
    @SerialName("sse") SSE
}

@Serializable
data class McpServer(
    val id: String,
    val userId: String,
    val name: String,
    val type: McpServerType,
    val command: String? = null,
    val args: List<String> = emptyList(),
    val url: String? = null,
    val env: Map<String, String> = emptyMap(),
    val enabled: Boolean = true,
    val createdAt: String
)

/** Result of `POST /api/mcp-servers/:id/test`. */
@Serializable
data class McpTestResult(
    val connected: Boolean = false,
    val error: String? = null,
    val output: String? = null,
)

@Serializable
data class CreateMcpServerInput(
    val name: String,
    val type: McpServerType,
    val command: String? = null,
    val args: List<String>? = null,
    val url: String? = null,
    val env: Map<String, String>? = null,
    val enabled: Boolean? = null
)

@Serializable
data class UpdateMcpServerInput(
    val name: String? = null,
    val type: McpServerType? = null,
    val command: String? = null,
    val args: List<String>? = null,
    val url: String? = null,
    val env: Map<String, String>? = null,
    val enabled: Boolean? = null
)
