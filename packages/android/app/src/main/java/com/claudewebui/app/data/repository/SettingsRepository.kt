package com.claudewebui.app.data.repository

import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.AIProvider
import com.claudewebui.app.data.model.Category
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.CLIProviderConfig
import com.claudewebui.app.data.model.CLIProviderStatus
import com.claudewebui.app.data.model.CliLoginSession
import com.claudewebui.app.data.model.ConfigAgent
import com.claudewebui.app.data.model.ConfigPlugin
import com.claudewebui.app.data.model.ConfigSkill
import com.claudewebui.app.data.model.CreateCategoryInput
import com.claudewebui.app.data.model.CreateCustomAgentInput
import com.claudewebui.app.data.model.CreateMcpServerInput
import com.claudewebui.app.data.model.CreateProviderInput
import com.claudewebui.app.data.model.CustomAgent
import com.claudewebui.app.data.model.McpServer
import com.claudewebui.app.data.model.McpTestResult
import com.claudewebui.app.data.model.ProviderTestResult
import com.claudewebui.app.data.model.SlashCommand
import com.claudewebui.app.data.model.StyleLibrary
import com.claudewebui.app.data.model.Theme
import com.claudewebui.app.data.model.UiProvider
import com.claudewebui.app.data.model.UpdateCategoryInput
import com.claudewebui.app.data.model.UpdateCustomAgentInput
import com.claudewebui.app.data.model.UpdateMcpServerInput
import com.claudewebui.app.data.model.UpdateProviderInput
import com.claudewebui.app.data.model.UpdateSettingsInput
import com.claudewebui.app.data.model.UserSettings
import kotlinx.serialization.json.JsonElement

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

    /** Ask the server to call the provider's API and report the result. */
    suspend fun testProvider(id: String): Result<ProviderTestResult> = runCatching {
        val response = api.testProvider(id)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to test provider")
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

    /** Ask the server to actually start the MCP server and report back. */
    suspend fun testMcpServer(id: String): Result<McpTestResult> = runCatching {
        val response = api.testMcpServer(id)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to test MCP server")
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

    // ---- Claude config library ---------------------------------------------
    //
    // Distinct from the custom-agent CRUD above: these read the on-disk
    // catalogue that actually ships to the CLI harnesses, which is what the
    // WebUI's Extensions pane shows.

    suspend fun getConfigSkills(): Result<List<ConfigSkill>> = runCatching {
        val response = api.getConfigSkills()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch skills")
        }
        response.data
    }

    suspend fun getConfigAgents(): Result<List<ConfigAgent>> = runCatching {
        val response = api.getConfigAgents()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch agents")
        }
        response.data
    }

    suspend fun getConfigPlugins(): Result<List<ConfigPlugin>> = runCatching {
        val response = api.getConfigPlugins()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch plugins")
        }
        response.data
    }

    suspend fun getStyleLibrary(): Result<StyleLibrary> = runCatching {
        val response = api.getStyleLibrary()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch style library")
        }
        response.data
    }

    /** Flip a skill between active and on-demand. Returns the resulting state. */
    suspend fun toggleConfigSkill(name: String): Result<Boolean> = runCatching {
        val response = api.toggleConfigSkill(name)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to toggle skill")
        }
        response.data.enabled
    }

    suspend fun toggleConfigAgent(name: String): Result<Boolean> = runCatching {
        val response = api.toggleConfigAgent(name)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to toggle agent")
        }
        response.data.enabled
    }

    suspend fun toggleConfigPlugin(name: String): Result<Boolean> = runCatching {
        val response = api.toggleConfigPlugin(name)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to toggle plugin")
        }
        response.data.enabled
    }

    /** Custom CLI tools registered on the server. Payloads stay opaque JSON. */
    suspend fun getCliTools(): Result<List<JsonElement>> = runCatching {
        val response = api.getCliTools()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch CLI tools")
        }
        response.data
    }

    suspend fun getCommands(): Result<List<SlashCommand>> = runCatching {
        val response = api.getCommands()
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to fetch commands")
        }
        response.data
    }

    // ---- CLI harness login -------------------------------------------------

    suspend fun startCliLogin(provider: String): Result<CliLoginSession> = runCatching {
        val response = api.startCliLogin(provider)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to start login")
        }
        response.data
    }

    suspend fun pollCliLogin(id: String): Result<CliLoginSession> = runCatching {
        val response = api.getCliLogin(id)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Login session not found")
        }
        response.data
    }

    suspend fun submitCliLoginCode(id: String, code: String): Result<CliLoginSession> = runCatching {
        val response = api.submitCliLoginCode(id, code)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to submit code")
        }
        response.data
    }

    suspend fun cancelCliLogin(id: String): Result<Unit> = runCatching {
        api.cancelCliLogin(id)
        Unit
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
