package com.claudewebui.app.data.local.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import androidx.room.Transaction
import com.claudewebui.app.data.local.entity.SessionReadStateEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface SessionReadStateDao {
    @Query("SELECT * FROM session_read_state")
    fun observeAll(): Flow<List<SessionReadStateEntity>>

    @Query("SELECT * FROM session_read_state WHERE sessionId = :sessionId LIMIT 1")
    fun observe(sessionId: String): Flow<SessionReadStateEntity?>

    @Query("SELECT * FROM session_read_state WHERE sessionId = :sessionId LIMIT 1")
    suspend fun get(sessionId: String): SessionReadStateEntity?

    @Upsert
    suspend fun upsert(state: SessionReadStateEntity)

    @Query("UPDATE session_read_state SET unreadCount = :count WHERE sessionId = :sessionId")
    suspend fun updateUnreadCount(sessionId: String, count: Int)

    @Transaction
    suspend fun syncServerUnreadCounts(counts: Map<String, Int>) {
        counts.forEach { (sessionId, count) -> updateUnreadCount(sessionId, count) }
    }
}
