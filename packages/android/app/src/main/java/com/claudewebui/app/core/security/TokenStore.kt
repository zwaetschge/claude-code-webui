package com.claudewebui.app.core.security

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Secure storage for authentication tokens and server configuration.
 * Uses [EncryptedSharedPreferences] backed by Android Keystore for at-rest encryption.
 *
 * Call [init] once during Application.onCreate() before accessing any properties.
 */
object TokenStore {

    private const val PREFS_NAME = "claude_webui_secure_prefs"
    private const val KEY_JWT_TOKEN = "jwt_token"
    private const val KEY_REFRESH_TOKEN = "refresh_token"
    private const val KEY_SERVER_URL = "server_url"
    private const val KEY_USER_ID = "user_id"

    private lateinit var prefs: SharedPreferences

    /**
     * Initialize the encrypted preferences. Must be called once at app startup.
     */
    fun init(context: Context) {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        prefs = EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    // --- JWT Token ---

    fun getToken(): String? = prefs.getString(KEY_JWT_TOKEN, null)

    fun setToken(token: String) {
        prefs.edit().putString(KEY_JWT_TOKEN, token).apply()
    }

    fun clearToken() {
        prefs.edit().remove(KEY_JWT_TOKEN).apply()
    }

    // --- Refresh Token ---

    fun getRefreshToken(): String? = prefs.getString(KEY_REFRESH_TOKEN, null)

    fun setRefreshToken(token: String) {
        prefs.edit().putString(KEY_REFRESH_TOKEN, token).apply()
    }

    fun clearRefreshToken() {
        prefs.edit().remove(KEY_REFRESH_TOKEN).apply()
    }

    // --- Server URL ---

    fun getServerUrl(): String? = prefs.getString(KEY_SERVER_URL, null)

    fun setServerUrl(url: String) {
        prefs.edit().putString(KEY_SERVER_URL, url).apply()
    }

    // --- User ID ---

    fun getUserId(): String? = prefs.getString(KEY_USER_ID, null)

    fun setUserId(userId: String) {
        prefs.edit().putString(KEY_USER_ID, userId).apply()
    }

    // --- Convenience ---

    val isLoggedIn: Boolean
        get() = getToken() != null

    /**
     * Clear all stored credentials (logout).
     */
    fun clearAll() {
        prefs.edit()
            .remove(KEY_JWT_TOKEN)
            .remove(KEY_REFRESH_TOKEN)
            .remove(KEY_USER_ID)
            .apply()
    }
}
