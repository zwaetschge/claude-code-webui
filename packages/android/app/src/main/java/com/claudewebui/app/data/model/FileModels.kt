package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class FileType {
    @SerialName("file") FILE,
    @SerialName("directory") DIRECTORY
}

@Serializable
data class FileInfo(
    val name: String,
    val path: String,
    val type: FileType,
    val size: Long,
    val modifiedAt: String,
    val extension: String? = null
)

@Serializable
data class DirectoryContents(
    val path: String,
    val files: List<FileInfo>
)
