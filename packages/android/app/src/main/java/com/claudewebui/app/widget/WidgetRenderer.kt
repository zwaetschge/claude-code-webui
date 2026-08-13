package com.claudewebui.app.widget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import com.claudewebui.app.MainActivity
import com.claudewebui.app.R
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Which of the ten home-screen widgets a provider instance renders. */
enum class WidgetKind(val titleText: String) {
    SESSIONS("Sessions & Agents"),
    APPROVALS("Approvals"),
    QUICK("Plum Code"),
    TOKENS("Tokens"),
    COST("Cost"),
    PROVIDERS("Providers"),
    MODELS("Models"),
    LIMITS("Provider Limits"),
    CHART("Activity · 7d"),
    TOP_SESSIONS("Top Sessions · 7d"),
}

/**
 * Builds the RemoteViews for every widget kind from one cached snapshot,
 * honouring the per-instance [WidgetConfig]. [compact] renders the reduced
 * variant used for small grid sizes on Android 12+.
 */
object WidgetRenderer {

    // Per row: container, dot, label, value, sub, bar, approve, deny
    private val ROW_IDS = arrayOf(
        intArrayOf(R.id.row1, R.id.row1_dot, R.id.row1_label, R.id.row1_value, R.id.row1_sub, R.id.row1_bar, R.id.row1_approve, R.id.row1_deny),
        intArrayOf(R.id.row2, R.id.row2_dot, R.id.row2_label, R.id.row2_value, R.id.row2_sub, R.id.row2_bar, R.id.row2_approve, R.id.row2_deny),
        intArrayOf(R.id.row3, R.id.row3_dot, R.id.row3_label, R.id.row3_value, R.id.row3_sub, R.id.row3_bar, R.id.row3_approve, R.id.row3_deny),
        intArrayOf(R.id.row4, R.id.row4_dot, R.id.row4_label, R.id.row4_value, R.id.row4_sub, R.id.row4_bar, R.id.row4_approve, R.id.row4_deny),
        intArrayOf(R.id.row5, R.id.row5_dot, R.id.row5_label, R.id.row5_value, R.id.row5_sub, R.id.row5_bar, R.id.row5_approve, R.id.row5_deny),
    )

    fun render(
        context: Context,
        kind: WidgetKind,
        snapshot: WidgetSnapshot?,
        config: WidgetConfig = WidgetConfig(),
        compact: Boolean = false,
    ): RemoteViews {
        val views = when (kind) {
            WidgetKind.QUICK, WidgetKind.TOKENS, WidgetKind.COST ->
                RemoteViews(context.packageName, R.layout.widget_stat)
            WidgetKind.CHART ->
                RemoteViews(context.packageName, R.layout.widget_chart)
            else ->
                RemoteViews(context.packageName, R.layout.widget_list)
        }

        if (config.translucent) {
            views.setInt(R.id.widget_root, "setBackgroundResource", R.drawable.widget_bg_translucent)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Material You: follow the device accent instead of fixed plum.
            views.setTextColor(R.id.widget_title, context.getColor(android.R.color.system_accent1_200))
        }

        views.setTextViewText(R.id.widget_title, title(kind, config))
        views.setOnClickPendingIntent(R.id.widget_refresh, refreshIntent(context, kind))
        views.setOnClickPendingIntent(R.id.widget_title, openAppIntent(context, kind, config))
        views.setViewVisibility(R.id.widget_updated, if (compact) View.GONE else View.VISIBLE)
        views.setTextViewText(
            R.id.widget_updated,
            snapshot?.let {
                "Updated " + SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(it.updatedAtMs))
            } ?: "Open Plum Code and sign in",
        )

        if (snapshot == null) {
            renderEmpty(kind, views)
            return views
        }

        val maxRows = if (compact) 3 else ROW_IDS.size
        when (kind) {
            WidgetKind.SESSIONS -> renderSessions(context, views, snapshot, config, maxRows)
            WidgetKind.APPROVALS -> renderApprovals(context, views, snapshot, maxRows)
            WidgetKind.QUICK -> renderQuick(views, snapshot, config, compact)
            WidgetKind.TOKENS -> renderTokens(views, snapshot, config, compact)
            WidgetKind.COST -> renderCost(views, snapshot, config, compact)
            WidgetKind.PROVIDERS -> renderProviders(views, snapshot, config, maxRows)
            WidgetKind.MODELS -> renderModels(views, snapshot, config, maxRows)
            WidgetKind.LIMITS -> renderLimits(views, snapshot, maxRows)
            WidgetKind.CHART -> renderChart(context, views, snapshot, config)
            WidgetKind.TOP_SESSIONS -> renderTopSessions(context, views, snapshot, maxRows)
        }
        return views
    }

    private fun title(kind: WidgetKind, config: WidgetConfig): String {
        val base = kind.titleText
        val suffix = when (kind) {
            WidgetKind.TOKENS, WidgetKind.COST ->
                if (config.period == "7d") " · 7d" else " · today"
            WidgetKind.PROVIDERS, WidgetKind.MODELS -> " · 7d"
            else -> ""
        }
        val filter = config.provider
            ?.takeIf { kind in setOf(WidgetKind.SESSIONS, WidgetKind.PROVIDERS, WidgetKind.MODELS) }
            ?.let { " · $it" } ?: ""
        return base + suffix + filter
    }

    private fun statPeriod(snapshot: WidgetSnapshot, config: WidgetConfig): WPeriod =
        if (config.period == "7d") snapshot.week else snapshot.today

    private fun periodLabel(config: WidgetConfig): String =
        if (config.period == "7d") "this week" else "today"

    // ── Kind renderers ─────────────────────────────────────────────────────

    private fun renderSessions(
        context: Context,
        views: RemoteViews,
        s: WidgetSnapshot,
        config: WidgetConfig,
        maxRows: Int,
    ) {
        val sessions = s.sessions.filter { config.provider == null || it.provider == config.provider }
        val running = sessions.count { it.status == "running" }
        views.setTextViewText(
            R.id.widget_headline,
            "$running running · ${s.approvals.size} approvals",
        )
        bindRows(views, sessions.size, maxRows, emptyMessage = "No sessions yet") { i, ids ->
            val session = sessions[i]
            val color = when (session.status) {
                "running" -> 0xFF22C55E
                "error" -> 0xFFEF4444
                else -> 0xFF6B6577
            }
            views.setTextColor(ids[1], color.toInt())
            views.setTextViewText(ids[2], session.name)
            views.setTextViewText(ids[3], session.provider)
            views.setViewVisibility(ids[4], View.VISIBLE)
            val statusText = if (session.status == "running") "working" else session.status
            views.setTextViewText(ids[4], "$statusText · ${session.mode}")
            views.setOnClickPendingIntent(ids[0], sessionIntent(context, session.id, i))
        }
    }

    private fun renderApprovals(context: Context, views: RemoteViews, s: WidgetSnapshot, maxRows: Int) {
        views.setTextViewText(
            R.id.widget_headline,
            if (s.approvals.isEmpty()) "all clear" else "${s.approvals.size} pending",
        )
        bindRows(views, s.approvals.size, maxRows, emptyMessage = "No pending approvals 🎉") { i, ids ->
            val approval = s.approvals[i]
            views.setTextColor(ids[1], 0xFFF59E0B.toInt())
            views.setTextViewText(ids[2], approval.toolName)
            views.setTextViewText(ids[3], "")
            views.setViewVisibility(ids[4], View.VISIBLE)
            views.setTextViewText(ids[4], approval.sessionName)
            views.setViewVisibility(ids[6], View.VISIBLE)
            views.setViewVisibility(ids[7], View.VISIBLE)
            views.setOnClickPendingIntent(
                ids[6],
                approvalIntent(context, ACTION_WIDGET_APPROVE, approval, i),
            )
            views.setOnClickPendingIntent(
                ids[7],
                approvalIntent(context, ACTION_WIDGET_DENY, approval, i),
            )
            views.setOnClickPendingIntent(ids[0], sessionIntent(context, approval.sessionId, i))
        }
    }

    private fun renderQuick(views: RemoteViews, s: WidgetSnapshot, config: WidgetConfig, compact: Boolean) {
        val running = s.sessions.count { it.status == "running" }
        val period = statPeriod(s, config)
        views.setTextViewText(R.id.widget_big_value, "$running running")
        views.setTextViewText(
            R.id.widget_big_caption,
            if (s.approvals.isEmpty()) "no approvals pending"
            else "${s.approvals.size} approval${if (s.approvals.size == 1) "" else "s"} pending",
        )
        setSub(views, 1, fmtTokens(period.totalTokens), "tokens ${periodLabel(config)}", compact)
        setSub(views, 2, fmtCost(period.costUsd), "cost", compact)
        setSub(views, 3, period.requests.toString(), "requests", compact)
    }

    private fun renderTokens(views: RemoteViews, s: WidgetSnapshot, config: WidgetConfig, compact: Boolean) {
        val period = statPeriod(s, config)
        views.setTextViewText(R.id.widget_big_value, fmtTokens(period.totalTokens))
        views.setTextViewText(R.id.widget_big_caption, "tokens ${periodLabel(config)}")
        setSub(views, 1, fmtTokens(period.inputTokens), "input", compact)
        setSub(views, 2, fmtTokens(period.outputTokens), "output", compact)
        setSub(views, 3, fmtTokens(period.cacheReadTokens), "cache read", compact)
    }

    private fun renderCost(views: RemoteViews, s: WidgetSnapshot, config: WidgetConfig, compact: Boolean) {
        val period = statPeriod(s, config)
        val other = if (config.period == "7d") s.today else s.week
        val otherLabel = if (config.period == "7d") "today" else "this week"
        views.setTextViewText(R.id.widget_big_value, fmtCost(period.costUsd))
        views.setTextViewText(R.id.widget_big_caption, "cost ${periodLabel(config)} (API-equivalent)")
        setSub(views, 1, fmtCost(other.costUsd), otherLabel, compact)
        setSub(views, 2, period.requests.toString(), "requests", compact)
        setSub(views, 3, fmtTokens(period.totalTokens), "tokens", compact)
    }

    private fun renderProviders(views: RemoteViews, s: WidgetSnapshot, config: WidgetConfig, maxRows: Int) {
        val providers = s.providers.filter { config.provider == null || it.name.equals(config.provider, true) }
        views.setTextViewText(R.id.widget_headline, fmtCost(s.week.costUsd))
        val maxTokens = providers.maxOfOrNull { it.tokens }?.coerceAtLeast(1) ?: 1
        bindRows(views, providers.size, maxRows, emptyMessage = "No usage this week") { i, ids ->
            val entry = providers[i]
            views.setTextColor(ids[1], entry.colorArgb.toInt())
            views.setTextViewText(ids[2], entry.name)
            views.setTextViewText(ids[3], "${fmtTokens(entry.tokens)} · ${fmtCost(entry.costUsd)}")
            views.setViewVisibility(ids[5], View.VISIBLE)
            views.setProgressBar(ids[5], 100, (entry.tokens * 100 / maxTokens).toInt(), false)
        }
    }

    private fun renderModels(views: RemoteViews, s: WidgetSnapshot, config: WidgetConfig, maxRows: Int) {
        val models = s.models.filter { config.provider == null || it.sub.equals(config.provider, true) }
        bindRows(views, models.size, maxRows, emptyMessage = "No usage this week") { i, ids ->
            val entry = models[i]
            views.setTextColor(ids[1], entry.colorArgb.toInt())
            views.setTextViewText(ids[2], entry.name)
            views.setTextViewText(ids[3], fmtCost(entry.costUsd))
            views.setViewVisibility(ids[4], View.VISIBLE)
            views.setTextViewText(ids[4], "${entry.sub} · ${fmtTokens(entry.tokens)} tokens")
        }
    }

    private fun renderLimits(views: RemoteViews, s: WidgetSnapshot, maxRows: Int) {
        bindRows(views, s.limits.size, maxRows, emptyMessage = "No quota data — connect a provider") { i, ids ->
            val limit = s.limits[i]
            views.setTextColor(ids[1], limit.colorArgb.toInt())
            views.setTextViewText(ids[2], "${limit.provider} · ${limit.window}")
            views.setTextViewText(ids[3], "${limit.percent}%")
            views.setTextColor(
                ids[3],
                when {
                    limit.percent >= UsageAlerts.LIMIT_THRESHOLD_PERCENT -> 0xFFEF4444.toInt()
                    limit.percent >= 60 -> 0xFFF59E0B.toInt()
                    else -> 0xFFFFFFFF.toInt()
                },
            )
            views.setViewVisibility(ids[5], View.VISIBLE)
            views.setProgressBar(ids[5], 100, limit.percent.coerceIn(0, 100), false)
        }
    }

    private fun renderTopSessions(context: Context, views: RemoteViews, s: WidgetSnapshot, maxRows: Int) {
        bindRows(views, s.topSessions.size, maxRows, emptyMessage = "No usage this week") { i, ids ->
            val entry = s.topSessions[i]
            views.setTextColor(ids[1], 0xFFCC785C.toInt())
            views.setTextViewText(ids[2], entry.name)
            views.setTextViewText(ids[3], fmtCost(entry.costUsd))
            views.setViewVisibility(ids[4], View.VISIBLE)
            views.setTextViewText(ids[4], "${fmtTokens(entry.tokens)} tokens")
            if (entry.id.isNotBlank()) {
                views.setOnClickPendingIntent(ids[0], sessionIntent(context, entry.id, i))
            }
        }
    }

    private fun renderChart(context: Context, views: RemoteViews, s: WidgetSnapshot, config: WidgetConfig) {
        views.setTextViewText(
            R.id.widget_headline,
            "${fmtTokens(s.week.totalTokens)} · ${fmtCost(s.week.costUsd)}",
        )
        views.setImageViewBitmap(R.id.widget_chart, drawChart(s.days))
        views.setOnClickPendingIntent(R.id.widget_chart, openAppIntent(context, WidgetKind.CHART, config))
    }

    private fun renderEmpty(kind: WidgetKind, views: RemoteViews) {
        when (kind) {
            WidgetKind.QUICK, WidgetKind.TOKENS, WidgetKind.COST -> {
                views.setTextViewText(R.id.widget_big_value, "—")
                views.setTextViewText(R.id.widget_big_caption, "no data yet")
            }
            WidgetKind.CHART -> Unit
            else -> {
                views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
                views.setTextViewText(R.id.widget_empty, "No data yet — open the app once")
            }
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private fun bindRows(
        views: RemoteViews,
        count: Int,
        maxRows: Int,
        emptyMessage: String,
        bind: (index: Int, ids: IntArray) -> Unit,
    ) {
        val visible = count.coerceAtMost(maxRows.coerceAtMost(ROW_IDS.size))
        if (visible == 0) {
            views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
            views.setTextViewText(R.id.widget_empty, emptyMessage)
        } else {
            views.setViewVisibility(R.id.widget_empty, View.GONE)
        }
        ROW_IDS.forEachIndexed { i, ids ->
            if (i < visible) {
                views.setViewVisibility(ids[0], View.VISIBLE)
                views.setViewVisibility(ids[4], View.GONE)
                views.setViewVisibility(ids[5], View.GONE)
                views.setViewVisibility(ids[6], View.GONE)
                views.setViewVisibility(ids[7], View.GONE)
                bind(i, ids)
            } else {
                views.setViewVisibility(ids[0], View.GONE)
            }
        }
    }

    private fun setSub(views: RemoteViews, slot: Int, value: String, label: String, compact: Boolean) {
        val (valueId, labelId) = when (slot) {
            1 -> R.id.widget_sub1_value to R.id.widget_sub1_label
            2 -> R.id.widget_sub2_value to R.id.widget_sub2_label
            else -> R.id.widget_sub3_value to R.id.widget_sub3_label
        }
        views.setViewVisibility(valueId, if (compact) View.GONE else View.VISIBLE)
        views.setViewVisibility(labelId, if (compact) View.GONE else View.VISIBLE)
        views.setTextViewText(valueId, value)
        views.setTextViewText(labelId, label)
    }

    private fun drawChart(days: List<WDay>): Bitmap {
        val width = 640
        val height = 280
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val barPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFCC785C.toInt() }
        val faintPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x33FFFFFF }
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xFF8A8494.toInt()
            textSize = 22f
            textAlign = Paint.Align.CENTER
        }

        val labelSpace = 34f
        val chartHeight = height - labelSpace
        canvas.drawLine(0f, chartHeight, width.toFloat(), chartHeight, faintPaint)

        if (days.isEmpty()) {
            textPaint.textSize = 26f
            canvas.drawText("No activity yet", width / 2f, chartHeight / 2f, textPaint)
            return bitmap
        }

        val max = days.maxOf { it.tokens }.coerceAtLeast(1)
        val slot = width.toFloat() / days.size
        val barWidth = slot * 0.55f
        days.forEachIndexed { i, day ->
            val barHeight = (day.tokens.toFloat() / max) * (chartHeight - 30f)
            val left = i * slot + (slot - barWidth) / 2f
            canvas.drawRoundRect(
                RectF(left, chartHeight - barHeight, left + barWidth, chartHeight),
                10f, 10f, barPaint,
            )
            canvas.drawText(dayLabel(day.label), i * slot + slot / 2f, height - 8f, textPaint)
        }
        return bitmap
    }

    /** "2026-08-10" → "Su"; hourly labels pass through shortened. */
    private fun dayLabel(raw: String): String = runCatching {
        val date = SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(raw)
        SimpleDateFormat("EE", Locale.getDefault()).format(date!!).take(2)
    }.getOrDefault(raw.takeLast(2))

    private fun fmtTokens(value: Long): String = when {
        value >= 1_000_000_000 -> "%.1fB".format(value / 1_000_000_000.0)
        value >= 1_000_000 -> "%.1fM".format(value / 1_000_000.0)
        value >= 1_000 -> "%.1fk".format(value / 1_000.0)
        else -> value.toString()
    }

    private fun fmtCost(value: Double): String =
        if (value >= 100) "$%.0f".format(value) else "$%.2f".format(value)

    // ── PendingIntents ─────────────────────────────────────────────────────

    private fun refreshIntent(context: Context, kind: WidgetKind): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            9000 + kind.ordinal,
            Intent(context, kind.providerClass()).apply { action = ACTION_WIDGET_REFRESH },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    /** Analytics widgets deep-link into the analytics screen with their range. */
    private fun openAppIntent(context: Context, kind: WidgetKind, config: WidgetConfig): PendingIntent {
        val uri = when (kind) {
            WidgetKind.TOKENS, WidgetKind.COST ->
                "claudewebui://analytics?range=${config.period}"
            WidgetKind.PROVIDERS, WidgetKind.MODELS, WidgetKind.LIMITS,
            WidgetKind.CHART, WidgetKind.TOP_SESSIONS ->
                "claudewebui://analytics?range=7d"
            else -> null
        }
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
            if (uri != null) {
                action = Intent.ACTION_VIEW
                data = Uri.parse(uri)
            }
        }
        return PendingIntent.getActivity(
            context,
            9100 + kind.ordinal,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun sessionIntent(context: Context, sessionId: String, row: Int): PendingIntent =
        PendingIntent.getActivity(
            context,
            // The session id lives in the intent data, so identity is already
            // unique per session; the row only keeps concurrent rows apart.
            9200 + row,
            Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = Uri.parse("claudewebui://session/$sessionId")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    /**
     * Extras are NOT part of PendingIntent identity — two rows whose intents
     * differ only by their extras are `filterEquals`, so a requestCode clash
     * would let FLAG_UPDATE_CURRENT rewrite one row's target and approve the
     * wrong request. The requestId therefore goes into the intent data too,
     * which does count towards identity.
     */
    private fun approvalIntent(
        context: Context,
        action: String,
        approval: WApproval,
        row: Int,
    ): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            9600 + row * 2 + if (action == ACTION_WIDGET_APPROVE) 0 else 1,
            Intent(context, WidgetActionReceiver::class.java).apply {
                this.action = action
                data = Uri.parse("plum://approval/${Uri.encode(approval.requestId)}")
                putExtra(EXTRA_WIDGET_SESSION_ID, approval.sessionId)
                putExtra(EXTRA_WIDGET_REQUEST_ID, approval.requestId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
}
