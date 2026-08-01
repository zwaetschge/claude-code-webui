package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class MessageRole {
    @SerialName("user") USER,
    @SerialName("assistant") ASSISTANT,
    @SerialName("system") SYSTEM
}

@Serializable
enum class AttachmentType {
    @SerialName("image") IMAGE,
    @SerialName("text") TEXT,
    @SerialName("pdf") PDF,
    @SerialName("document") DOCUMENT
}

@Serializable
data class MessageImage(
    val path: String,
    val filename: String
)

@Serializable
data class MessageAttachment(
    val path: String,
    val filename: String,
    val mimeType: String,
    val type: AttachmentType
)

@Serializable
data class Message(
    val id: String,
    val sessionId: String,
    val role: MessageRole,
    val content: String,
    val createdAt: String,
    val images: List<MessageImage>? = null,
    val attachments: List<MessageAttachment>? = null
)

@Serializable
data class StreamingMessage(
    val sessionId: String,
    val content: String,
    val isComplete: Boolean,
    val toolUse: ToolUseInfo? = null
)

@Serializable
data class ToolUseInfo(
    val name: String,
    val input: kotlinx.serialization.json.JsonElement? = null,
    val status: ToolUseStatus
)

@Serializable
enum class ToolUseStatus {
    @SerialName("pending") PENDING,
    @SerialName("running") RUNNING,
    @SerialName("completed") COMPLETED,
    @SerialName("error") ERROR
}

@Serializable
data class FileAttachmentData(
    val data: String, // base64 encoded
    val mimeType: String,
    val filename: String? = null
)
