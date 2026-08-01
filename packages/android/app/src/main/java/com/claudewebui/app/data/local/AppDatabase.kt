package com.claudewebui.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import com.claudewebui.app.data.local.dao.DraftDao
import com.claudewebui.app.data.local.dao.MessageDao
import com.claudewebui.app.data.local.dao.SessionDao
import com.claudewebui.app.data.local.entity.DraftEntity
import com.claudewebui.app.data.local.entity.MessageEntity
import com.claudewebui.app.data.local.entity.SessionEntity

/**
 * Main Room database for the Claude Code WebUI Android app.
 *
 * Bump [version] and provide a [androidx.room.migration.Migration] whenever
 * the schema changes. [fallbackToDestructiveMigration] is configured in
 * [DatabaseModule] as a safety net during development.
 */
@Database(
    entities = [
        SessionEntity::class,
        MessageEntity::class,
        DraftEntity::class
    ],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun sessionDao(): SessionDao
    abstract fun messageDao(): MessageDao
    abstract fun draftDao(): DraftDao

    companion object {
        const val DATABASE_NAME = "claude_webui.db"
    }
}
