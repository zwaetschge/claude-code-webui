package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class GitStatus(
    val branch: String,
    val isClean: Boolean,
    val staged: List<String>,
    val unstaged: List<String>,
    val untracked: List<String>
)

@Serializable
data class GitCommit(
    val hash: String,
    val shortHash: String,
    val message: String,
    val author: String,
    val date: String
)

@Serializable
data class GitBranch(
    val name: String,
    val isCurrent: Boolean,
    val isRemote: Boolean
)

@Serializable
data class GitFileDiff(
    val file: String,
    val diff: String,
    val additions: Int,
    val deletions: Int,
    val staged: Boolean
)

@Serializable
data class GitCommitResult(
    val hash: String,
    val summary: GitCommitSummary
)

@Serializable
data class GitCommitSummary(
    val changes: Int,
    val insertions: Int,
    val deletions: Int
)

@Serializable
data class GitCommitInput(
    val message: String,
    val files: List<String>? = null
)

@Serializable
data class GitPushInput(
    val remote: String = "origin",
    val branch: String? = null
)
