package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Category(
    val id: String,
    @SerialName("user_id") val userId: String,
    val name: String,
    val color: String,
    val icon: String,
    @SerialName("sort_order") val sortOrder: Int = 0,
    @SerialName("created_at") val createdAt: String
)

@Serializable
data class CreateCategoryInput(
    val name: String,
    val color: String = "#6366f1",
    val icon: String = "folder",
    @SerialName("sort_order") val sortOrder: Int = 0
)

@Serializable
data class UpdateCategoryInput(
    val name: String? = null,
    val color: String? = null,
    val icon: String? = null,
    @SerialName("sort_order") val sortOrder: Int? = null
)
