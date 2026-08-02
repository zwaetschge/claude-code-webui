package com.claudewebui.app.ui.screens.analytics

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachMoney
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.FilterAlt
import androidx.compose.material.icons.outlined.Hub
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material.icons.outlined.Token
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumBlue
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumBottomBar
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.Sparkline
import org.koin.compose.viewmodel.koinViewModel
import java.util.Locale
import kotlin.math.roundToInt

@Composable
fun AnalyticsScreen(
    onNavigateMain: (MainDestination) -> Unit = {},
    viewModel: AnalyticsViewModel = koinViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val pricedPercent = if (state.modelUsage.isEmpty()) 0 else 100

    PlumBackdrop {
        Scaffold(
            containerColor = Color.Transparent,
            bottomBar = {
                PlumBottomBar(selected = MainDestination.ANALYTICS, onNavigate = onNavigateMain)
            },
        ) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    PlumScreenHeader(
                        title = "Analytics",
                        subtitle = "Usage, cost and model performance",
                        live = true,
                        actions = {
                            PlumIconButton(Icons.Outlined.FilterAlt, "Filter", {})
                            PlumIconButton(Icons.Outlined.Refresh, "Refresh", viewModel::refreshData)
                        },
                    )
                }
                item {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(18.dp))
                            .background(Color(0xB517191B))
                            .border(1.dp, PlumBorder, RoundedCornerShape(18.dp))
                            .padding(4.dp),
                    ) {
                        AnalyticsTimeRange.entries.forEach { range ->
                            Box(
                                Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(
                                        if (state.timeRange == range) {
                                            Brush.horizontalGradient(listOf(Color(0xFFB05CF2), Color(0xFF854CE6)))
                                        } else Brush.horizontalGradient(listOf(Color.Transparent, Color.Transparent)),
                                    )
                                    .clickable { viewModel.selectTimeRange(range) }
                                    .padding(vertical = 10.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(range.label, color = if (state.timeRange == range) Color.White else PlumMuted, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                        AnalyticsMetric("Tokens", compactNumber(state.summary.totalTokens), Icons.Outlined.Tag, PlumAccent, Modifier.weight(1f))
                        AnalyticsMetric("Requests", state.summary.totalMessages.toString(), Icons.Outlined.Token, PlumBlue, Modifier.weight(1f))
                        AnalyticsMetric("Cost", "$${String.format(Locale.US, "%.2f", state.summary.totalCostUsd)}", Icons.Outlined.AttachMoney, PlumGreen, Modifier.weight(1f))
                        AnalyticsMetric("Cache", "—", Icons.Outlined.Bolt, PlumAmber, Modifier.weight(1f))
                        AnalyticsMetric("Active", state.summary.activeSessions.toString(), Icons.Outlined.Hub, PlumBlue, Modifier.weight(1f))
                    }
                }
                item {
                    GlassPanel(Modifier.fillMaxWidth(), radius = 20.dp) {
                        Column(Modifier.padding(16.dp)) {
                            Text("Usage Trend", color = PlumText, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(10.dp).background(PlumAccent, RoundedCornerShape(2.dp)))
                                Text("  Tokens", color = PlumMuted, fontSize = 12.sp)
                                Spacer(Modifier.width(18.dp))
                                Box(Modifier.width(18.dp).height(2.dp).background(PlumGreen))
                                Text("  Cost", color = PlumMuted, fontSize = 12.sp)
                            }
                            UsageTrendChart(state.costTrend, Modifier.fillMaxWidth().height(205.dp).padding(top = 12.dp))
                        }
                    }
                }
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        GlassPanel(Modifier.weight(1f).height(206.dp), radius = 20.dp) {
                            Column(Modifier.fillMaxSize().padding(14.dp)) {
                                Text("Provider Mix", color = PlumText, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                                Row(Modifier.fillMaxSize().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    ProviderDonut(state.providerUsage, Modifier.size(64.dp))
                                    Column(Modifier.weight(1f).padding(start = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        val total = state.providerUsage.sumOf { it.tokenCount }.coerceAtLeast(1L)
                                        state.providerUsage.take(4).forEach { provider ->
                                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                                Box(Modifier.size(7.dp).background(Color(provider.color), CircleShape))
                                                Text(
                                                    "  ${provider.name.take(9)}",
                                                    color = PlumMuted,
                                                    fontSize = 9.sp,
                                                    modifier = Modifier.weight(1f),
                                                    maxLines = 1,
                                                )
                                                Text("${(provider.tokenCount * 100 / total)}%", color = PlumText, fontSize = 9.sp)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        GlassPanel(Modifier.weight(1f).height(206.dp), radius = 20.dp) {
                            Column(Modifier.fillMaxSize().padding(14.dp)) {
                                Text("Model Breakdown", color = PlumText, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                                Column(Modifier.padding(top = 15.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
                                    state.modelUsage.take(4).forEach { model ->
                                        ModelBar(model)
                                    }
                                    if (state.modelUsage.isEmpty()) {
                                        Text("No model data yet", color = PlumMuted, fontSize = 12.sp)
                                    }
                                }
                            }
                        }
                    }
                }
                item {
                    GlassPanel(Modifier.fillMaxWidth(), radius = 20.dp) {
                        Column(Modifier.padding(16.dp)) {
                            Text("Pricing Health", color = PlumText, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                            Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.SpaceAround) {
                                HealthValue("Priced Models", "$pricedPercent%", if (pricedPercent == 100) "Good" else "Review", PlumGreen)
                                Box(Modifier.width(1.dp).height(52.dp).background(PlumBorder))
                                HealthValue("Unpriced Events", if (pricedPercent == 100) "0%" else "—", "Review", PlumAmber)
                                Box(Modifier.width(1.dp).height(52.dp).background(PlumBorder))
                                HealthValue("Budget Health", "Good", "On track", PlumGreen)
                            }
                        }
                    }
                }
                item {
                    GlassPanel(Modifier.fillMaxWidth(), radius = 20.dp) {
                        Column(Modifier.padding(16.dp)) {
                            Text("Provider Limits", color = PlumText, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                            Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                state.providerUsage.take(4).forEach { provider ->
                                    val max = state.providerUsage.maxOfOrNull { it.tokenCount }?.coerceAtLeast(1L) ?: 1L
                                    ProviderLimitRow(provider.name, provider.tokenCount.toFloat() / max, Color(provider.color))
                                }
                            }
                        }
                    }
                }
                item { Spacer(Modifier.height(8.dp)) }
            }
        }
    }
}

@Composable
private fun AnalyticsMetric(label: String, value: String, icon: ImageVector, color: Color, modifier: Modifier) {
    GlassPanel(modifier.height(112.dp), radius = 15.dp) {
        Column(Modifier.fillMaxSize().padding(9.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Box(Modifier.size(29.dp).background(color.copy(alpha = .15f), CircleShape), contentAlignment = Alignment.Center) {
                Icon(icon, null, tint = color, modifier = Modifier.size(17.dp))
            }
            Text(value, color = color, fontSize = 18.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            Text(label, color = PlumMuted, fontSize = 9.sp, maxLines = 1)
            Sparkline(color, listOf(1f, 2f, 1.5f, 3f, 2f, 4f), Modifier.fillMaxWidth().height(10.dp))
        }
    }
}

@Composable
private fun UsageTrendChart(points: List<CostPoint>, modifier: Modifier) {
    val values = if (points.isEmpty()) listOf(2f, 3f, 4.5f, 4f, 3f, 2.5f, 4.2f) else points.map { it.tokenCount.toFloat() }
    Canvas(modifier) {
        repeat(4) { index ->
            val y = size.height * index / 3f
            drawLine(Color.White.copy(alpha = .09f), Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
        }
        val max = values.maxOrNull()?.coerceAtLeast(1f) ?: 1f
        val step = size.width / values.size
        values.forEachIndexed { index, value ->
            val barHeight = (value / max) * size.height * .82f
            drawRoundRect(
                brush = Brush.verticalGradient(listOf(Color(0xFFB55FF5), Color(0xFF6935BC))),
                topLeft = Offset(index * step + step * .2f, size.height - barHeight),
                size = androidx.compose.ui.geometry.Size(step * .36f, barHeight),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(5.dp.toPx()),
            )
        }
        val costValues = if (points.isEmpty()) listOf(2f, 3.2f, 5f, 4.4f, 3.3f, 2.6f, 4.5f) else points.map { it.costUsd.toFloat() }
        val costMax = costValues.maxOrNull()?.coerceAtLeast(.1f) ?: 1f
        val path = Path()
        costValues.forEachIndexed { index, value ->
            val point = Offset(index * step + step * .38f, size.height - (value / costMax) * size.height * .85f)
            if (index == 0) path.moveTo(point.x, point.y) else path.lineTo(point.x, point.y)
        }
        drawPath(path, PlumGreen, style = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round))
    }
}

@Composable
private fun ProviderDonut(items: List<ProviderUsageItem>, modifier: Modifier) {
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val total = items.sumOf { it.tokenCount }.toFloat().coerceAtLeast(1f)
            var start = -90f
            if (items.isEmpty()) {
                drawArc(PlumBorder, 0f, 360f, false, style = Stroke(11.dp.toPx()))
            } else {
                items.forEach { item ->
                    val sweep = item.tokenCount / total * 360f
                    drawArc(Color(item.color), start, sweep, false, style = Stroke(11.dp.toPx()))
                    start += sweep
                }
            }
        }
        Text("100%", color = PlumText, fontSize = 16.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun ModelBar(model: ModelUsageItem) {
    Column {
        Row {
            Text(model.modelName, color = PlumText, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Text("${model.percentage.roundToInt()}%", color = PlumText, fontSize = 10.sp)
        }
        Box(Modifier.fillMaxWidth().padding(top = 5.dp).height(8.dp).background(Color(0xFF292B2E), RoundedCornerShape(5.dp))) {
            Box(Modifier.fillMaxWidth((model.percentage / 100f).coerceIn(0f, 1f)).height(8.dp).background(Color(model.color), RoundedCornerShape(5.dp)))
        }
    }
}

@Composable
private fun HealthValue(label: String, value: String, status: String, color: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(label, color = PlumMuted, fontSize = 10.sp)
        Text(value, color = PlumText, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Text(status, color = color, fontSize = 11.sp)
    }
}

@Composable
private fun ProviderLimitRow(name: String, progress: Float, color: Color) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).background(Color(0xFF1B1E21)).border(1.dp, PlumBorder, RoundedCornerShape(11.dp)).padding(9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(10.dp).background(color, CircleShape))
        Text("  $name", color = PlumText, fontSize = 12.sp, modifier = Modifier.width(80.dp))
        Box(Modifier.weight(1f).height(7.dp).background(Color(0xFF303235), RoundedCornerShape(5.dp))) {
            Box(Modifier.fillMaxWidth(progress.coerceIn(0f, 1f)).height(7.dp).background(color, RoundedCornerShape(5.dp)))
        }
        Text("  ${(progress * 100).roundToInt()}%", color = PlumText, fontSize = 11.sp)
    }
}

private fun compactNumber(value: Long): String = when {
    value >= 1_000_000 -> String.format(Locale.US, "%.1fM", value / 1_000_000.0)
    value >= 1_000 -> String.format(Locale.US, "%.1fk", value / 1_000.0)
    else -> value.toString()
}
