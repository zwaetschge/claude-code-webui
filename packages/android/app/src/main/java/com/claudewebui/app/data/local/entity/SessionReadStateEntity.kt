package com.claudewebui.app.data.local.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.PrimaryKey
import com.claudewebui.app.data.model.SessionReadState

@Entity(
    tableName = "session_read_state",
    foreignKeys = [
        ForeignKey(
            entity = SessionEntity::class,
            parentColumns = ["id"],
            childColumns = ["sessionId"],
            onDelete = ForeignKey.CASCADE,
        )
    ],
)
data class SessionReadStateEntity(
    @PrimaryKey val sessionId: String,
    val chatId: String? = null,
    val lastReadMessageId: String? = null,
    val lastSeenSequence: Long = 0,
    val highWatermark: Long = 0,
    val snapshotRevision: Long = 0,
    val scrollAnchorMessageId: String? = null,
    val scrollOffset: Int = 0,
    val unreadCount: Int = 0,
    val updatedAt: String? = null,
)

fun SessionReadState.toEntity(existing: SessionReadStateEntity? = null) = SessionReadStateEntity(
    sessionId = sessionId,
    chatId = chatId,
    lastReadMessageId = lastReadMessageId,
    lastSeenSequence = existing?.lastSeenSequence ?: 0,
    highWatermark = existing?.highWatermark ?: 0,
    snapshotRevision = existing?.snapshotRevision ?: 0,
    scrollAnchorMessageId = existing?.scrollAnchorMessageId,
    scrollOffset = existing?.scrollOffset ?: 0,
    unreadCount = unreadCount,
    updatedAt = updatedAt,
)

fun SessionReadStateEntity.toModel() = SessionReadState(
    sessionId = sessionId,
    chatId = chatId,
    lastReadMessageId = lastReadMessageId,
    unreadCount = unreadCount,
    updatedAt = updatedAt,
)
