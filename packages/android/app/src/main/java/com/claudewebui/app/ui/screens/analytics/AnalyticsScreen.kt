package com.claudewebui.app.ui.screens.analytics

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Analytics
import androidx.compose.material.icons.filled.AttachMoney
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.FormatListNumbered
import androidx.compose.material.icons.filled.Hub
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Token
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.ui.components.analytics.ActivityHeatmap
import com.claudewebui.app.ui.components.analytics.BarItem
import com.claudewebui.app.ui.components.analytics.DonutChart
import com.claudewebui.app.ui.components.analytics.HorizontalBarChart
import com.claudewebui.app.ui.components.analytics.LineChart
import com.claudewebui.app.ui.components.analytics.MiniBarIndicator
import com.claudewebui.app.ui.components.analytics.PointItem
import com.claudewebui.app.ui.components.analytics.SliceItem
import com.claudewebui.app.ui.components.analytics.VerticalBarChart
import org.koin.compose.viewmodel.koinViewModel
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnalyticsScreen(
    viewModel: AnalyticsViewModel = koinViewModel()
) {
    val state by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(state.error) {
        state.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Analytics",
                        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)
                    )
                },
                actions = {
                    IconButton(onClick = { viewModel.refreshData() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->

        if (state.isLoading && state.summary.totalSessions == 0) {
            Box(
                modifier = Modifier.fillMaxSize().padding(paddingValues),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            }
            return@Scaffold
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(paddingValues),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // ── Time range selector ──────────────────────────────────────
            item {
                TimeRangeSelector(
                    selected = state.timeRange,
                    onSelect = viewModel::selectTimeRange,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            // ── Summary cards ────────────────────────────────────────────
            item {
                SummaryCardsRow(summary = state.summary)
            }

            // ── Provider usage chart ─────────────────────────────────────
            if (state.providerUsage.isNotEmpty()) {
                item {
                    SectionCard(title = "Provider Usage", icon = Icons.Default.Hub) {
                        val maxSessions = state.providerUsage.maxOf { it.sessionCount }.toFloat()
                        HorizontalBarChart(
                            items = state.providerUsage.map { p ->
                                BarItem(
                                    label = p.name,
                                    value = p.sessionCount.toFloat(),
                                    color = Color(p.color),
                                    maxValue = maxSessions
                                )
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 8.dp),
                            barHeight = 22.dp,
                            labelWidth = 70.dp
                        )
                    }
                }
            }

            // ── Activity heatmap ─────────────────────────────────────────
            if (state.activityDays.isNotEmpty()) {
                item {
                    SectionCard(title = "Weekly Activity", icon = Icons.Default.Analytics) {
                        ActivityHeatmap(
                            days = state.activityDays,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 8.dp),
                            baseColor = MaterialTheme.colorScheme.primary
                        )
                    }
                }
            }

            // ── Session duration chart ───────────────────────────────────
            if (state.durationTrend.isNotEmpty()) {
                item {
                    SectionCard(title = "Avg Session Duration (min)", icon = Icons.Default.Chat) {
                        VerticalBarChart(
                            points = state.durationTrend,
                            barColor = Color(0xFFCC785C),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(140.dp)
                                .padding(top = 8.dp)
                        )
                    }
                }
            }

            // ── Cost trend ───────────────────────────────────────────────
            if (state.costTrend.isNotEmpty()) {
                item {
                    SectionCard(title = "Cost Trend (USD)", icon = Icons.Default.AttachMoney) {
                        LineChart(
                            points = state.costTrend.map { c ->
                                PointItem(c.label, c.costUsd.toFloat())
                            },
                            lineColor = Color(0xFF22C55E),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(150.dp)
                                .padding(top = 8.dp)
                        )
                    }
                }
            }

            // ── Model usage donut ────────────────────────────────────────
            if (state.modelUsage.isNotEmpty()) {
                item {
                    SectionCard(title = "Model Usage", icon = Icons.Default.Token) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(16.dp)
                        ) {
                            val topModel = state.modelUsage.maxByOrNull { it.usageCount }
                            DonutChart(
                                items = state.modelUsage.map { m ->
                                    SliceItem(m.modelName, m.usageCount.toFloat(), Color(m.color))
                                },
                                centerText = topModel?.let { "${it.percentage.toInt()}%" } ?: "",
                                centerSubtext = topModel?.modelName?.substringBefore("-")?.take(6) ?: "",
                                modifier = Modifier.size(130.dp),
                                strokeWidth = 22.dp
                            )
                            Column(
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                state.modelUsage.take(4).forEach { m ->
                                    ModelLegendRow(item = m)
                                }
                            }
                        }
                    }
                }
            }

            // ── Top tools ────────────────────────────────────────────────
            if (state.toolUsage.isNotEmpty()) {
                item {
                    SectionCard(title = "Top Tools Used", icon = Icons.Default.FormatListNumbered) {
                        Column(
                            modifier = Modifier.padding(top = 4.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            val maxCount = state.toolUsage.maxOf { it.usageCount }.toFloat()
                            state.toolUsage.take(8).forEachIndexed { idx, tool ->
                                ToolRow(
                                    rank = idx + 1,
                                    item = tool,
                                    maxCount = maxCount
                                )
                            }
                        }
                    }
                }
            }

            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

// ── Sub-components ────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TimeRangeSelector(
    selected: AnalyticsTimeRange,
    onSelect: (AnalyticsTimeRange) -> Unit,
    modifier: Modifier = Modifier
) {
    SingleChoiceSegmentedButtonRow(modifier = modifier) {
        AnalyticsTimeRange.entries.forEachIndexed { idx, range ->
            SegmentedButton(
                selected = selected == range,
                onClick = { onSelect(range) },
                shape = SegmentedButtonDefaults.itemShape(
                    index = idx,
                    count = AnalyticsTimeRange.entries.size
                ),
                label = {
                    Text(
                        range.label,
                        style = MaterialTheme.typography.labelMedium
                    )
                }
            )
        }
    }
}

@Composable
private fun SummaryCardsRow(summary: AnalyticsSummary) {
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(horizontal = 0.dp)
    ) {
        item {
            SummaryCard(
                icon = Icons.Default.Chat,
                label = "Sessions",
                value = summary.totalSessions.toString(),
                color = Color(0xFF2B75E2)
            )
        }
        item {
            SummaryCard(
                icon = Icons.Default.Analytics,
                label = "Messages",
                value = formatCompact(summary.totalMessages.toLong()),
                color = Color(0xFFCC785C)
            )
        }
        item {
            SummaryCard(
                icon = Icons.Default.Token,
                label = "Tokens",
                value = formatCompact(summary.totalTokens),
                color = Color(0xFFC377FF)
            )
        }
        item {
            SummaryCard(
                icon = Icons.Default.AttachMoney,
                label = "Est. Cost",
                value = "$${String.format(Locale.US, "%.2f", summary.totalCostUsd)}",
                color = Color(0xFF22C55E)
            )
        }
    }
}

@Composable
private fun SummaryCard(
    icon: ImageVector,
    label: String,
    value: String,
    color: Color
) {
    // Animate the value counter
    val animProgress = remember { Animatable(0f) }
    LaunchedEffect(value) {
        animProgress.snapTo(0f)
        animProgress.animateTo(1f, tween(600, easing = FastOutSlowInEasing))
    }

    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainer
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier
                .width(120.dp)
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(color.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(18.dp))
            }
            AnimatedContent(
                targetState = value,
                transitionSpec = { fadeIn(tween(300)) togetherWith fadeOut(tween(200)) },
                label = "stat_value"
            ) { v ->
                Text(
                    text = v,
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    color = MaterialTheme.colorScheme.onSurface
                )
            }
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun SectionCard(
    title: String,
    icon: ImageVector,
    content: @Composable () -> Unit
) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainer
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp)
                )
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold)
                )
            }
            content()
        }
    }
}

@Composable
private fun ModelLegendRow(item: ModelUsageItem) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Box(
            modifier = Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(Color(item.color))
        )
        Text(
            text = item.modelName.let { n ->
                if (n.length > 18) n.take(15) + "…" else n
            },
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f)
        )
        Text(
            text = "${item.percentage.toInt()}%",
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
            color = Color(item.color)
        )
    }
}

@Composable
private fun ToolRow(
    rank: Int,
    item: ToolUsageItem,
    maxCount: Float
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Text(
            text = "$rank",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(16.dp)
        )
        Text(
            text = item.toolName,
            style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
            modifier = Modifier.width(80.dp)
        )
        MiniBarIndicator(
            value = item.usageCount.toFloat(),
            maxValue = maxCount,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.weight(1f),
            height = 6.dp
        )
        Text(
            text = item.usageCount.toString(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(32.dp)
        )
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

private fun formatCompact(value: Long): String = when {
    value >= 1_000_000L -> "${value / 1_000_000}M"
    value >= 1_000L     -> "${value / 1_000}k"
    else                -> value.toString()
}
