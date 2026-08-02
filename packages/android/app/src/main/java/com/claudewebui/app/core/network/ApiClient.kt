package com.claudewebui.app.core.network

import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.*
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.okhttp.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.plugins.logging.*
import io.ktor.client.request.*
import io.ktor.client.request.forms.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Central HTTP client for all REST API communication with the Plum Code WebUI backend.
 * Uses Ktor with OkHttp engine, kotlinx.serialization for JSON, and automatic
 * bearer token injection via [AuthInterceptorPlugin].
 */
class ApiClient {

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = false
        explicitNulls = false
        coerceInputValues = true
    }

    private val client = HttpClient(OkHttp) {
        install(ContentNegotiation) {
            json(this@ApiClient.json)
        }
        install(AuthInterceptorPlugin)
        install(Logging) {
            level = LogLevel.NONE // Set to LogLevel.BODY for debugging
        }
        install(HttpTimeout) {
            requestTimeoutMillis = 30_000
            connectTimeoutMillis = 10_000
            socketTimeoutMillis = 30_000
        }
        defaultRequest {
            contentType(ContentType.Application.Json)
        }
    }

    private val baseUrl: String
        get() = TokenStore.getServerUrl() ?: "http://localhost:3001"

    private fun url(path: String): String = "$baseUrl$path"

    // ========================================================================
    // Auth
    // ========================================================================

    /** POST /auth/dev-login */
    suspend fun devLogin(request: LoginRequest): ApiResponse<LoginResponse> =
        client.post(url("/auth/dev-login")) {
            setBody(request)
        }.body()

    /** POST /auth/logout */
    suspend fun logout(): ApiResponse<Unit> =
        client.post(url("/auth/logout")).body()

    /** GET /auth/me */
    suspend fun me(): ApiResponse<AuthUser> =
        client.get(url("/auth/me")).body()

    /** GET /auth/providers */
    suspend fun authProviders(): ApiResponse<AuthProviders> =
        client.get(url("/auth/providers")).body()

    /** Exchange the short-lived Authelia handoff code for a Plum JWT. */
    suspend fun mobileAuthExchange(request: MobileAuthExchangeRequest): ApiResponse<LoginResponse> =
        client.post(url("/auth/mobile/exchange")) {
            setBody(request)
        }.body()

    /** POST /api/basic-auth/login */
    suspend fun basicAuthLogin(request: BasicAuthLoginRequest): ApiResponse<LoginResponse> =
        client.post(url("/api/basic-auth/login")) {
            setBody(request)
        }.body()

    // ========================================================================
    // Sessions
    // ========================================================================

    /** GET /api/sessions */
    suspend fun getSessions(): ApiResponse<List<Session>> =
        client.get(url("/api/sessions")).body()

    /** GET /api/sessions/:id */
    suspend fun getSession(id: String): ApiResponse<Session> =
        client.get(url("/api/sessions/$id")).body()

    /** POST /api/sessions */
    suspend fun createSession(input: CreateSessionInput): ApiResponse<Session> =
        client.post(url("/api/sessions")) {
            setBody(input)
        }.body()

    /** PUT /api/sessions/:id */
    suspend fun updateSession(id: String, input: UpdateSessionInput): ApiResponse<Session> =
        client.put(url("/api/sessions/$id")) {
            setBody(input)
        }.body()

    /** DELETE /api/sessions/:id */
    suspend fun deleteSession(id: String): ApiResponse<Unit> =
        client.delete(url("/api/sessions/$id")).body()

    /** POST /api/sessions/:id/star */
    suspend fun starSession(id: String): ApiResponse<Session> =
        client.post(url("/api/sessions/$id/star")).body()

    /** PUT /api/sessions/:id/provider */
    suspend fun switchProvider(id: String, input: SwitchProviderInput): ApiResponse<Session> =
        client.put(url("/api/sessions/$id/provider")) {
            setBody(input)
        }.body()

    /** GET /api/sessions/:id/messages */
    suspend fun getMessages(sessionId: String): ApiResponse<List<Message>> =
        client.get(url("/api/sessions/$sessionId/messages")).body()

    /** GET /api/sessions/search?q=:query */
    suspend fun searchSessions(query: String): ApiResponse<List<Session>> =
        client.get(url("/api/sessions/search")) {
            parameter("q", query)
        }.body()

    /** PUT /api/sessions/:id/category */
    suspend fun updateSessionCategory(id: String, categoryId: String?): ApiResponse<Session> =
        client.put(url("/api/sessions/$id/category")) {
            setBody(mapOf("category" to categoryId))
        }.body()

    // ========================================================================
    // Files
    // ========================================================================

    /** GET /api/files/directory?path=:path */
    suspend fun getDirectory(path: String): ApiResponse<DirectoryContents> =
        client.get(url("/api/files/directory")) {
            parameter("path", path)
        }.body()

    /** GET /api/files/home */
    suspend fun getHomePaths(): ApiResponse<HomePaths> =
        client.get(url("/api/files/home")).body()

    /** POST /api/files/upload (multipart) */
    suspend fun uploadFile(
        sessionId: String,
        fileName: String,
        fileBytes: ByteArray,
        mimeType: String
    ): ApiResponse<JsonElement> =
        client.submitFormWithBinaryData(
            url = url("/api/files/upload"),
            formData = formData {
                append("sessionId", sessionId)
                append("file", fileBytes, Headers.build {
                    append(HttpHeaders.ContentDisposition, "filename=\"$fileName\"")
                    append(HttpHeaders.ContentType, mimeType)
                })
            }
        ).body()

    // ========================================================================
    // Git
    // ========================================================================

    /** GET /api/git/status?path=:path */
    suspend fun gitStatus(path: String): ApiResponse<GitStatus> =
        client.get(url("/api/git/status")) {
            parameter("path", path)
        }.body()

    /** GET /api/git/log?path=:path&limit=:limit */
    suspend fun gitLog(path: String, limit: Int = 50): ApiResponse<List<GitCommit>> =
        client.get(url("/api/git/log")) {
            parameter("path", path)
            parameter("limit", limit)
        }.body()

    /** GET /api/git/diff?path=:path */
    suspend fun gitDiff(path: String): ApiResponse<List<GitFileDiff>> =
        client.get(url("/api/git/diff")) {
            parameter("path", path)
        }.body()

    /** POST /api/git/commit */
    suspend fun gitCommit(path: String, input: GitCommitInput): ApiResponse<GitCommitResult> =
        client.post(url("/api/git/commit")) {
            setBody(mapOf("path" to path, "message" to input.message, "files" to input.files))
        }.body()

    /** POST /api/git/push */
    suspend fun gitPush(path: String, input: GitPushInput = GitPushInput()): ApiResponse<JsonElement> =
        client.post(url("/api/git/push")) {
            setBody(mapOf("path" to path, "remote" to input.remote, "branch" to input.branch))
        }.body()

    /** POST /api/git/pull */
    suspend fun gitPull(path: String): ApiResponse<JsonElement> =
        client.post(url("/api/git/pull")) {
            setBody(mapOf("path" to path))
        }.body()

    /** GET /api/git/branches?path=:path */
    suspend fun gitBranches(path: String): ApiResponse<List<GitBranch>> =
        client.get(url("/api/git/branches")) {
            parameter("path", path)
        }.body()

    // ========================================================================
    // Settings
    // ========================================================================

    /** GET /api/settings */
    suspend fun getSettings(): ApiResponse<UserSettings> =
        client.get(url("/api/settings")).body()

    /** PUT /api/settings */
    suspend fun updateSettings(input: UpdateSettingsInput): ApiResponse<UserSettings> =
        client.put(url("/api/settings")) {
            setBody(input)
        }.body()

    // ========================================================================
    // Categories
    // ========================================================================

    /** GET /api/categories */
    suspend fun getCategories(): ApiResponse<List<Category>> =
        client.get(url("/api/categories")).body()

    /** POST /api/categories */
    suspend fun createCategory(input: CreateCategoryInput): ApiResponse<Category> =
        client.post(url("/api/categories")) {
            setBody(input)
        }.body()

    /** PUT /api/categories/:id */
    suspend fun updateCategory(id: String, input: UpdateCategoryInput): ApiResponse<Category> =
        client.put(url("/api/categories/$id")) {
            setBody(input)
        }.body()

    /** DELETE /api/categories/:id */
    suspend fun deleteCategory(id: String): ApiResponse<Unit> =
        client.delete(url("/api/categories/$id")).body()

    // ========================================================================
    // Checkpoints
    // ========================================================================

    /** GET /api/checkpoints/sessions/:sessionId */
    suspend fun getCheckpoints(sessionId: String): ApiResponse<List<Checkpoint>> =
        client.get(url("/api/checkpoints/sessions/$sessionId")).body()

    /** POST /api/checkpoints/sessions/:sessionId */
    suspend fun createCheckpoint(
        sessionId: String,
        input: CreateCheckpointInput
    ): ApiResponse<Checkpoint> =
        client.post(url("/api/checkpoints/sessions/$sessionId")) {
            setBody(input)
        }.body()

    /** POST /api/checkpoints/:checkpointId/restore */
    suspend fun restoreCheckpoint(checkpointId: String): ApiResponse<JsonElement> =
        client.post(url("/api/checkpoints/$checkpointId/restore")).body()

    /** DELETE /api/checkpoints/:checkpointId */
    suspend fun deleteCheckpoint(checkpointId: String): ApiResponse<Unit> =
        client.delete(url("/api/checkpoints/$checkpointId")).body()

    // ========================================================================
    // AI Providers
    // ========================================================================

    /** GET /api/providers */
    suspend fun getProviders(): ApiResponse<List<AIProvider>> =
        client.get(url("/api/providers")).body()

    /** POST /api/providers */
    suspend fun createProvider(input: CreateProviderInput): ApiResponse<AIProvider> =
        client.post(url("/api/providers")) {
            setBody(input)
        }.body()

    /** PUT /api/providers/:id */
    suspend fun updateProvider(id: String, input: UpdateProviderInput): ApiResponse<AIProvider> =
        client.put(url("/api/providers/$id")) {
            setBody(input)
        }.body()

    /** DELETE /api/providers/:id */
    suspend fun deleteProvider(id: String): ApiResponse<Unit> =
        client.delete(url("/api/providers/$id")).body()

    /** GET /api/cli-providers/status */
    suspend fun cliProviderStatus(): ApiResponse<CLIProviderStatus> =
        client.get(url("/api/cli-providers/status")).body()

    /** GET /api/cli-providers */
    suspend fun getCLIProviders(): ApiResponse<List<CLIProviderConfig>> =
        client.get(url("/api/cli-providers")).body()

    // ========================================================================
    // MCP Servers
    // ========================================================================

    /** GET /api/mcp */
    suspend fun getMcpServers(): ApiResponse<List<McpServer>> =
        client.get(url("/api/mcp")).body()

    /** POST /api/mcp */
    suspend fun createMcpServer(input: CreateMcpServerInput): ApiResponse<McpServer> =
        client.post(url("/api/mcp")) {
            setBody(input)
        }.body()

    /** PUT /api/mcp/:id */
    suspend fun updateMcpServer(id: String, input: UpdateMcpServerInput): ApiResponse<McpServer> =
        client.put(url("/api/mcp/$id")) {
            setBody(input)
        }.body()

    /** DELETE /api/mcp/:id */
    suspend fun deleteMcpServer(id: String): ApiResponse<Unit> =
        client.delete(url("/api/mcp/$id")).body()

    // ========================================================================
    // CLI Tools
    // ========================================================================

    /** GET /api/cli-tools */
    suspend fun getCliTools(): ApiResponse<List<JsonElement>> =
        client.get(url("/api/cli-tools")).body()

    /** POST /api/cli-tools */
    suspend fun createCliTool(input: JsonElement): ApiResponse<JsonElement> =
        client.post(url("/api/cli-tools")) {
            setBody(input)
        }.body()

    /** PUT /api/cli-tools/:id */
    suspend fun updateCliTool(id: String, input: JsonElement): ApiResponse<JsonElement> =
        client.put(url("/api/cli-tools/$id")) {
            setBody(input)
        }.body()

    /** DELETE /api/cli-tools/:id */
    suspend fun deleteCliTool(id: String): ApiResponse<Unit> =
        client.delete(url("/api/cli-tools/$id")).body()

    // ========================================================================
    // Custom Agents
    // ========================================================================

    /** GET /api/agents */
    suspend fun getAgents(): ApiResponse<List<CustomAgent>> =
        client.get(url("/api/agents")).body()

    /** GET /api/agents/:id */
    suspend fun getAgent(id: String): ApiResponse<CustomAgent> =
        client.get(url("/api/agents/$id")).body()

    /** POST /api/agents */
    suspend fun createAgent(input: CreateCustomAgentInput): ApiResponse<CustomAgent> =
        client.post(url("/api/agents")) {
            setBody(input)
        }.body()

    /** PUT /api/agents/:id */
    suspend fun updateAgent(id: String, input: UpdateCustomAgentInput): ApiResponse<CustomAgent> =
        client.put(url("/api/agents/$id")) {
            setBody(input)
        }.body()

    /** DELETE /api/agents/:id */
    suspend fun deleteAgent(id: String): ApiResponse<Unit> =
        client.delete(url("/api/agents/$id")).body()

    // ========================================================================
    // Analytics
    // ========================================================================

    /** GET /api/analytics */
    suspend fun getAnalytics(): ApiResponse<JsonElement> =
        client.get(url("/api/analytics")).body()

    /** GET /api/analytics?period=:period */
    suspend fun getAnalytics(period: String): ApiResponse<JsonElement> =
        client.get(url("/api/analytics")) {
            parameter("period", period)
        }.body()

    // ========================================================================
    // Usage
    // ========================================================================

    /** GET /api/usage */
    suspend fun getUsage(): ApiResponse<JsonElement> =
        client.get(url("/api/usage")).body()

    /** GET /api/usage/sessions/:sessionId */
    suspend fun getSessionUsage(sessionId: String): ApiResponse<JsonElement> =
        client.get(url("/api/usage/sessions/$sessionId")).body()

    // ========================================================================
    // App Version
    // ========================================================================

    /** GET /api/app/version — returns latest Android APK metadata */
    suspend fun checkAppVersion(): ApiResponse<AppVersionInfo> =
        client.get(url("/api/app/version")).body()

    // ========================================================================
    // Health
    // ========================================================================

    /** GET /health */
    suspend fun health(): HttpResponse =
        client.get(url("/health"))

    // ========================================================================
    // Lifecycle
    // ========================================================================

    fun close() {
        client.close()
    }
}
