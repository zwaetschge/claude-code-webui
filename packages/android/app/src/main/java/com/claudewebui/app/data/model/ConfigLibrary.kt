package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

/**
 * Models for the `/api/claude-config` routes — the on-disk skill, agent,
 * plugin and style catalogue that Plum actually ships to the CLI harnesses.
 *
 * These are distinct from [CustomAgent] (`/api/agents`), which only holds
 * user-authored agents stored in the WebUI database. The WebUI's
 * Settings → Extensions pane reads from these endpoints, so the mobile client
 * has to as well or every counter reads zero.
 */

@Serializable
data class ConfigSkill(
    val id: String,
    val name: String,
    val baseName: String? = null,
    val description: String = "",
    val dirPath: String? = null,
    val source: String = "user",
    val enabled: Boolean = false,
    val libraryKind: String = "skill",
    val entryType: String? = null,
    val aliases: List<String> = emptyList(),
)

@Serializable
data class ConfigAgent(
    val id: String,
    val name: String,
    val description: String = "",
    val tools: List<String> = emptyList(),
    val model: String? = null,
    val filePath: String? = null,
    val source: String = "user",
    val enabled: Boolean = true,
)

@Serializable
data class ConfigPlugin(
    val id: String,
    val name: String,
    val description: String = "",
    val version: String? = null,
    val dirPath: String? = null,
    val source: String = "user",
    val enabled: Boolean = true,
    val marketplace: String? = null,
    val installedAt: String? = null,
)

@Serializable
data class StyleLibrary(
    val designStyles: List<ConfigSkill> = emptyList(),
    val writingStyles: List<ConfigSkill> = emptyList(),
)

@Serializable
data class SlashCommand(
    val name: String,
    val scope: String = "builtin",
    val description: String = "",
)

/**
 * What the `/toggle` routes answer.
 *
 * They flip the current state server-side and ignore any request body, so the
 * response is just the resulting flag — not the updated entity.
 */
@Serializable
data class ToggleResult(val enabled: Boolean)
