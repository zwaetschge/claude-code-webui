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

/**
 * Durable media metadata the REST layer hydrates onto messages. Fetch the bytes
 * from `GET /api/sessions/:sessionId/media/:id`.
 */
@Serializable
data class ChatMedia(
    val id: String,
    val filename: String = "",
    val mimeType: String = "",
    val byteSize: Long = 0,
    val altText: String? = null,
    val source: String? = null
)

@Serializable
data class Message(
    val id: String,
    val sessionId: String,
    /** Thread identity is explicit on new servers; null remains legacy-compatible. */
    val chatId: String? = null,
    val role: MessageRole,
    val content: String,
    val createdAt: String,
    /** What the backend actually sends; see ChatMedia. */
    val media: List<ChatMedia>? = null,
    val images: List<MessageImage>? = null,
    val attachments: List<MessageAttachment>? = null,
    val clientMessageId: String? = null,
    val eventSequence: Long? = null,
)

@Serializable
data class StreamingMessage(
    val sessionId: String,
    val chatId: String? = null,
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

/**
 * A selected Android document before it is sent. Keeping only its content URI
 * here avoids retaining a second, Base64-expanded copy of large files in
 * Compose state. The bytes are read and encoded immediately before emit.
 */
data class PendingFileAttachment(
    val uri: String,
    val mimeType: String,
    val filename: String,
    val sizeBytes: Long? = null,
)
