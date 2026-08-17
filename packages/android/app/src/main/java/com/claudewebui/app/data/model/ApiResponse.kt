package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class ApiResponse<T>(
    val success: Boolean,
    val data: T? = null,
    val error: ApiError? = null
)

/** Pagination metadata returned next to the message list. */
@Serializable
data class MessagePagination(
    val total: Int = 0,
    val limit: Int = 0,
    val hasMore: Boolean = false,
    val hasMoreBefore: Boolean = hasMore,
    val hasMoreAfter: Boolean = false,
    val oldestId: String? = null,
    val newestId: String? = null,
    val aroundId: String? = null,
    val anchorIndex: Int? = null,
)

/**
 * The messages endpoint keeps its list in `data` for backwards compatibility
 * and adds pagination at the response root.
 */
@Serializable
data class MessagePageResponse<T>(
    val success: Boolean,
    val data: List<T>? = null,
    val pagination: MessagePagination = MessagePagination(),
    val snapshot: MessageHistorySnapshot? = null,
    val readState: SessionReadState? = null,
    val error: ApiError? = null,
)

@Serializable
data class ApiError(
    val code: String = "",
    val message: String,
    val details: JsonElement? = null
)

@Serializable
data class PaginatedResponse<T>(
    val items: List<T>,
    val total: Int,
    val page: Int,
    val pageSize: Int,
    val hasMore: Boolean
)
