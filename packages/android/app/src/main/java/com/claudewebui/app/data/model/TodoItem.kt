package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class TodoStatus {
    @SerialName("pending") PENDING,
    @SerialName("in_progress") IN_PROGRESS,
    @SerialName("completed") COMPLETED
}

@Serializable
data class TodoItem(
    val content: String,
    val status: TodoStatus,
    val activeForm: String? = null
)
