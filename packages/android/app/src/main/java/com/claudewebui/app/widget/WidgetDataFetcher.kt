package com.claudewebui.app.widget

import android.content.Context
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.data.model.SessionStatus
import com.claudewebui.app.data.model.UsageLimitProvider
import com.claudewebui.app.ui.screens.analytics.AnalyticsParser
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import java.util.TimeZone

/**
 * Pulls one [WidgetSnapshot] over REST. Every section is fetched
 * independently and tolerated on failure — a dead analytics query must not
 * blank the sessions widget, and vice versa. Failed sections fall back to the
 * previously cached values.
 */
object WidgetDataFetcher {

    // Widgets run outside Koin's UI graph; one lazily built client is enough.
    private val api by lazy { ApiClient() }

    fun isSignedIn(): Boolean =
        runCatching { TokenStore.getToken() != null && TokenStore.getServerUrl() != null }
            .getOrDefault(false)

    /** Fetch a fresh snapshot; null when signed out or everything failed. */
    suspend fun fetch(context: Context): WidgetSnapshot? {
        if (!isSignedIn()) return null
        val previous = WidgetStore.load(context) ?: WidgetSnapshot()
        val tz = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000

        val snapshot = withTimeoutOrNull(25_000) {
            coroutineScope {
                val today = async { runCatching { parsePeriod("24h", tz) }.getOrNull() }
                val weekly = async { runCatching { parseWeek(tz) }.getOrNull() }
                val limits = async { runCatching { fetchLimits() }.getOrNull() }
                val live = async { runCatching { fetchSessionsAndApprovals() }.getOrNull() }

                val weekParsed = weekly.await()
                val liveParsed = live.await()
                WidgetSnapshot(
                    updatedAtMs = System.currentTimeMillis(),
                    today = today.await() ?: previous.today,
                    week = weekParsed?.week ?: previous.week,
                    providers = weekParsed?.providers ?: previous.providers,
                    models = weekParsed?.models ?: previous.models,
                    topSessions = weekParsed?.topSessions ?: previous.topSessions,
                    days = weekParsed?.days ?: previous.days,
                    limits = limits.await() ?: previous.limits,
                    sessions = liveParsed?.first ?: previous.sessions,
                    approvals = liveParsed?.second ?: previous.approvals,
                )
            }
        } ?: return null

        WidgetStore.save(context, snapshot)
        return snapshot
    }

    private suspend fun parsePeriod(period: String, tz: Int): WPeriod {
        val response = api.getAnalyticsSummary(period, tz)
        val root = response.data as? JsonObject ?: error("invalid summary")
        val parsed = AnalyticsParser.parse(root, JsonArray(emptyList()))
        return parsed.summary.let {
            WPeriod(
                inputTokens = it.inputTokens,
                outputTokens = it.outputTokens,
                cacheReadTokens = it.cacheReadTokens,
                totalTokens = it.totalTokens,
                costUsd = it.totalCostUsd,
                requests = it.totalRequests,
            )
        }
    }

    private data class WeekParsed(
        val week: WPeriod,
        val providers: List<WEntry>,
        val models: List<WEntry>,
        val topSessions: List<WEntry>,
        val days: List<WDay>,
    )

    private suspend fun parseWeek(tz: Int): WeekParsed = coroutineScope {
        val summaryReq = async { api.getAnalyticsSummary("7d", tz) }
        val timelineReq = async { api.getAnalyticsTimeline("7d", tz) }
        val summaryRoot = summaryReq.await().data as? JsonObject ?: error("invalid summary")
        val timelineRoot = timelineReq.await().data as? JsonArray ?: JsonArray(emptyList())
        val parsed = AnalyticsParser.parse(summaryRoot, timelineRoot)

        WeekParsed(
            week = parsed.summary.let {
                WPeriod(
                    inputTokens = it.inputTokens,
                    outputTokens = it.outputTokens,
                    cacheReadTokens = it.cacheReadTokens,
                    totalTokens = it.totalTokens,
                    costUsd = it.totalCostUsd,
                    requests = it.totalRequests,
                )
            },
            providers = parsed.providerUsage
                .sortedByDescending { it.tokenCount }
                .take(5)
                .map { WEntry(name = it.name, tokens = it.tokenCount, costUsd = it.costUsd, colorArgb = it.color) },
            models = parsed.modelUsage
                .sortedByDescending { it.costUsd }
                .take(5)
                .map {
                    WEntry(
                        name = it.modelName,
                        sub = it.providerName,
                        tokens = it.tokenCount,
                        costUsd = it.costUsd,
                        colorArgb = it.color,
                    )
                },
            topSessions = parsed.topSessions
                .sortedByDescending { it.costUsd }
                .take(5)
                .map { WEntry(id = it.id, name = it.name, tokens = it.tokenCount, costUsd = it.costUsd) },
            days = parsed.timeline.takeLast(7).map {
                WDay(label = it.label, tokens = it.tokenCount, costUsd = it.costUsd)
            },
        )
    }

    private suspend fun fetchLimits(): List<WLimit> = coroutineScope {
        UsageLimitProvider.entries.map { provider ->
            async {
                val response = runCatching { api.getUsageLimits(provider.id) }.getOrNull()
                val data = response?.takeIf { it.supported }?.data ?: return@async emptyList<WLimit>()
                val color = when (provider) {
                    UsageLimitProvider.CODEX -> 0xFF22C55EL
                    UsageLimitProvider.CLAUDE -> 0xFFF97316L
                    UsageLimitProvider.ZAI -> 0xFF14B8A6L
                    UsageLimitProvider.KIMI -> 0xFF2582EDL
                    UsageLimitProvider.ALIBABA -> 0xFFFF8A3DL
                }
                buildList {
                    data.fiveHour?.let { add(WLimit(provider.label, "5h", it.utilization, color)) }
                    data.sevenDay?.let { add(WLimit(provider.label, "Weekly", it.utilization, color)) }
                    data.sevenDaySonnet?.let { add(WLimit(provider.label, "Weekly Sonnet", it.utilization, color)) }
                }
            }
        }.awaitAll().flatten()
    }

    private suspend fun fetchSessionsAndApprovals(): Pair<List<WSession>, List<WApproval>> =
        coroutineScope {
            val sessions = api.getSessions().data.orEmpty()
            val sorted = sessions.sortedWith(
                compareByDescending<com.claudewebui.app.data.model.Session> {
                    it.status == SessionStatus.RUNNING
                }.thenByDescending { it.updatedAt }
            )
            val wSessions = sorted.take(5).map {
                WSession(
                    id = it.id,
                    name = it.name,
                    provider = it.cliProvider.displayName,
                    status = it.status.name.lowercase(),
                    mode = it.mode.label,
                )
            }
            val approvals = sorted
                .filter { it.status == SessionStatus.RUNNING }
                .take(8)
                .map { session ->
                    async {
                        runCatching { api.getPendingPermissions(session.id).data.orEmpty() }
                            .getOrDefault(emptyList())
                            .map {
                                WApproval(
                                    sessionId = session.id,
                                    sessionName = session.name,
                                    toolName = it.toolName,
                                    requestId = it.requestId,
                                )
                            }
                    }
                }
                .awaitAll()
                .flatten()
                .take(5)
            wSessions to approvals
        }
}
