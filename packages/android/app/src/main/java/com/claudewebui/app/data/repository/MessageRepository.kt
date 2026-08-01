package com.claudewebui.app.data.repository

import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.local.dao.DraftDao
import com.claudewebui.app.data.local.dao.MessageDao
import com.claudewebui.app.data.local.entity.DraftEntity
import com.claudewebui.app.data.local.entity.toEntity
import com.claudewebui.app.data.local.entity.toModel
import com.claudewebui.app.data.model.Message
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Single source of truth for chat [Message] data.
 *
 * Messages are fetched from the network and persisted to Room.
 * Real-time streaming is handled by [SocketManager] and piped
 * directly to [MessageDao] — see [ChatViewModel] for the wiring.
 */
class MessageRepository(
    private val api: ApiClient,
    private val dao: MessageDao,
    private val draftDao: DraftDao
) {

    // ---- Observable streams ------------------------------------------------

    /**
     * Observe all cached messages for a session in chronological order.
     * Backed by Room — updates automatically when new messages arrive.
     */
    fun getMessages(sessionId: String): Flow<List<Message>> =
        dao.getBySessionId(sessionId).map { list -> list.map { it.toModel() } }

    // ---- Network + cache ---------------------------------------------------

    /**
     * Fetch full message history from the network and store in Room.
     * @param sessionId the session whose history to load.
     * @param clearExisting when true, clears stale cache before inserting.
     */
    suspend fun fetchMessages(sessionId: String, clearExisting: Boolean = false): Result<List<Message>> {
        return runCatching {
            val response = api.getMessages(sessionId)
            if (!response.success || response.data == null) {
                error(response.error?.message ?: "Failed to fetch messages")
            }
            val messages = response.data
            if (clearExisting) {
                dao.deleteBySessionId(sessionId)
            }
            dao.insertAll(messages.map { it.toEntity() })
            messages
        }
    }

    /**
     * Return the N most recent cached messages without subscribing to updates.
     * Used for quick context summaries.
     */
    suspend fun getCachedMessages(sessionId: String, limit: Int = 20): List<Message> =
        dao.getLatest(sessionId, limit).map { it.toModel() }

    /**
     * Persist a single message to the local cache (used when a streaming
     * message is completed and delivered via Socket.IO).
     */
    suspend fun cacheMessage(message: Message) {
        dao.insert(message.toEntity())
    }

    /**
     * Persist a batch of messages (e.g. after a full history sync).
     */
    suspend fun cacheMessages(messages: List<Message>) {
        dao.insertAll(messages.map { it.toEntity() })
    }

    /** Remove all cached messages for a session. */
    suspend fun clearMessages(sessionId: String) {
        dao.deleteBySessionId(sessionId)
    }

    // ---- Drafts ------------------------------------------------------------

    /** Load the current draft for a session, or null if none. */
    suspend fun getDraft(sessionId: String): String? =
        draftDao.getBySessionId(sessionId)?.content

    /** Save or update the draft for a session. */
    suspend fun saveDraft(sessionId: String, content: String) {
        draftDao.upsert(DraftEntity(sessionId = sessionId, content = content))
    }

    /** Delete the draft for a session (called after a message is sent). */
    suspend fun clearDraft(sessionId: String) {
        draftDao.delete(sessionId)
    }
}
