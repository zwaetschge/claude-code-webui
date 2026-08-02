package com.claudewebui.app.data.repository

import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.AIProvider
import com.claudewebui.app.data.model.Category
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.CLIProviderConfig
import com.claudewebui.app.data.model.CLIProviderStatus
import com.claudewebui.app.data.model.CreateCategoryInput
import com.claudewebui.app.data.model.CreateCustomAgentInput
import com.claudewebui.app.data.model.CreateMcpServerInput
import com.claudewebui.app.data.model.CreateProviderInput
import com.claudewebui.app.data.model.CustomAgent
import com.claudewebui.app.data.model.McpServer
import com.claudewebui.app.data.model.Theme
import com.claudewebui.app.data.model.UiProvider
import com.claudewebui.app.data.model.UpdateCategoryInput
import com.claudewebui.app.data.model.UpdateCustomAgentInput
import com.claudewebui.app.data.model.UpdateMcpServerInput
import com.claudewebui.app.data.model.UpdateProviderInput
import com.claudewebui.app.data.model.UpdateSettingsInput
import com.claudewebui.app.data.model.UserSettings

/**
 * Repository for user settings and configuration data.
 *
 * All methods wrap [ApiClient] calls in [Result] so callers can handle
 * network errors without try/catch boilerplate.
 */
class SettingsRepository(
    private val api: ApiClient
) {

    // ---- User Settings -----------------------------------------------------

    /** Fetch the current user's settings. */
    suspend fun getSettings(): Result<UserSettings> = runCatching {
        val response = api.getSettings()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch settings")
        }
        response.data
    }

    /** Update settings with only the fields that changed. */
    suspend fun updateSettings(
        theme: Theme? = null,
        defaultWorkingDir: String? = null,
        allowedTools: List<String>? = null,
        customSystemPrompt: String? = null,
        uiProvider: UiProvider? = null,
        defaultCliProvider: CLIProvider? = null,
        cliProviderModels: Map<String, String>? = null
    ): Result<UserSettings> = runCatching {
        val input = UpdateSettingsInput(
            theme = theme,
            defaultWorkingDir = defaultWorkingDir,
            allowedTools = allowedTools,
            customSystemPrompt = customSystemPrompt,
            uiProvider = uiProvider,
            defaultCliProvider = defaultCliProvider,
            cliProviderModels = cliProviderModels
        )
        val response = api.updateSettings(input)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to update settings")
        }
        response.data
    }

    // ---- AI Providers ------------------------------------------------------

    /** Fetch all configured AI providers. */
    suspend fun getProviders(): Result<List<AIProvider>> = runCatching {
        val response = api.getProviders()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch providers")
        }
        response.data
    }

    /** Add a new AI provider configuration. */
    suspend fun createProvider(input: CreateProviderInput): Result<AIProvider> = runCatching {
        val response = api.createProvider(input)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to create provider")
        }
        response.data
    }

    /** Update an existing provider. */
    suspend fun updateProvider(id: String, input: UpdateProviderInput): Result<AIProvider> = runCatching {
        val response = api.updateProvider(id, input)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to update provider")
        }
        response.data
    }

    /** Delete a provider. */
    suspend fun deleteProvider(id: String): Result<Unit> = runCatching {
        val response = api.deleteProvider(id)
        if (!response.success) {
            error(response.error?.message ?: "Failed to delete provider")
        }
    }

    /** Fetch CLI provider availability status (which CLIs are installed). */
    suspend fun getCLIProviderStatus(): Result<CLIProviderStatus> = runCatching {
        val response = api.cliProviderStatus()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch CLI status")
        }
        response.data
    }

    /** Fetch the canonical CLI provider registry, including enabled/auth status. */
    suspend fun getCLIProviders(): Result<List<CLIProviderConfig>> = runCatching {
        val response = api.getCLIProviders()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch CLI providers")
        }
        response.data
    }

    // ---- MCP Servers -------------------------------------------------------

    /** Fetch all configured MCP servers. */
    suspend fun getMcpServers(): Result<List<McpServer>> = runCatching {
        val response = api.getMcpServers()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch MCP servers")
        }
        response.data
    }

    /** Add a new MCP server. */
    suspend fun createMcpServer(input: CreateMcpServerInput): Result<McpServer> = runCatching {
        val response = api.createMcpServer(input)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to create MCP server")
        }
        response.data
    }

    /** Update an MCP server. */
    suspend fun updateMcpServer(id: String, input: UpdateMcpServerInput): Result<McpServer> = runCatching {
        val response = api.updateMcpServer(id, input)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to update MCP server")
        }
        response.data
    }

    /** Delete an MCP server. */
    suspend fun deleteMcpServer(id: String): Result<Unit> = runCatching {
        val response = api.deleteMcpServer(id)
        if (!response.success) {
            error(response.error?.message ?: "Failed to delete MCP server")
        }
    }

    // ---- Custom agents ----------------------------------------------------

    suspend fun getAgents(): Result<List<CustomAgent>> = runCatching {
        val response = api.getAgents()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch agents")
        }
        response.data
    }

    suspend fun createAgent(input: CreateCustomAgentInput): Result<CustomAgent> = runCatching {
        val response = api.createAgent(input)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to create agent")
        }
        response.data
    }

    suspend fun updateAgent(id: String, input: UpdateCustomAgentInput): Result<CustomAgent> = runCatching {
        val response = api.updateAgent(id, input)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to update agent")
        }
        response.data
    }

    suspend fun deleteAgent(id: String): Result<Unit> = runCatching {
        val response = api.deleteAgent(id)
        if (!response.success) {
            error(response.error?.message ?: "Failed to delete agent")
        }
    }

    // ---- Categories --------------------------------------------------------

    /** Fetch all session categories. */
    suspend fun getCategories(): Result<List<Category>> = runCatching {
        val response = api.getCategories()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch categories")
        }
        response.data
    }

    /** Create a new category. */
    suspend fun createCategory(input: CreateCategoryInput): Result<Category> = runCatching {
        val response = api.createCategory(input)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to create category")
        }
        response.data
    }

    /** Update a category. */
    suspend fun updateCategory(id: String, input: UpdateCategoryInput): Result<Category> = runCatching {
        val response = api.updateCategory(id, input)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to update category")
        }
        response.data
    }

    /** Delete a category. */
    suspend fun deleteCategory(id: String): Result<Unit> = runCatching {
        val response = api.deleteCategory(id)
        if (!response.success) {
            error(response.error?.message ?: "Failed to delete category")
        }
    }
}
