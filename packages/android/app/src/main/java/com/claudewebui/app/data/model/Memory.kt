package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

/**
 * One memory file under `~/.claude/projects/<encoded-cwd>/memory/`.
 *
 * The backend derives that directory from the session's working directory, so
 * every call needs `workingDirectory` — listing without it returns 400.
 */
@Serializable
data class MemoryFile(
    val name: String,
    val path: String,
    val size: Long = 0,
    val modifiedAt: String = "",
)

@Serializable
data class MemoryListing(
    val memoryDir: String = "",
    val files: List<MemoryFile> = emptyList(),
)

@Serializable
data class MemoryContent(
    val path: String = "",
    val content: String = "",
)

@Serializable
data class SaveMemoryInput(
    val workingDirectory: String,
    val path: String,
    val content: String,
)

@Serializable
data class CreateMemoryInput(
    val workingDirectory: String,
    val name: String,
    val content: String = "",
)
