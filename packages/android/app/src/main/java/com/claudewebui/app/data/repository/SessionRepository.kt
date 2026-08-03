package com.claudewebui.app.data.repository

import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.local.dao.SessionDao
import com.claudewebui.app.data.local.entity.toEntity
import com.claudewebui.app.data.local.entity.toModel
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.CreateSessionInput
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SwitchProviderInput
import com.claudewebui.app.data.model.UpdateSessionInput
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Single source of truth for [Session] data.
 *
 * Strategy: Room is the primary data source for the UI (via [Flow]).
 * Network calls write their results back to Room, which automatically
 * triggers recomposition in consumers.
 */
class SessionRepository(
    private val api: ApiClient,
    private val dao: SessionDao
) {

    // ---- Observable streams ------------------------------------------------

    /** All sessions, ordered by most recently updated. Backed by Room. */
    val sessions: Flow<List<Session>> = dao.getAll().map { list -> list.map { it.toModel() } }

    /** Sessions filtered by category. */
    fun getByCategory(categoryId: String): Flow<List<Session>> =
        dao.getByCategory(categoryId).map { list -> list.map { it.toModel() } }

    /** Starred sessions. */
    val starredSessions: Flow<List<Session>> =
        dao.getStarred().map { list -> list.map { it.toModel() } }

    /** Single session observed by ID (emits null while not cached). */
    fun observeSession(id: String): Flow<Session?> =
        dao.getById(id).map { it?.toModel() }

    // ---- Network + cache operations ----------------------------------------

    /**
     * Refresh sessions from the network and persist to Room.
     * @param forceRefresh when true, clears the local cache before inserting.
     */
    suspend fun getSessions(forceRefresh: Boolean = false): Result<List<Session>> {
        return runCatching {
            val response = api.getSessions()
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Failed to fetch sessions")
            }
            val sessions = response.data
            if (forceRefresh) {
                dao.deleteAll()
            }
            dao.insertAll(sessions.map { it.toEntity() })
            sessions
        }
    }

    /**
     * Fetch a single session from the network and update the local cache.
     */
    suspend fun getSession(id: String): Result<Session> {
        return runCatching {
            val response = api.getSession(id)
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Session not found")
            }
            val session = response.data
            dao.insert(session.toEntity())
            session
        }
    }

    /**
     * Create a new session on the server and insert it into the local cache.
     */
    suspend fun createSession(
        name: String,
        workingDirectory: String? = null,
        cliProvider: CLIProvider? = null
    ): Result<Session> {
        return runCatching {
            val response = api.createSession(
                CreateSessionInput(
                    name = name,
                    workingDirectory = workingDirectory,
                    cliProvider = cliProvider
                )
            )
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Failed to create session")
            }
            val session = response.data
            dao.insert(session.toEntity())
            session
        }
    }

    /**
     * Update a session's name or working directory and refresh the cache.
     */
    suspend fun updateSession(
        id: String,
        name: String? = null,
        workingDirectory: String? = null
    ): Result<Session> {
        return runCatching {
            val response = api.updateSession(id, UpdateSessionInput(name, workingDirectory))
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Failed to update session")
            }
            val session = response.data
            dao.insert(session.toEntity())
            session
        }
    }

    /**
     * Delete a session from the server and remove it from the local cache.
     */
    suspend fun deleteSession(id: String): Result<Unit> {
        return runCatching {
            val response = api.deleteSession(id)
            if (!response.success) {
                error(response.error?.message ?: "Failed to delete session")
            }
            dao.deleteById(id)
        }
    }

    /**
     * Star/unstar a session.
     */
    suspend fun starSession(id: String): Result<Session> {
        return runCatching {
            val response = api.starSession(id)
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Failed to star session")
            }
            val session = response.data
            dao.insert(session.toEntity())
            session
        }
    }

    /**
     * Switch the CLI provider for a session.
     */
    suspend fun switchProvider(id: String, provider: CLIProvider): Result<Session> {
        return runCatching {
            val switchInput = SwitchProviderInput(cliProvider = provider)
            val response = api.switchProvider(id, switchInput)
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Failed to switch provider")
            }
            val session = response.data
            dao.insert(session.toEntity())
            session
        }
    }

    /** Set the model this session runs; null restores the provider default. */
    suspend fun setModel(id: String, model: String?): Result<Session> = runCatching {
        val response = api.setSessionModel(id, model)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to set model")
        }
        dao.insert(response.data.toEntity())
        response.data
    }

    /** Set the reasoning level, where the provider supports one. */
    suspend fun setReasoning(id: String, reasoning: String?): Result<Session> = runCatching {
        val response = api.setSessionReasoning(id, reasoning)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to set reasoning")
        }
        dao.insert(response.data.toEntity())
        response.data
    }

    suspend fun getAllowedDirectories(id: String): Result<List<String>> = runCatching {
        val response = api.getAllowedDirectories(id)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to load allowed directories")
        }
        response.data
    }

    suspend fun addAllowedDirectory(id: String, directory: String): Result<List<String>> = runCatching {
        val response = api.addAllowedDirectory(id, directory)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to allow directory")
        }
        response.data
    }

    suspend fun removeAllowedDirectory(id: String, directory: String): Result<List<String>> = runCatching {
        val response = api.removeAllowedDirectory(id, directory)
        if (!response.success || response.data == null) {
            error(response.error?.message ?: "Failed to remove directory")
        }
        response.data
    }

    /**
     * Update the category for a session.
     */
    suspend fun updateCategory(id: String, categoryId: String?): Result<Session> {
        return runCatching {
            val response = api.updateSessionCategory(id, categoryId)
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Failed to update category")
            }
            val session = response.data
            dao.insert(session.toEntity())
            session
        }
    }

    /**
     * Search sessions by query — returns a network result (not cached).
     */
    suspend fun searchSessions(query: String): Result<List<Session>> {
        return runCatching {
            val response = api.searchSessions(query)
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Search failed")
            }
            response.data
        }
    }
}
