package com.claudewebui.app.data.local.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.claudewebui.app.data.model.ChatMedia
import com.claudewebui.app.data.model.Message
import com.claudewebui.app.data.model.MessageRole
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val mediaJson = Json { ignoreUnknownKeys = true }

/**
 * Room entity that caches individual chat [Message] records.
 *
 * Foreign key on [sessionId] → [SessionEntity.id] with CASCADE delete so that
 * messages are automatically cleaned up when a session is removed from the cache.
 */
@Entity(
    tableName = "messages",
    foreignKeys = [
        ForeignKey(
            entity = SessionEntity::class,
            parentColumns = ["id"],
            childColumns = ["sessionId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index(value = ["sessionId"]),
        Index(value = ["sessionId", "timestamp"]),
        Index(value = ["sessionId", "chatId", "timestamp"]),
    ]
)
data class MessageEntity(
    @PrimaryKey
    val id: String,
    val sessionId: String,
    val chatId: String? = null,
    val role: String,          // MessageRole name
    val content: String,
    val timestamp: String,     // ISO-8601 string from createdAt
    val isUser: Boolean,       // Derived from role == USER for quick filtering
    val media: String? = null, // JSON-encoded List<ChatMedia>, null when absent
    val clientMessageId: String? = null,
    val eventSequence: Long? = null,
)

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

fun Message.toEntity(): MessageEntity = MessageEntity(
    id = id,
    sessionId = sessionId,
    chatId = chatId,
    role = role.name,
    content = content,
    timestamp = createdAt,
    isUser = role == MessageRole.USER,
    media = media?.takeIf { it.isNotEmpty() }?.let { mediaJson.encodeToString(it) },
    clientMessageId = clientMessageId,
    eventSequence = eventSequence,
)

fun MessageEntity.toModel(): Message = Message(
    id = id,
    sessionId = sessionId,
    chatId = chatId,
    role = runCatching { MessageRole.valueOf(role) }.getOrDefault(MessageRole.ASSISTANT),
    content = content,
    createdAt = timestamp,
    media = media?.let { raw ->
        runCatching { mediaJson.decodeFromString<List<ChatMedia>>(raw) }.getOrNull()
    },
    clientMessageId = clientMessageId,
    eventSequence = eventSequence,
)
