package com.claudewebui.app.navigation

/**
 * Sealed hierarchy of all navigation destinations in the app.
 * Top-level routes are objects; parameterized routes are data classes.
 */
sealed class Routes(val route: String) {

    // ---- Auth ----

    /** Login / server connection screen */
    object Login : Routes("login")

    /** Server setup / connection configuration screen */
    object ServerSetup : Routes("server_setup")

    // ---- Main ----

    /** Session list / dashboard */
    object Dashboard : Routes("dashboard")

    /** Chat view for a specific session */
    data class Chat(val sessionId: String) : Routes("chat/{sessionId}") {
        companion object {
            const val ROUTE = "chat/{sessionId}"
            const val ARG_SESSION_ID = "sessionId"
            fun createRoute(sessionId: String) = "chat/$sessionId"
        }
    }

    /** Create a new session */
    object NewSession : Routes("new_session")

    // ---- Settings (nested graph) ----

    /** Settings root screen */
    object Settings : Routes("settings")

    /** Provider configuration (API keys, models) */
    object SettingsProviders : Routes("settings/providers")

    /** MCP server management */
    object SettingsMcp : Routes("settings/mcp")

    /** CLI tool configuration */
    object SettingsCliTools : Routes("settings/cli_tools")

    /** Custom agent configuration */
    object SettingsAgents : Routes("settings/agents")

    /** Tool permissions */
    object SettingsPermissions : Routes("settings/permissions")

    // ---- Session-scoped tools ----

    /** File browser for a session's working directory */
    data class FileManager(val sessionId: String) : Routes("file_manager/{sessionId}") {
        companion object {
            const val ROUTE = "file_manager/{sessionId}"
            const val ARG_SESSION_ID = "sessionId"
            fun createRoute(sessionId: String) = "file_manager/$sessionId"
        }
    }

    /** File viewer — navigated to from FileManagerScreen internally (back-stack entry only) */
    data class FileViewer(val sessionId: String, val filePath: String) :
        Routes("file_viewer/{sessionId}/{filePath}") {
        companion object {
            const val ROUTE = "file_viewer/{sessionId}/{filePath}"
            const val ARG_SESSION_ID = "sessionId"
            const val ARG_FILE_PATH = "filePath"
            fun createRoute(sessionId: String, filePath: String) =
                "file_viewer/$sessionId/$filePath"
        }
    }

    /** Usage analytics dashboard */
    object Analytics : Routes("analytics")

    /** Watchdog / background process monitor */
    object Watchdog : Routes("watchdog")

    /** Orchestration / multi-agent view for a session */
    data class Orchestration(val sessionId: String) : Routes("orchestration/{sessionId}") {
        companion object {
            const val ROUTE = "orchestration/{sessionId}"
            const val ARG_SESSION_ID = "sessionId"
            fun createRoute(sessionId: String) = "orchestration/$sessionId"
        }
    }

    /** Ralph AI assistant for a session */
    data class Ralph(val sessionId: String) : Routes("ralph/{sessionId}") {
        companion object {
            const val ROUTE = "ralph/{sessionId}"
            const val ARG_SESSION_ID = "sessionId"
            fun createRoute(sessionId: String) = "ralph/$sessionId"
        }
    }

    /** Checkpoint manager for a session */
    data class CheckpointManager(val sessionId: String) : Routes("checkpoints/{sessionId}") {
        companion object {
            const val ROUTE = "checkpoints/{sessionId}"
            const val ARG_SESSION_ID = "sessionId"
            fun createRoute(sessionId: String) = "checkpoints/$sessionId"
        }
    }

    /** Git manager for a session's repository */
    data class GitManager(val sessionId: String) : Routes("git/{sessionId}") {
        companion object {
            const val ROUTE = "git/{sessionId}"
            const val ARG_SESSION_ID = "sessionId"
            fun createRoute(sessionId: String) = "git/$sessionId"
        }
    }

    /** Usage stats for a session */
    data class Usage(val sessionId: String) : Routes("usage/{sessionId}") {
        companion object {
            const val ROUTE = "usage/{sessionId}"
            const val ARG_SESSION_ID = "sessionId"
            fun createRoute(sessionId: String) = "usage/$sessionId"
        }
    }
}

/** Nested navigation graph tag for settings */
const val SETTINGS_GRAPH = "settings_graph"
