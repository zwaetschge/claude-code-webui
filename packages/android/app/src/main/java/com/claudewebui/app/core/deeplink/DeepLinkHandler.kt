package com.claudewebui.app.core.deeplink

import android.content.Intent
import android.net.Uri

/**
 * Parses and normalises deep link [Intent]s for Plum Code WebUI.
 *
 * Supported schemes and paths:
 *
 * | URL                                                  | Destination       |
 * |------------------------------------------------------|-------------------|
 * | `claudewebui://session/{id}`                         | Session screen    |
 * | `claudewebui://new`                                  | New session screen|
 * | `claudewebui://settings`                             | Settings screen   |
 * | `https://<domain>/session/{id}`                      | Session screen    |
 * | `https://<domain>/sessions/{id}`                     | Session screen    |
 * | `https://<domain>/new`                               | New session screen|
 * | Any other `claudewebui://` or https app link         | Home screen       |
 *
 * Intent filters required in AndroidManifest:
 * ```xml
 * <!-- claudewebui:// custom scheme -->
 * <intent-filter>
 *     <action android:name="android.intent.action.VIEW" />
 *     <category android:name="android.intent.category.DEFAULT" />
 *     <category android:name="android.intent.category.BROWSABLE" />
 *     <data android:scheme="claudewebui" />
 * </intent-filter>
 *
 * <!-- https app-links — replace example.com with your domain -->
 * <intent-filter android:autoVerify="true">
 *     <action android:name="android.intent.action.VIEW" />
 *     <category android:name="android.intent.category.DEFAULT" />
 *     <category android:name="android.intent.category.BROWSABLE" />
 *     <data android:scheme="https" android:host="your-domain.example.com" />
 * </intent-filter>
 * ```
 */
sealed class DeepLinkDestination {
    /** Navigate to a specific session. */
    data class Session(val sessionId: String) : DeepLinkDestination()

    /** Open the new-session screen. */
    object NewSession : DeepLinkDestination()

    /** Open the settings screen. */
    object Settings : DeepLinkDestination()

    /** Open usage analytics, optionally pre-selecting a time range (24h/7d/30d/all). */
    data class Analytics(val range: String? = null) : DeepLinkDestination()

    /** Fall through to the main sessions list. */
    object Home : DeepLinkDestination()

    /** The intent doesn't carry a deep link we can parse. */
    object None : DeepLinkDestination()
}

object DeepLinkHandler {

    private const val SCHEME_CUSTOM = "claudewebui"

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Resolve the [DeepLinkDestination] from an [Intent].
     *
     * Returns [DeepLinkDestination.None] if the intent is not a deep-link intent
     * or the URI cannot be parsed into a known destination.
     */
    fun resolve(intent: Intent?): DeepLinkDestination {
        if (intent?.action != Intent.ACTION_VIEW) return DeepLinkDestination.None
        val uri = intent.data ?: return DeepLinkDestination.None
        return resolve(uri)
    }

    /**
     * Resolve a [Uri] directly into a [DeepLinkDestination].
     */
    fun resolve(uri: Uri): DeepLinkDestination {
        return when (uri.scheme) {
            SCHEME_CUSTOM -> resolveCustomScheme(uri)
            "https", "http" -> resolveHttpScheme(uri)
            else -> DeepLinkDestination.None
        }
    }

    // ── Scheme-specific resolvers ─────────────────────────────────────────────

    private fun resolveCustomScheme(uri: Uri): DeepLinkDestination {
        // claudewebui://session/{id}
        // claudewebui://new
        // claudewebui://settings
        val host = uri.host?.lowercase() ?: ""
        val pathSegments = uri.pathSegments

        return when {
            host == "session" && pathSegments.isNotEmpty() -> {
                DeepLinkDestination.Session(pathSegments[0])
            }
            host == "new" -> DeepLinkDestination.NewSession
            host == "settings" -> DeepLinkDestination.Settings
            host == "analytics" -> DeepLinkDestination.Analytics(uri.getQueryParameter("range"))
            host.isEmpty() || host == "sessions" -> {
                // claudewebui:// with optional session id in path
                pathSegments.firstOrNull()
                    ?.let { DeepLinkDestination.Session(it) }
                    ?: DeepLinkDestination.Home
            }
            else -> DeepLinkDestination.Home
        }
    }

    private fun resolveHttpScheme(uri: Uri): DeepLinkDestination {
        // https://your-domain.com/session/{id}
        // https://your-domain.com/sessions/{id}
        // https://your-domain.com/new
        val segments = uri.pathSegments

        if (segments.isEmpty()) return DeepLinkDestination.Home

        return when (segments[0].lowercase()) {
            "session", "sessions" -> {
                if (segments.size >= 2) {
                    DeepLinkDestination.Session(segments[1])
                } else {
                    DeepLinkDestination.Home
                }
            }
            "new" -> DeepLinkDestination.NewSession
            "settings" -> DeepLinkDestination.Settings
            "analytics" -> DeepLinkDestination.Analytics(uri.getQueryParameter("range"))
            else -> DeepLinkDestination.Home
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Build a `claudewebui://session/{id}` [Uri] for use in [Intent]s and
     * [androidx.navigation.NavController] deep-link calls.
     */
    fun sessionUri(sessionId: String): Uri =
        Uri.parse("claudewebui://session/$sessionId")

    fun newSessionUri(): Uri = Uri.parse("claudewebui://new")

    fun settingsUri(): Uri = Uri.parse("claudewebui://settings")

    fun analyticsUri(range: String? = null): Uri =
        Uri.parse("claudewebui://analytics" + (range?.let { "?range=$it" } ?: ""))
}
