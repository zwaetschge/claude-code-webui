package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Checkpoint(
    val id: String,
    @SerialName("session_id") val sessionId: String? = null,
    val name: String,
    val description: String? = null,
    @SerialName("message_count") val messageCount: Int,
    @SerialName("created_at") val createdAt: String
)

@Serializable
data class CreateCheckpointInput(
    val name: String,
    val description: String? = null
)

@Serializable
data class RestoreCheckpointInput(
    @SerialName("checkpoint_id") val checkpointId: String
)
