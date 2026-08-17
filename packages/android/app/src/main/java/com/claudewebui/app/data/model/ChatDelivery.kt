package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class ActiveFollowupMode {
    @SerialName("queue") QUEUE,
    @SerialName("steer") STEER,
}

@Serializable
data class SessionSendAttachmentResult(
    val uploadId: String? = null,
    val filename: String = "",
    val status: String = "accepted",
    val error: String? = null,
)

data class SessionSendAck(
    val clientMessageId: String,
    val status: SendStatus,
    val chatId: String? = null,
    val acceptedAt: String? = null,
    val messageId: String? = null,
    val disposition: String? = null,
    val highWatermark: Long? = null,
    val attachments: List<SessionSendAttachmentResult> = emptyList(),
    val error: String? = null,
    val retryable: Boolean = false,
) {
    enum class SendStatus { ACCEPTED, REJECTED }
}

@Serializable
data class ChatUpload(
    val id: String,
    val sessionId: String,
    val filename: String,
    val mimeType: String,
    val byteSize: Long,
    val sha256: String,
    val chunkSize: Int,
    val totalChunks: Int,
    val receivedBytes: Long = 0,
    val receivedChunks: List<Int> = emptyList(),
    val missingChunks: List<Int> = emptyList(),
    val progress: Float = 0f,
    val status: String = "pending",
    val error: String? = null,
    val expiresAt: String = "",
    val createdAt: String = "",
    val updatedAt: String = "",
)

@Serializable
data class CreateChatUploadInput(
    val filename: String,
    val mimeType: String? = null,
    val byteSize: Long,
    val sha256: String,
    val chunkSize: Int? = null,
)

@Serializable
data class SessionReadState(
    val sessionId: String,
    val chatId: String? = null,
    val lastReadMessageId: String? = null,
    val unreadCount: Int = 0,
    val updatedAt: String? = null,
)

@Serializable
data class MessageHistorySnapshot(
    val chatId: String? = null,
    val revision: Long = 0,
    val highWatermark: Long = 0,
    val newestMessageId: String? = null,
)

@Serializable
data class MessageJumpTarget(
    val sessionId: String,
    val chatId: String? = null,
    val messageId: String,
)

@Serializable
data class MessageSearchResult(
    val id: String,
    val sessionId: String,
    val role: String = "assistant",
    val content: String,
    val createdAt: String,
    val sessionName: String? = null,
    val jump: MessageJumpTarget? = null,
)

@Serializable
data class PresenceViewer(
    val deviceId: String,
    val label: String? = null,
    val state: String = "active",
    val activeAt: String = "",
    val lastReadMessageId: String? = null,
)

@Serializable
data class PresenceSnapshot(
    val sessionId: String,
    val viewers: List<PresenceViewer> = emptyList(),
    val total: Int = viewers.size,
)

@Serializable
data class PersistedOutboxAttachment(
    val uri: String,
    val mimeType: String,
    val filename: String,
    val sizeBytes: Long? = null,
    val uploadId: String? = null,
    val progress: Float = 0f,
    val uploadedChunks: List<Int> = emptyList(),
    val totalChunks: Int = 0,
    val error: String? = null,
)
