package com.claudewebui.app.data.local.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import androidx.room.Upsert
import com.claudewebui.app.data.local.entity.SessionEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface SessionDao {

    /** Observe all sessions ordered by most recently updated. */
    @Query("SELECT * FROM sessions ORDER BY updatedAt DESC")
    fun getAll(): Flow<List<SessionEntity>>

    /** Observe a single session by ID, or null if not cached. */
    @Query("SELECT * FROM sessions WHERE id = :id")
    fun getById(id: String): Flow<SessionEntity?>

    /** Observe sessions belonging to a specific category. */
    @Query("SELECT * FROM sessions WHERE categoryId = :categoryId ORDER BY updatedAt DESC")
    fun getByCategory(categoryId: String): Flow<List<SessionEntity>>

    /** Observe starred sessions. */
    @Query("SELECT * FROM sessions WHERE starred = 1 ORDER BY updatedAt DESC")
    fun getStarred(): Flow<List<SessionEntity>>

    /**
     * Insert or update a session. Must NOT use OnConflictStrategy.REPLACE:
     * SQLite implements REPLACE as DELETE+INSERT, which cascades the
     * messages/drafts foreign keys and wipes the cached chat history on
     * every session refresh.
     */
    @Upsert
    suspend fun insert(session: SessionEntity)

    /** Insert or update multiple sessions in a single transaction. */
    @Upsert
    suspend fun insertAll(sessions: List<SessionEntity>)

    /** Replace the remote snapshot without deleting still-valid parent rows first. */
    @Transaction
    suspend fun syncRemote(sessions: List<SessionEntity>) {
        insertAll(sessions)
        if (sessions.isEmpty()) deleteAll() else deleteNotIn(sessions.map { it.id })
    }

    @Query("DELETE FROM sessions WHERE id NOT IN (:ids)")
    suspend fun deleteNotIn(ids: List<String>)

    @Update
    suspend fun update(session: SessionEntity)

    @Delete
    suspend fun delete(session: SessionEntity)

    /** Delete a session by ID. */
    @Query("DELETE FROM sessions WHERE id = :id")
    suspend fun deleteById(id: String)

    /** Clear the entire session cache. Called before a full network refresh. */
    @Query("DELETE FROM sessions")
    suspend fun deleteAll()

    /** One-shot fetch for a single session (no Flow). */
    @Query("SELECT * FROM sessions WHERE id = :id LIMIT 1")
    suspend fun getByIdOnce(id: String): SessionEntity?

    /** One-shot count — useful for deciding whether to show an empty state. */
    @Query("SELECT COUNT(*) FROM sessions")
    suspend fun count(): Int
}
