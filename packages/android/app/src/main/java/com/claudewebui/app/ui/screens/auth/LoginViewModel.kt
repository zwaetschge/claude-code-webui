package com.claudewebui.app.ui.screens.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.BasicAuthLoginRequest
import com.claudewebui.app.data.model.LoginRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private const val PREFS_NAME = "claude_webui_prefs"
private const val KEY_RECENT_SERVERS = "recent_servers"
private const val KEY_BIOMETRIC_ENABLED = "biometric_enabled"
private const val MAX_RECENT_SERVERS = 5

class LoginViewModel(
    private val apiClient: ApiClient,
    private val context: Context,
) : ViewModel() {

    private val prefs: SharedPreferences by lazy {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    // ── UI State ──────────────────────────────────────────────────────────────

    private val _authState = MutableStateFlow<AuthState>(AuthState.Idle)
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    private val _recentServers = MutableStateFlow<List<String>>(emptyList())
    val recentServers: StateFlow<List<String>> = _recentServers.asStateFlow()

    private val _biometricEnabled = MutableStateFlow(false)
    val biometricEnabled: StateFlow<Boolean> = _biometricEnabled.asStateFlow()

    init {
        loadRecentServers()
        _biometricEnabled.value = prefs.getBoolean(KEY_BIOMETRIC_ENABLED, false)
    }

    // ── Connection ────────────────────────────────────────────────────────────

    /**
     * Test connectivity to the given server URL and fetch its auth config.
     * Normalizes the URL (adds https:// if no scheme present).
     */
    fun testConnection(rawUrl: String) {
        val url = normalizeUrl(rawUrl)
        if (url.isBlank()) {
            _authState.value = AuthState.Error(
                message = "Please enter a server URL",
                isConnectionError = true,
            )
            return
        }

        viewModelScope.launch {
            _authState.value = AuthState.Connecting

            // Temporarily set server URL so ApiClient can reach it
            TokenStore.setServerUrl(url)

            try {
                val healthResponse = apiClient.health()
                if (healthResponse.status.value !in 200..299) {
                    _authState.value = AuthState.Error(
                        message = "Server returned ${healthResponse.status.value}. Is this the right URL?",
                        isConnectionError = true,
                    )
                    return@launch
                }

                // Fetch which auth methods are available
                val providersResult = runCatching { apiClient.authProviders() }
                val providers = providersResult.getOrNull()?.data

                val authConfig = AuthConfig(
                    basicAuthEnabled = true, // Always try basic auth as fallback
                    googleOAuthEnabled = providers?.google ?: false,
                    githubOAuthEnabled = providers?.github ?: false,
                    claudeOAuthEnabled = providers?.claude ?: false,
                    devLoginEnabled = providers?.let { false } ?: true,
                )

                val serverInfo = ServerInfo(
                    url = url,
                    name = "Plum Code WebUI",
                    reachable = true,
                )

                saveRecentServer(url)

                _authState.value = AuthState.Connected(
                    serverInfo = serverInfo,
                    authConfig = authConfig,
                )
            } catch (e: Exception) {
                _authState.value = AuthState.Error(
                    message = "Cannot reach server at $url. Check the URL and your network connection.",
                    isConnectionError = true,
                )
            }
        }
    }

    // ── Basic Auth ────────────────────────────────────────────────────────────

    fun loginBasicAuth(username: String, password: String) {
        if (username.isBlank() || password.isBlank()) {
            _authState.value = AuthState.Error("Username and password are required")
            return
        }

        viewModelScope.launch {
            _authState.value = AuthState.Authenticating
            try {
                val response = apiClient.basicAuthLogin(
                    BasicAuthLoginRequest(username = username, password = password)
                )
                if (response.success && response.data != null) {
                    TokenStore.setToken(response.data.token)
                    TokenStore.setUserId(response.data.user.id)
                    _authState.value = AuthState.Authenticated(response.data.user)
                } else {
                    _authState.value = AuthState.Error(
                        message = response.error?.message
                            ?: "Invalid username or password"
                    )
                }
            } catch (e: Exception) {
                _authState.value = AuthState.Error(
                    message = "Login failed: ${e.message ?: "Unknown error"}"
                )
            }
        }
    }

    // ── Dev Login ─────────────────────────────────────────────────────────────

    fun loginDev() {
        viewModelScope.launch {
            _authState.value = AuthState.Authenticating
            try {
                val response = apiClient.devLogin(LoginRequest())
                if (response.success && response.data != null) {
                    TokenStore.setToken(response.data.token)
                    TokenStore.setUserId(response.data.user.id)
                    _authState.value = AuthState.Authenticated(response.data.user)
                } else {
                    _authState.value = AuthState.Error(
                        message = response.error?.message ?: "Dev login failed"
                    )
                }
            } catch (e: Exception) {
                _authState.value = AuthState.Error(
                    message = "Dev login failed: ${e.message ?: "Unknown error"}"
                )
            }
        }
    }

    // ── OAuth ─────────────────────────────────────────────────────────────────

    /**
     * Returns the OAuth redirect URL that the WebView / Custom Tab should open.
     * The actual token extraction happens in [handleOAuthCallback].
     */
    fun getOAuthUrl(provider: String): String {
        val serverUrl = TokenStore.getServerUrl() ?: return ""
        return "$serverUrl/auth/$provider"
    }

    /**
     * Called after OAuth WebView completes and a token is extracted from the redirect URL.
     */
    fun handleOAuthCallback(token: String) {
        if (token.isBlank()) {
            _authState.value = AuthState.Error("OAuth login failed — no token received")
            return
        }

        viewModelScope.launch {
            _authState.value = AuthState.Authenticating
            TokenStore.setToken(token)
            try {
                val response = apiClient.me()
                if (response.success && response.data != null) {
                    TokenStore.setUserId(response.data.id)
                    _authState.value = AuthState.Authenticated(response.data)
                } else {
                    TokenStore.clearToken()
                    _authState.value = AuthState.Error(
                        message = response.error?.message ?: "Could not fetch user profile"
                    )
                }
            } catch (e: Exception) {
                TokenStore.clearToken()
                _authState.value = AuthState.Error("OAuth verification failed: ${e.message}")
            }
        }
    }

    // ── Session Check ─────────────────────────────────────────────────────────

    /**
     * Check whether a valid session already exists (app resume / cold start).
     * If yes → jump straight to Authenticated state.
     */
    fun checkExistingSession() {
        if (!TokenStore.isLoggedIn) return

        viewModelScope.launch {
            try {
                val response = apiClient.me()
                if (response.success && response.data != null) {
                    _authState.value = AuthState.Authenticated(response.data)
                } else {
                    TokenStore.clearAll()
                }
            } catch (_: Exception) {
                // Network unavailable or token expired — stay on login screen
                TokenStore.clearAll()
            }
        }
    }

    // ── Biometric ─────────────────────────────────────────────────────────────

    fun setBiometricEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_BIOMETRIC_ENABLED, enabled).apply()
        _biometricEnabled.value = enabled
    }

    /** Called when biometric succeeds — restore session without re-entering credentials */
    fun onBiometricSuccess() {
        checkExistingSession()
    }

    // ── Recent Servers ────────────────────────────────────────────────────────

    private fun loadRecentServers() {
        val stored = prefs.getString(KEY_RECENT_SERVERS, "") ?: ""
        _recentServers.value = stored
            .split(",")
            .filter { it.isNotBlank() }
    }

    private fun saveRecentServer(url: String) {
        val current = _recentServers.value.toMutableList()
        current.remove(url)
        current.add(0, url)
        val trimmed = current.take(MAX_RECENT_SERVERS)
        _recentServers.value = trimmed
        prefs.edit().putString(KEY_RECENT_SERVERS, trimmed.joinToString(",")).apply()
    }

    fun removeRecentServer(url: String) {
        val updated = _recentServers.value.filter { it != url }
        _recentServers.value = updated
        prefs.edit().putString(KEY_RECENT_SERVERS, updated.joinToString(",")).apply()
    }

    // ── Navigation helpers ────────────────────────────────────────────────────

    fun resetToIdle() {
        _authState.value = AuthState.Idle
    }

    fun resetToConnected() {
        val current = _authState.value
        if (current is AuthState.Error) {
            // If we were connected before the error, go back to Connected
            val url = TokenStore.getServerUrl()
            if (url != null) {
                _authState.value = AuthState.Connecting
                testConnection(url)
            } else {
                _authState.value = AuthState.Idle
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun normalizeUrl(raw: String): String {
        val trimmed = raw.trim().trimEnd('/')
        return when {
            trimmed.startsWith("http://") || trimmed.startsWith("https://") -> trimmed
            trimmed.isNotBlank() -> "https://$trimmed"
            else -> trimmed
        }
    }
}
