package com.claudewebui.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.claudewebui.app.data.local.entity.DraftEntity

@Dao
interface DraftDao {

    /** Return the current draft for a session, or null if none exists. */
    @Query("SELECT * FROM drafts WHERE sessionId = :sessionId LIMIT 1")
    suspend fun getBySessionId(sessionId: String): DraftEntity?

    /**
     * Insert or replace a draft.
     * Because [DraftEntity.sessionId] is the primary key, this effectively
     * acts as an upsert — the old draft is overwritten.
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(draft: DraftEntity)

    /** Delete the draft for a session (called after the message is sent). */
    @Query("DELETE FROM drafts WHERE sessionId = :sessionId")
    suspend fun delete(sessionId: String)

    /** Delete all drafts — used on logout. */
    @Query("DELETE FROM drafts")
    suspend fun deleteAll()
}
