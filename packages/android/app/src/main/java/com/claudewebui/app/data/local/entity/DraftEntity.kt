package com.claudewebui.app.data.local.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room entity that persists unsent message drafts per session.
 * One draft per session — upsert replaces the previous draft.
 *
 * Uses [sessionId] as primary key so that each session has at most one draft.
 */
@Entity(
    tableName = "drafts",
    foreignKeys = [
        ForeignKey(
            entity = SessionEntity::class,
            parentColumns = ["id"],
            childColumns = ["sessionId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index(value = ["sessionId"])]
)
data class DraftEntity(
    @PrimaryKey
    val sessionId: String,
    val content: String,
    val timestamp: Long = System.currentTimeMillis()
)
