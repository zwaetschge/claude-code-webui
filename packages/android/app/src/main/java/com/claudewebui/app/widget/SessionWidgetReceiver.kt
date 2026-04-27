package com.claudewebui.app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews
import com.claudewebui.app.R

/**
 * Minimal AppWidgetProvider that displays a static "Claude WebUI" widget
 * using standard RemoteViews (no Glance dependency required).
 */
class SessionWidgetReceiver : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            val views = RemoteViews(context.packageName, R.layout.widget_session)
            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
