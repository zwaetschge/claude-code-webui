package com.claudewebui.app.data.local.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.claudewebui.app.data.model.Message
import com.claudewebui.app.data.model.MessageRole

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
        Index(value = ["sessionId", "timestamp"])
    ]
)
data class MessageEntity(
    @PrimaryKey
    val id: String,
    val sessionId: String,
    val role: String,          // MessageRole name
    val content: String,
    val timestamp: String,     // ISO-8601 string from createdAt
    val isUser: Boolean        // Derived from role == USER for quick filtering
)

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

fun Message.toEntity(): MessageEntity = MessageEntity(
    id = id,
    sessionId = sessionId,
    role = role.name,
    content = content,
    timestamp = createdAt,
    isUser = role == MessageRole.USER
)

fun MessageEntity.toModel(): Message = Message(
    id = id,
    sessionId = sessionId,
    role = runCatching { MessageRole.valueOf(role) }.getOrDefault(MessageRole.ASSISTANT),
    content = content,
    createdAt = timestamp
)
