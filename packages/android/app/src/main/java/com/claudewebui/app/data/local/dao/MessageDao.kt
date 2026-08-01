package com.claudewebui.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.claudewebui.app.data.local.entity.MessageEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface MessageDao {

    /** Observe all messages for a session ordered chronologically. */
    @Query("SELECT * FROM messages WHERE sessionId = :sessionId ORDER BY timestamp ASC")
    fun getBySessionId(sessionId: String): Flow<List<MessageEntity>>

    /** Insert a single message, replacing on conflict (e.g. streaming update). */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(message: MessageEntity)

    /** Insert a batch of messages in one transaction. */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(messages: List<MessageEntity>)

    /** Remove all cached messages for a session (e.g. after session deletion). */
    @Query("DELETE FROM messages WHERE sessionId = :sessionId")
    suspend fun deleteBySessionId(sessionId: String)

    /**
     * Fetch the N most recent messages for a session — useful for
     * populating a summary or context window without loading the full history.
     */
    @Query(
        """
        SELECT * FROM messages
        WHERE sessionId = :sessionId
        ORDER BY timestamp DESC
        LIMIT :limit
        """
    )
    suspend fun getLatest(sessionId: String, limit: Int = 20): List<MessageEntity>

    /** One-shot fetch of all messages (no Flow). */
    @Query("SELECT * FROM messages WHERE sessionId = :sessionId ORDER BY timestamp ASC")
    suspend fun getBySessionIdOnce(sessionId: String): List<MessageEntity>

    /** Count cached messages for a session. */
    @Query("SELECT COUNT(*) FROM messages WHERE sessionId = :sessionId")
    suspend fun countForSession(sessionId: String): Int
}
