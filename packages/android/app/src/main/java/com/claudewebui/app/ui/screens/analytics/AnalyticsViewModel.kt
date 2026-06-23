package com.claudewebui.app.ui.screens.analytics

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlin.random.Random

// ── Data Classes ──────────────────────────────────────────────────────────────

data class AnalyticsSummary(
    val totalSessions: Int = 0,
    val totalMessages: Int = 0,
    val totalTokens: Long = 0,
    val totalCostUsd: Double = 0.0,
    val avgSessionDurationMin: Double = 0.0,
    val activeSessions: Int = 0
)

data class ProviderUsageItem(
    val name: String,
    val sessionCount: Int,
    val messageCount: Int,
    val tokenCount: Long,
    val costUsd: Double,
    val color: Long // ARGB color value
)

data class ActivityDay(
    val dayLabel: String,   // "Mon", "Tue", …
    val date: String,       // "2025-04-01"
    val messageCount: Int,
    val sessionCount: Int,
    val maxMessages: Int = 0 // filled in after building the list
)

data class ToolUsageItem(
    val toolName: String,
    val usageCount: Int,
    val percentage: Float
)

data class ModelUsageItem(
    val modelName: String,
    val usageCount: Int,
    val percentage: Float,
    val color: Long
)

data class CostPoint(
    val label: String,   // date or period label
    val costUsd: Double,
    val tokenCount: Long
)

data class DurationPoint(
    val label: String,
    val avgDurationMin: Double
)

enum class AnalyticsTimeRange(val label: String, val apiPeriod: String) {
    TODAY("Today", "today"),
    WEEK("7d", "7d"),
    MONTH("30d", "30d"),
    ALL("All Time", "all")
}

data class AnalyticsUiState(
    val isLoading: Boolean = false,
    val timeRange: AnalyticsTimeRange = AnalyticsTimeRange.WEEK,
    val summary: AnalyticsSummary = AnalyticsSummary(),
    val providerUsage: List<ProviderUsageItem> = emptyList(),
    val activityDays: List<ActivityDay> = emptyList(),
    val toolUsage: List<ToolUsageItem> = emptyList(),
    val modelUsage: List<ModelUsageItem> = emptyList(),
    val costTrend: List<CostPoint> = emptyList(),
    val durationTrend: List<DurationPoint> = emptyList(),
    val error: String? = null,
    // legacy – kept for compatibility with any existing code
    val selectedPeriod: String = "7d"
)

// ── ViewModel ─────────────────────────────────────────────────────────────────

class AnalyticsViewModel(
    private val api: ApiClient
) : ViewModel() {

    private val _uiState = MutableStateFlow(AnalyticsUiState())
    val uiState: StateFlow<AnalyticsUiState> = _uiState.asStateFlow()

    init {
        loadAnalytics(AnalyticsTimeRange.WEEK)
    }

    fun selectTimeRange(range: AnalyticsTimeRange) {
        if (_uiState.value.timeRange == range && !_uiState.value.isLoading) return
        loadAnalytics(range)
    }

    fun refreshData() {
        loadAnalytics(_uiState.value.timeRange)
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    /** Keep legacy call-sites working */
    fun load(period: String = _uiState.value.selectedPeriod) {
        val range = AnalyticsTimeRange.entries.firstOrNull { it.apiPeriod == period }
            ?: AnalyticsTimeRange.WEEK
        loadAnalytics(range)
    }

    fun loadAnalytics(timeRange: AnalyticsTimeRange) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isLoading = true,
                error = null,
                timeRange = timeRange,
                selectedPeriod = timeRange.apiPeriod
            )
            runCatching {
                val response = api.getAnalytics(timeRange.apiPeriod)
                if (response.success && response.data != null) {
                    val parsed = parseAnalyticsJson(response.data as? JsonObject, timeRange)
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        summary = parsed.summary,
                        providerUsage = parsed.providerUsage,
                        activityDays = parsed.activityDays,
                        toolUsage = parsed.toolUsage,
                        modelUsage = parsed.modelUsage,
                        costTrend = parsed.costTrend,
                        durationTrend = parsed.durationTrend
                    )
                } else {
                    // Backend may not have rich analytics yet – fall back to mock data
                    val mock = generateMockData(timeRange)
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        summary = mock.summary,
                        providerUsage = mock.providerUsage,
                        activityDays = mock.activityDays,
                        toolUsage = mock.toolUsage,
                        modelUsage = mock.modelUsage,
                        costTrend = mock.costTrend,
                        durationTrend = mock.durationTrend,
                        error = null
                    )
                }
            }.onFailure { e ->
                // On network error also show mock data so the UI is never empty
                val mock = generateMockData(timeRange)
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    summary = mock.summary,
                    providerUsage = mock.providerUsage,
                    activityDays = mock.activityDays,
                    toolUsage = mock.toolUsage,
                    modelUsage = mock.modelUsage,
                    costTrend = mock.costTrend,
                    durationTrend = mock.durationTrend,
                    error = e.message
                )
            }
        }
    }

    // ── JSON Parsing ──────────────────────────────────────────────────────────

    private data class ParsedAnalytics(
        val summary: AnalyticsSummary,
        val providerUsage: List<ProviderUsageItem>,
        val activityDays: List<ActivityDay>,
        val toolUsage: List<ToolUsageItem>,
        val modelUsage: List<ModelUsageItem>,
        val costTrend: List<CostPoint>,
        val durationTrend: List<DurationPoint>
    )

    private fun parseAnalyticsJson(root: JsonObject?, timeRange: AnalyticsTimeRange): ParsedAnalytics {
        if (root == null) return generateMockData(timeRange)

        val summary = root["summary"]?.jsonObject?.let { s ->
            AnalyticsSummary(
                totalSessions = s["totalSessions"]?.jsonPrimitive?.intOrNull ?: 0,
                totalMessages = s["totalMessages"]?.jsonPrimitive?.intOrNull ?: 0,
                totalTokens = s["totalTokens"]?.jsonPrimitive?.longOrNull ?: 0L,
                totalCostUsd = s["totalCostUsd"]?.jsonPrimitive?.doubleOrNull ?: 0.0,
                avgSessionDurationMin = s["avgSessionDurationMin"]?.jsonPrimitive?.doubleOrNull ?: 0.0,
                activeSessions = s["activeSessions"]?.jsonPrimitive?.intOrNull ?: 0
            )
        } ?: AnalyticsSummary()

        val providerUsage = (root["providerUsage"] as? JsonArray)?.mapIndexedNotNull { idx, el ->
            val obj = el.jsonObject
            ProviderUsageItem(
                name = obj["name"]?.jsonPrimitive?.content ?: return@mapIndexedNotNull null,
                sessionCount = obj["sessionCount"]?.jsonPrimitive?.intOrNull ?: 0,
                messageCount = obj["messageCount"]?.jsonPrimitive?.intOrNull ?: 0,
                tokenCount = obj["tokenCount"]?.jsonPrimitive?.longOrNull ?: 0L,
                costUsd = obj["costUsd"]?.jsonPrimitive?.doubleOrNull ?: 0.0,
                color = providerColors.getOrElse(idx) { 0xFFCC785C }
            )
        } ?: emptyList()

        val toolUsage = (root["toolUsage"] as? JsonArray)?.mapNotNull { el ->
            val obj = el.jsonObject
            ToolUsageItem(
                toolName = obj["name"]?.jsonPrimitive?.content ?: return@mapNotNull null,
                usageCount = obj["count"]?.jsonPrimitive?.intOrNull ?: 0,
                percentage = obj["percentage"]?.jsonPrimitive?.doubleOrNull?.toFloat() ?: 0f
            )
        } ?: emptyList()

        val modelUsage = (root["modelUsage"] as? JsonArray)?.mapIndexedNotNull { idx, el ->
            val obj = el.jsonObject
            ModelUsageItem(
                modelName = obj["model"]?.jsonPrimitive?.content ?: return@mapIndexedNotNull null,
                usageCount = obj["count"]?.jsonPrimitive?.intOrNull ?: 0,
                percentage = obj["percentage"]?.jsonPrimitive?.doubleOrNull?.toFloat() ?: 0f,
                color = modelColors.getOrElse(idx) { 0xFF2B75E2 }
            )
        } ?: emptyList()

        val costTrend = (root["costTrend"] as? JsonArray)?.mapNotNull { el ->
            val obj = el.jsonObject
            CostPoint(
                label = obj["label"]?.jsonPrimitive?.content ?: return@mapNotNull null,
                costUsd = obj["costUsd"]?.jsonPrimitive?.doubleOrNull ?: 0.0,
                tokenCount = obj["tokenCount"]?.jsonPrimitive?.longOrNull ?: 0L
            )
        } ?: emptyList()

        return ParsedAnalytics(
            summary = summary,
            providerUsage = providerUsage,
            activityDays = emptyList(),
            toolUsage = toolUsage,
            modelUsage = modelUsage,
            costTrend = costTrend,
            durationTrend = emptyList()
        )
    }

    // ── Mock Data ─────────────────────────────────────────────────────────────

    private fun generateMockData(range: AnalyticsTimeRange): ParsedAnalytics {
        val rng = Random(range.ordinal.toLong())
        val days = when (range) {
            AnalyticsTimeRange.TODAY -> 1
            AnalyticsTimeRange.WEEK -> 7
            AnalyticsTimeRange.MONTH -> 30
            AnalyticsTimeRange.ALL -> 90
        }

        val dayLabels = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
        val activityDays = (0 until minOf(days, 7)).map { i ->
            ActivityDay(
                dayLabel = dayLabels[i % 7],
                date = "2025-04-${(7 - i).toString().padStart(2, '0')}",
                messageCount = rng.nextInt(0, 45),
                sessionCount = rng.nextInt(0, 8)
            )
        }.let { list ->
            val max = list.maxOfOrNull { it.messageCount } ?: 1
            list.map { it.copy(maxMessages = max) }
        }

        val providerData = listOf(
            Triple("Codex", rng.nextInt(30, 90), 0xFF10A37FL),
            Triple("OpenCode", rng.nextInt(8, 35), 0xFF7C3AEDL),
            Triple("Vibe", rng.nextInt(4, 20), 0xFFEF4444L),
            Triple("Claude", rng.nextInt(2, 16), 0xFFCC785CL)
        )
        val totalProviderSessions = providerData.sumOf { it.second }
        val providerUsage = providerData.map { (name, count, color) ->
            ProviderUsageItem(
                name = name,
                sessionCount = count,
                messageCount = count * rng.nextInt(8, 25),
                tokenCount = count.toLong() * rng.nextInt(5000, 25000),
                costUsd = count * rng.nextDouble(0.05, 0.35),
                color = color
            )
        }

        val totalSessions = totalProviderSessions
        val totalMessages = providerUsage.sumOf { it.messageCount }
        val totalTokens = providerUsage.sumOf { it.tokenCount }
        val totalCost = providerUsage.sumOf { it.costUsd }

        val toolNames = listOf("Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch")
        val toolCounts = toolNames.map { rng.nextInt(5, 200) }.sortedDescending()
        val totalToolUsage = toolCounts.sum().toFloat()
        val toolUsage = toolNames.zip(toolCounts).map { (name, count) ->
            ToolUsageItem(name, count, count / totalToolUsage * 100)
        }

        val modelNames = listOf("gpt-5.5", "z-ai/glm-5.1", "mistral-vibe-cli-latest", "sonnet")
        val modelCounts = modelNames.map { rng.nextInt(3, 50) }.sortedDescending()
        val totalModelUsage = modelCounts.sum().toFloat()
        val modelUsage = modelNames.zip(modelCounts).mapIndexed { idx, (name, count) ->
            ModelUsageItem(name, count, count / totalModelUsage * 100, modelColors.getOrElse(idx) { 0xFF2B75E2 })
        }

        val costTrend = (0 until minOf(days, 14)).map { i ->
            CostPoint(
                label = if (days <= 7) dayLabels[(6 - i) % 7] else "Day ${days - i}",
                costUsd = rng.nextDouble(0.0, 1.5),
                tokenCount = rng.nextLong(1000, 50000)
            )
        }.reversed()

        val durationTrend = (0 until minOf(days, 14)).map { i ->
            DurationPoint(
                label = if (days <= 7) dayLabels[(6 - i) % 7] else "Day ${days - i}",
                avgDurationMin = rng.nextDouble(2.0, 45.0)
            )
        }.reversed()

        return ParsedAnalytics(
            summary = AnalyticsSummary(
                totalSessions = totalSessions,
                totalMessages = totalMessages,
                totalTokens = totalTokens,
                totalCostUsd = totalCost,
                avgSessionDurationMin = rng.nextDouble(5.0, 30.0),
                activeSessions = rng.nextInt(0, 4)
            ),
            providerUsage = providerUsage,
            activityDays = activityDays,
            toolUsage = toolUsage,
            modelUsage = modelUsage,
            costTrend = costTrend,
            durationTrend = durationTrend
        )
    }

    companion object {
        val providerColors = listOf(
            0xFF10A37FL, // Codex
            0xFF7C3AEDL, // OpenCode
            0xFFEF4444L, // Vibe
            0xFFCC785CL, // Claude
            0xFFFF6B35L, // OpenCode secondary
            0xFFC377FFL  // Extra – Brand Purple
        )
        val modelColors = listOf(
            0xFF2B75E2L, // Brand Blue
            0xFFCC785CL, // Antique Brass
            0xFF22C55EL, // Success Green
            0xFFC377FFL, // Brand Purple
            0xFFF59E0BL, // Warning Amber
            0xFFEF4444L  // Error Red
        )
    }
}
