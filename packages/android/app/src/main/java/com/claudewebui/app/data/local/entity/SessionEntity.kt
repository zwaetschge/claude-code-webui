package com.claudewebui.app.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionStatus

/**
 * Room entity that caches [Session] data locally.
 * Indexed on [categoryId] for fast filtered queries.
 */
@Entity(
    tableName = "sessions",
    indices = [Index(value = ["categoryId"])]
)
data class SessionEntity(
    @PrimaryKey
    val id: String,
    val title: String,
    val provider: String,          // CLIProvider serialized name
    val status: String,            // SessionStatus serialized name
    val mode: String? = null,      // SessionMode serialized name, nullable
    val workingDirectory: String,
    val starred: Boolean = false,
    val lastMessage: String? = null,
    val categoryId: String? = null,
    val updatedAt: String,
    val createdAt: String
)

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

fun Session.toEntity(): SessionEntity = SessionEntity(
    id = id,
    title = name,
    provider = cliProvider.name,
    status = status.name,
    workingDirectory = workingDirectory,
    starred = starred,
    lastMessage = lastMessage,
    categoryId = category,
    updatedAt = updatedAt,
    createdAt = createdAt
)

fun SessionEntity.toModel(): Session = Session(
    id = id,
    userId = "",                   // Not stored locally — filled from API when available
    name = title,
    workingDirectory = workingDirectory,
    status = runCatching { SessionStatus.valueOf(status) }.getOrDefault(SessionStatus.STOPPED),
    cliProvider = runCatching { CLIProvider.valueOf(provider) }.getOrDefault(CLIProvider.CODEX),
    starred = starred,
    lastMessage = lastMessage,
    category = categoryId,
    updatedAt = updatedAt,
    createdAt = createdAt
)
