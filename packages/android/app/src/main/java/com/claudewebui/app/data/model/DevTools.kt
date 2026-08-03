package com.claudewebui.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ============================================================================
// Web preview
//
// Note: the preview routes answer with the bare object, not the usual
// ApiResponse envelope, so these are deserialized directly.
// ============================================================================

@Serializable
data class PreviewConfig(
    val enabled: Boolean = false,
    val hostname: String? = null,
)

@Serializable
data class PreviewPort(
    val port: Int,
    val name: String = "",
    val source: String = "",
    val reachable: Boolean = false,
    val status: Int? = null,
    val title: String? = null,
    val contentType: String? = null,
    val error: String? = null,
)

@Serializable
data class PreviewPortScan(
    val projectPath: String? = null,
    val scannedAt: String = "",
    val ports: List<PreviewPort> = emptyList(),
)

@Serializable
data class PreviewProcess(
    val name: String = "",
    val command: String = "",
    val running: Boolean = false,
    val pid: Int? = null,
    val status: String = "",
    val startedAt: String? = null,
    val exitCode: Int? = null,
    val error: String? = null,
    val outputTail: List<String> = emptyList(),
)

@Serializable
data class PreviewStartInput(val projectPath: String, val script: String = "")

// ============================================================================
// GitHub
// ============================================================================

/**
 * GitHub payloads keep the API's snake_case: the backend service forwards
 * GitHub's own field names rather than remapping them.
 */
@Serializable
data class GitHubUser(
    val login: String = "",
    val name: String? = null,
    val email: String? = null,
    @SerialName("avatar_url") val avatarUrl: String? = null,
    @SerialName("public_repos") val publicRepos: Int = 0,
)

@Serializable
data class GitHubTokenStatus(
    val valid: Boolean = false,
    val user: GitHubUser? = null,
    val scopes: List<String> = emptyList(),
    val error: String? = null,
)

@Serializable
data class GitHubRepo(
    val name: String = "",
    @SerialName("full_name") val fullName: String = "",
    val description: String? = null,
    val private: Boolean = false,
    @SerialName("html_url") val htmlUrl: String = "",
    @SerialName("clone_url") val cloneUrl: String = "",
    @SerialName("default_branch") val defaultBranch: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
    val language: String? = null,
    val size: Long = 0,
)

@Serializable
data class GitHubRepoPage(
    val repos: List<GitHubRepo> = emptyList(),
    val hasMore: Boolean = false,
)

@Serializable
data class CloneRepoInput(
    val url: String,
    val targetDir: String,
    val branch: String? = null,
)

@Serializable
data class PushInput(
    val workingDirectory: String,
    val remote: String? = null,
    val branch: String? = null,
    val force: Boolean? = null,
)
