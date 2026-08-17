package com.claudewebui.app.widget

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Fetches a fresh [WidgetSnapshot] and pushes it to every placed widget.
 * Runs every 15 minutes while widgets exist, plus on demand (widget "↻" tap,
 * widget placement, app start).
 */
class WidgetRefreshWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val context = applicationContext
        val hasWidgets = WidgetHub.hasAnyWidgets(context)
        val hasWatch = com.claudewebui.app.wear.WearSync.hasPairedNode(context)
        // Nothing left to feed — stop burning battery every 15 minutes. The
        // next widget placement or app start schedules it again.
        if (!hasWidgets && !hasWatch) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK)
            return Result.success()
        }

        val snapshot = WidgetDataFetcher.fetch(context)
        if (hasWidgets) {
            WidgetHub.pushAll(context, snapshot ?: WidgetStore.load(context))
        }
        if (snapshot != null) {
            UsageAlerts.check(context, snapshot)
            if (hasWatch) com.claudewebui.app.wear.WearSync.push(context, snapshot)
        }
        return Result.success()
    }

    companion object {
        private const val PERIODIC_WORK = "plum-widget-refresh"
        private const val ONESHOT_WORK = "plum-widget-refresh-now"

        private val networkConstraint = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        fun ensurePeriodic(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_WORK,
                ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<WidgetRefreshWorker>(15, TimeUnit.MINUTES)
                    .setConstraints(networkConstraint)
                    .build(),
            )
        }

        fun refreshNow(context: Context) {
            WorkManager.getInstance(context).enqueueUniqueWork(
                ONESHOT_WORK,
                ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
                    .setConstraints(networkConstraint)
                    .build(),
            )
        }
    }
}
