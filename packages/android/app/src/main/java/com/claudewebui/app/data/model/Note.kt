package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * A scratch note, optionally tied to a session.
 *
 * The backend returns SQLite rows verbatim, so the wire format is snake_case
 * here even though the rest of the API is camelCase.
 */
@Serializable
data class Note(
    val id: String,
    @SerialName("user_id") val userId: String = "",
    @SerialName("session_id") val sessionId: String? = null,
    val title: String = "",
    val content: String = "",
    // SQLite stores booleans as INTEGER and this route returns rows verbatim,
    // so the wire value is 0/1. Declaring Boolean here made every response fail
    // to decode, which surfaced as duplicate notes rather than as an error.
    val pinned: Int = 0,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
) {
    val isPinned: Boolean get() = pinned != 0
}

@Serializable
data class CreateNoteInput(
    val title: String? = null,
    val content: String? = null,
    val sessionId: String? = null,
    val pinned: Boolean? = null,
)

@Serializable
data class UpdateNoteInput(
    val title: String? = null,
    val content: String? = null,
    val pinned: Boolean? = null,
)

@Serializable
data class SaveFileInput(val path: String, val content: String)
