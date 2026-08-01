package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

/**
 * Response from GET /api/app/version.
 * Describes the latest available Android APK.
 */
@Serializable
data class AppVersionInfo(
    val version: String,
    val versionCode: Int,
    val downloadUrl: String,
    val releaseNotes: String? = null
)
