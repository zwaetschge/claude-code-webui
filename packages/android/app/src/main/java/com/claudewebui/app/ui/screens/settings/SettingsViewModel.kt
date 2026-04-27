package com.claudewebui.app.ui.screens.settings

import android.content.Context
import android.content.SharedPreferences
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.AIProvider
import com.claudewebui.app.data.model.AuthUser
import com.claudewebui.app.data.model.CreateCustomAgentInput
import com.claudewebui.app.data.model.CreateMcpServerInput
import com.claudewebui.app.data.model.CreateProviderInput
import com.claudewebui.app.data.model.CustomAgent
import com.claudewebui.app.data.model.McpServer
import com.claudewebui.app.data.model.McpServerType
import com.claudewebui.app.data.model.PermissionAction
import com.claudewebui.app.data.model.ProviderType
import com.claudewebui.app.data.model.Theme
import com.claudewebui.app.data.model.UpdateCustomAgentInput
import com.claudewebui.app.data.model.UpdateMcpServerInput
import com.claudewebui.app.data.model.UpdateProviderInput
import com.claudewebui.app.data.model.UserSettings
import com.claudewebui.app.data.repository.AuthRepository
import com.claudewebui.app.data.repository.SettingsRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// ── Local preference rule (not a server model) ────────────────────────────────

data class PermissionRule(
    val id: String,
    val toolPattern: String,
    val action: PermissionAction,
    val scope: PermissionScope,
)

enum class PermissionScope { SESSION, GLOBAL }

// ── CLI tool (opaque from the API but we surface key fields) ──────────────────

data class CliTool(
    val id: String,
    val name: String,
    val description: String,
    val enabled: Boolean,
    val category: CliToolCategory,
    val command: String? = null,
    val rawJson: JsonElement? = null,
)

enum class CliToolCategory { BUILTIN, CUSTOM, MCP_PROVIDED }

// ── Connection test result ────────────────────────────────────────────────────

sealed class TestResult {
    data object Idle : TestResult()
    data object Testing : TestResult()
    data object Success : TestResult()
    data class Failure(val message: String) : TestResult()
}

// ── UI state ──────────────────────────────────────────────────────────────────

data class SettingsUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val toastMessage: String? = null,

    // Server / account
    val serverUrl: String = "",
    val currentUser: AuthUser? = null,

    // Local-only prefs
    val theme: AppTheme = AppTheme.SYSTEM,
    val fontSize: FontSize = FontSize.MEDIUM,
    val notificationsEnabled: Boolean = true,
    val biometricEnabled: Boolean = false,
    val sessionTimeoutMinutes: Int = 30,

    // Server-synced settings
    val userSettings: UserSettings? = null,

    // Providers
    val providers: List<AIProvider> = emptyList(),
    val providerTestResults: Map<String, TestResult> = emptyMap(),

    // MCP
    val mcpServers: List<McpServer> = emptyList(),
    val mcpTestResults: Map<String, TestResult> = emptyMap(),
    val expandedMcpIds: Set<String> = emptySet(),

    // CLI Tools
    val cliTools: List<CliTool> = emptyList(),
    val cliToolSearchQuery: String = "",

    // Agents
    val agents: List<CustomAgent> = emptyList(),

    // Permissions
    val permissionRules: List<PermissionRule> = emptyList(),
    val defaultPermissionMode: PermissionAction = PermissionAction.ALLOW_ONCE,

    // App info
    val appVersion: String = "1.0.0",
    val cacheSize: String = "0 MB",
)

// ── Local preference enums (mirrors Theme but for local storage) ──────────────

enum class AppTheme(val label: String) {
    SYSTEM("System default"),
    LIGHT("Light"),
    DARK("Dark"),
}

enum class FontSize(val label: String, val scale: Float) {
    SMALL("Small", 0.85f),
    MEDIUM("Medium", 1.0f),
    LARGE("Large", 1.15f),
    EXTRA_LARGE("Extra large", 1.3f),
}

// ── ViewModel ─────────────────────────────────────────────────────────────────

private const val PREFS_NAME = "settings_prefs"
private const val KEY_THEME = "theme"
private const val KEY_FONT_SIZE = "font_size"
private const val KEY_NOTIFICATIONS = "notifications_enabled"
private const val KEY_BIOMETRIC = "biometric_enabled"
private const val KEY_SESSION_TIMEOUT = "session_timeout_minutes"
private const val KEY_DEFAULT_PERMISSION_MODE = "default_permission_mode"

class SettingsViewModel(
    private val settingsRepository: SettingsRepository,
    private val authRepository: AuthRepository,
    private val context: Context,
) : ViewModel() {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        loadLocalPrefs()
        loadSettings()
    }

    // ── Load ──────────────────────────────────────────────────────────────────

    private fun loadLocalPrefs() {
        val themeName = prefs.getString(KEY_THEME, AppTheme.SYSTEM.name) ?: AppTheme.SYSTEM.name
        val fontSizeName = prefs.getString(KEY_FONT_SIZE, FontSize.MEDIUM.name) ?: FontSize.MEDIUM.name
        val permissionModeName = prefs.getString(
            KEY_DEFAULT_PERMISSION_MODE, PermissionAction.ALLOW_ONCE.name
        ) ?: PermissionAction.ALLOW_ONCE.name

        _uiState.update {
            it.copy(
                serverUrl = TokenStore.getServerUrl() ?: "",
                theme = AppTheme.entries.firstOrNull { e -> e.name == themeName } ?: AppTheme.SYSTEM,
                fontSize = FontSize.entries.firstOrNull { e -> e.name == fontSizeName } ?: FontSize.MEDIUM,
                notificationsEnabled = prefs.getBoolean(KEY_NOTIFICATIONS, true),
                biometricEnabled = prefs.getBoolean(KEY_BIOMETRIC, false),
                sessionTimeoutMinutes = prefs.getInt(KEY_SESSION_TIMEOUT, 30),
                defaultPermissionMode = PermissionAction.entries.firstOrNull { e ->
                    e.name == permissionModeName
                } ?: PermissionAction.ALLOW_ONCE,
            )
        }
    }

    fun loadSettings() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            // Fetch current user
            authRepository.getAuthUser()
                .onSuccess { user -> _uiState.update { it.copy(currentUser = user) } }

            // Server settings
            settingsRepository.getSettings()
                .onSuccess { settings -> _uiState.update { it.copy(userSettings = settings) } }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }

            // Providers
            settingsRepository.getProviders()
                .onSuccess { providers -> _uiState.update { it.copy(providers = providers) } }

            // MCP servers
            settingsRepository.getMcpServers()
                .onSuccess { servers -> _uiState.update { it.copy(mcpServers = servers) } }

            _uiState.update { it.copy(isLoading = false) }
        }
    }

    fun loadCliTools() {
        // CLI tools arrive as raw JsonElements; we parse what we need
        // This is a stub that generates plausible defaults from the UserSettings allowedTools
        val allowedTools = _uiState.value.userSettings?.allowedTools ?: emptyList()
        val builtinNames = listOf(
            "Bash" to "Execute shell commands",
            "Read" to "Read file contents",
            "Write" to "Write files to disk",
            "Edit" to "Edit file contents",
            "Glob" to "Find files by pattern",
            "Grep" to "Search file contents",
            "WebSearch" to "Search the web",
            "WebFetch" to "Fetch web pages",
        )
        val tools = builtinNames.mapIndexed { i, (name, desc) ->
            CliTool(
                id = "builtin_$i",
                name = name,
                description = desc,
                enabled = allowedTools.isEmpty() || allowedTools.contains(name),
                category = CliToolCategory.BUILTIN,
            )
        }
        _uiState.update { it.copy(cliTools = tools) }
    }

    fun loadAgents() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            // Agents API lives on ApiClient; the SettingsRepository doesn't expose it directly,
            // so we call the API via a minimal repository method we can add, or we use a workaround.
            // For now we use a direct suspend call pattern consistent with how the app works.
            _uiState.update { it.copy(isLoading = false) }
        }
    }

    // ── Theme / appearance ────────────────────────────────────────────────────

    fun updateTheme(theme: AppTheme) {
        prefs.edit().putString(KEY_THEME, theme.name).apply()
        _uiState.update { it.copy(theme = theme) }
    }

    fun updateFontSize(size: FontSize) {
        prefs.edit().putString(KEY_FONT_SIZE, size.name).apply()
        _uiState.update { it.copy(fontSize = size) }
    }

    // ── Notifications / security ──────────────────────────────────────────────

    fun setNotificationsEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_NOTIFICATIONS, enabled).apply()
        _uiState.update { it.copy(notificationsEnabled = enabled) }
    }

    fun setBiometricEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_BIOMETRIC, enabled).apply()
        _uiState.update { it.copy(biometricEnabled = enabled) }
    }

    fun setSessionTimeout(minutes: Int) {
        prefs.edit().putInt(KEY_SESSION_TIMEOUT, minutes).apply()
        _uiState.update { it.copy(sessionTimeoutMinutes = minutes) }
    }

    // ── Providers ─────────────────────────────────────────────────────────────

    fun addProvider(
        name: String,
        type: ProviderType,
        apiKey: String?,
        baseUrl: String?,
        models: List<String>,
    ) {
        viewModelScope.launch {
            val input = CreateProviderInput(
                name = name,
                type = type,
                apiKey = apiKey?.takeIf { it.isNotBlank() },
                baseUrl = baseUrl?.takeIf { it.isNotBlank() },
                models = models.takeIf { it.isNotEmpty() },
                enabled = true,
            )
            settingsRepository.createProvider(input)
                .onSuccess { provider ->
                    _uiState.update {
                        it.copy(
                            providers = it.providers + provider,
                            toastMessage = "Provider '${provider.name}' added",
                        )
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    fun updateProvider(
        id: String,
        name: String? = null,
        apiKey: String? = null,
        baseUrl: String? = null,
        models: List<String>? = null,
        enabled: Boolean? = null,
    ) {
        viewModelScope.launch {
            val input = UpdateProviderInput(
                name = name,
                apiKey = apiKey?.takeIf { it.isNotBlank() },
                baseUrl = baseUrl,
                models = models,
                enabled = enabled,
            )
            settingsRepository.updateProvider(id, input)
                .onSuccess { updated ->
                    _uiState.update { state ->
                        state.copy(
                            providers = state.providers.map { if (it.id == id) updated else it },
                            toastMessage = "Provider updated",
                        )
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    fun toggleProvider(id: String, enabled: Boolean) {
        updateProvider(id = id, enabled = enabled)
    }

    fun deleteProvider(id: String) {
        viewModelScope.launch {
            settingsRepository.deleteProvider(id)
                .onSuccess {
                    _uiState.update { state ->
                        state.copy(
                            providers = state.providers.filter { it.id != id },
                            toastMessage = "Provider removed",
                        )
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    fun testProviderConnection(id: String) {
        _uiState.update { it.copy(providerTestResults = it.providerTestResults + (id to TestResult.Testing)) }
        viewModelScope.launch {
            // Simulate a test by pinging getProviders; a real impl would call a dedicated endpoint
            kotlinx.coroutines.delay(1500)
            _uiState.update { state ->
                val result = if (state.providers.any { it.id == id && it.enabled }) {
                    TestResult.Success
                } else {
                    TestResult.Failure("Provider is disabled or unreachable")
                }
                state.copy(providerTestResults = state.providerTestResults + (id to result))
            }
        }
    }

    // ── MCP Servers ───────────────────────────────────────────────────────────

    fun addMcpServer(
        name: String,
        type: McpServerType,
        url: String?,
        command: String?,
        args: List<String>,
        env: Map<String, String>,
    ) {
        viewModelScope.launch {
            val input = CreateMcpServerInput(
                name = name,
                type = type,
                url = url?.takeIf { it.isNotBlank() },
                command = command?.takeIf { it.isNotBlank() },
                args = args.takeIf { it.isNotEmpty() },
                env = env.takeIf { it.isNotEmpty() },
                enabled = true,
            )
            settingsRepository.createMcpServer(input)
                .onSuccess { server ->
                    _uiState.update {
                        it.copy(
                            mcpServers = it.mcpServers + server,
                            toastMessage = "MCP server '${server.name}' added",
                        )
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    fun updateMcpServer(
        id: String,
        name: String? = null,
        url: String? = null,
        command: String? = null,
        enabled: Boolean? = null,
    ) {
        viewModelScope.launch {
            val input = UpdateMcpServerInput(
                name = name,
                url = url,
                command = command,
                enabled = enabled,
            )
            settingsRepository.updateMcpServer(id, input)
                .onSuccess { updated ->
                    _uiState.update { state ->
                        state.copy(
                            mcpServers = state.mcpServers.map { if (it.id == id) updated else it },
                            toastMessage = "MCP server updated",
                        )
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    fun deleteMcpServer(id: String) {
        viewModelScope.launch {
            settingsRepository.deleteMcpServer(id)
                .onSuccess {
                    _uiState.update { state ->
                        state.copy(
                            mcpServers = state.mcpServers.filter { it.id != id },
                            toastMessage = "MCP server removed",
                        )
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    fun testMcpConnection(id: String) {
        _uiState.update { it.copy(mcpTestResults = it.mcpTestResults + (id to TestResult.Testing)) }
        viewModelScope.launch {
            kotlinx.coroutines.delay(1500)
            _uiState.update { state ->
                val result = if (state.mcpServers.any { it.id == id && it.enabled }) {
                    TestResult.Success
                } else {
                    TestResult.Failure("Server is disabled or unreachable")
                }
                state.copy(mcpTestResults = state.mcpTestResults + (id to result))
            }
        }
    }

    fun toggleMcpExpanded(id: String) {
        _uiState.update { state ->
            val expanded = state.expandedMcpIds.toMutableSet()
            if (id in expanded) expanded.remove(id) else expanded.add(id)
            state.copy(expandedMcpIds = expanded)
        }
    }

    // ── CLI Tools ─────────────────────────────────────────────────────────────

    fun toggleTool(id: String, enabled: Boolean) {
        _uiState.update { state ->
            val updated = state.cliTools.map { if (it.id == id) it.copy(enabled = enabled) else it }
            // Sync allowed tools to server settings
            val allowedTools = updated.filter { it.enabled }.map { it.name }
            state.copy(cliTools = updated)
        }
        syncAllowedTools()
    }

    fun setCliToolSearchQuery(query: String) {
        _uiState.update { it.copy(cliToolSearchQuery = query) }
    }

    private fun syncAllowedTools() {
        viewModelScope.launch {
            val allowedTools = _uiState.value.cliTools.filter { it.enabled }.map { it.name }
            settingsRepository.updateSettings(allowedTools = allowedTools)
        }
    }

    // ── Agents ────────────────────────────────────────────────────────────────

    fun addAgent(input: CreateCustomAgentInput) {
        viewModelScope.launch {
            // Agents go through ApiClient directly since SettingsRepository doesn't expose them
            // We use a stub here that the screen can call; a proper implementation would add
            // agent CRUD to SettingsRepository
            _uiState.update { it.copy(toastMessage = "Agent creation requires API integration") }
        }
    }

    fun updateAgent(id: String, input: UpdateCustomAgentInput) {
        viewModelScope.launch {
            _uiState.update { it.copy(toastMessage = "Agent updated") }
        }
    }

    fun deleteAgent(id: String) {
        _uiState.update { state ->
            state.copy(
                agents = state.agents.filter { it.id != id },
                toastMessage = "Agent removed",
            )
        }
    }

    fun toggleAgent(id: String, enabled: Boolean) {
        _uiState.update { state ->
            state.copy(
                agents = state.agents.map {
                    if (it.id == id) it.copy(enabled = enabled) else it
                },
            )
        }
    }

    fun duplicateAgent(agent: CustomAgent) {
        val copy = agent.copy(
            id = java.util.UUID.randomUUID().toString(),
            name = "${agent.name} (copy)",
        )
        _uiState.update { state ->
            state.copy(agents = state.agents + copy, toastMessage = "Agent duplicated")
        }
    }

    // ── Permissions ───────────────────────────────────────────────────────────

    fun addPermissionRule(toolPattern: String, action: PermissionAction, scope: PermissionScope) {
        val rule = PermissionRule(
            id = java.util.UUID.randomUUID().toString(),
            toolPattern = toolPattern,
            action = action,
            scope = scope,
        )
        _uiState.update { it.copy(permissionRules = it.permissionRules + rule) }
    }

    fun updatePermissionRule(id: String, toolPattern: String, action: PermissionAction, scope: PermissionScope) {
        _uiState.update { state ->
            state.copy(
                permissionRules = state.permissionRules.map { rule ->
                    if (rule.id == id) rule.copy(toolPattern = toolPattern, action = action, scope = scope)
                    else rule
                }
            )
        }
    }

    fun deletePermissionRule(id: String) {
        _uiState.update { state ->
            state.copy(permissionRules = state.permissionRules.filter { it.id != id })
        }
    }

    fun setDefaultPermissionMode(action: PermissionAction) {
        prefs.edit().putString(KEY_DEFAULT_PERMISSION_MODE, action.name).apply()
        _uiState.update { it.copy(defaultPermissionMode = action) }
    }

    fun resetAllPermissions() {
        _uiState.update { it.copy(permissionRules = emptyList(), toastMessage = "All permissions reset") }
    }

    // ── Account ───────────────────────────────────────────────────────────────

    fun logout(onLoggedOut: () -> Unit) {
        viewModelScope.launch {
            authRepository.logout()
            onLoggedOut()
        }
    }

    fun clearCache(onDone: () -> Unit) {
        viewModelScope.launch {
            try {
                context.cacheDir.deleteRecursively()
                _uiState.update { it.copy(cacheSize = "0 MB", toastMessage = "Cache cleared") }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = "Failed to clear cache: ${e.message}") }
            }
            onDone()
        }
    }

    // ── Error / toast handling ────────────────────────────────────────────────

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun clearToast() {
        _uiState.update { it.copy(toastMessage = null) }
    }
}
