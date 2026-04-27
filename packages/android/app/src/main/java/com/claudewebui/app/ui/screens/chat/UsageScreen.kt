package com.claudewebui.app.ui.screens.chat

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.UsageData
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UsageScreen(
    sessionId: String,
    usageData: UsageData?,
    usageHistory: List<Pair<Int, Long>>, // (message index, total tokens)
    isLoading: Boolean,
    onNavigateBack: () -> Unit,
    onRefresh: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Token Usage")
                        Text(
                            "Session analytics",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = onRefresh) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                }
            )
        }
    ) { paddingValues ->
        when {
            isLoading -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentAlignment = Alignment.Center
            ) { CircularProgressIndicator() }

            usageData == null -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        Icons.Default.Analytics,
                        contentDescription = null,
                        modifier = Modifier.size(48.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
                    )
                    Text(
                        "No usage data available",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            else -> UsageContent(
                usageData = usageData,
                usageHistory = usageHistory,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
            )
        }
    }
}

@Composable
private fun UsageContent(
    usageData: UsageData,
    usageHistory: List<Pair<Int, Long>>,
    modifier: Modifier = Modifier
) {
    val primaryColor = MaterialTheme.colorScheme.primary
    val secondaryColor = MaterialTheme.colorScheme.secondary
    val tertiaryColor = MaterialTheme.colorScheme.tertiary
    val surfaceVariant = MaterialTheme.colorScheme.surfaceVariant

    Column(
        modifier = modifier.verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Spacer(Modifier.height(0.dp))

        // Context window circular progress
        ContextWindowCard(
            usedPercent = usageData.contextUsedPercent.toFloat(),
            contextWindow = usageData.contextWindow,
            totalTokens = usageData.totalTokens,
            model = usageData.model,
            primaryColor = primaryColor
        )

        // Token breakdown cards
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            TokenStatCard(
                label = "Input",
                value = usageData.inputTokens,
                color = primaryColor,
                icon = Icons.Default.ArrowDownward,
                modifier = Modifier.weight(1f)
            )
            TokenStatCard(
                label = "Output",
                value = usageData.outputTokens,
                color = secondaryColor,
                icon = Icons.Default.ArrowUpward,
                modifier = Modifier.weight(1f)
            )
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            TokenStatCard(
                label = "Cache Read",
                value = usageData.cacheReadTokens,
                color = tertiaryColor,
                icon = Icons.Default.Cached,
                modifier = Modifier.weight(1f)
            )
            TokenStatCard(
                label = "Cache Write",
                value = usageData.cacheCreationTokens,
                color = Color(0xFFF59E0B),
                icon = Icons.Default.Save,
                modifier = Modifier.weight(1f)
            )
        }

        // Cost estimate
        CostCard(
            totalCostUsd = usageData.totalCostUsd,
            modifier = Modifier.padding(horizontal = 16.dp)
        )

        // Token breakdown bar chart
        TokenBreakdownBar(
            inputTokens = usageData.inputTokens,
            outputTokens = usageData.outputTokens,
            cacheReadTokens = usageData.cacheReadTokens,
            cacheCreationTokens = usageData.cacheCreationTokens,
            primaryColor = primaryColor,
            secondaryColor = secondaryColor,
            tertiaryColor = tertiaryColor,
            modifier = Modifier.padding(horizontal = 16.dp)
        )

        // Line chart: token usage over time
        if (usageHistory.size > 1) {
            TokenLineChart(
                dataPoints = usageHistory,
                lineColor = primaryColor,
                gridColor = surfaceVariant,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
            )
        }

        // Model info
        Surface(
            modifier = Modifier.padding(horizontal = 16.dp),
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(14.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.Memory,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Column {
                    Text(
                        "Model",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        usageData.model.ifBlank { "Unknown" },
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }

        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun ContextWindowCard(
    usedPercent: Float,
    contextWindow: Long,
    totalTokens: Long,
    model: String,
    primaryColor: Color
) {
    val animatedProgress by animateFloatAsState(
        targetValue = usedPercent.coerceIn(0f, 1f),
        animationSpec = tween(durationMillis = 1000, easing = FastOutSlowInEasing),
        label = "context_progress"
    )

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                "Context Window",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            Box(
                modifier = Modifier.size(160.dp),
                contentAlignment = Alignment.Center
            ) {
                val trackColor = primaryColor.copy(alpha = 0.1f)
                val errorColor = Color(0xFFF44336)
                val warningColor = Color(0xFFFFA726)
                val arcColor = when {
                    animatedProgress > 0.9f -> errorColor
                    animatedProgress > 0.75f -> warningColor
                    else -> primaryColor
                }

                Canvas(modifier = Modifier.fillMaxSize()) {
                    val strokeWidth = 16.dp.toPx()
                    val radius = (size.minDimension - strokeWidth) / 2f
                    val center = Offset(size.width / 2f, size.height / 2f)
                    val startAngle = 135f
                    val sweepRange = 270f

                    // Track
                    drawArc(
                        color = trackColor,
                        startAngle = startAngle,
                        sweepAngle = sweepRange,
                        useCenter = false,
                        topLeft = Offset(center.x - radius, center.y - radius),
                        size = Size(radius * 2, radius * 2),
                        style = Stroke(width = strokeWidth, cap = StrokeCap.Round)
                    )
                    // Progress
                    drawArc(
                        color = arcColor,
                        startAngle = startAngle,
                        sweepAngle = sweepRange * animatedProgress,
                        useCenter = false,
                        topLeft = Offset(center.x - radius, center.y - radius),
                        size = Size(radius * 2, radius * 2),
                        style = Stroke(width = strokeWidth, cap = StrokeCap.Round)
                    )
                }

                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = "${(animatedProgress * 100).toInt()}%",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        color = when {
                            animatedProgress > 0.9f -> Color(0xFFF44336)
                            animatedProgress > 0.75f -> Color(0xFFFFA726)
                            else -> MaterialTheme.colorScheme.onSurface
                        }
                    )
                    Text(
                        "used",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                ContextStat(label = "Used", value = formatTokens(totalTokens))
                VerticalDivider(modifier = Modifier.height(32.dp))
                ContextStat(label = "Window", value = formatTokens(contextWindow))
                VerticalDivider(modifier = Modifier.height(32.dp))
                ContextStat(
                    label = "Remaining",
                    value = formatTokens((contextWindow - totalTokens).coerceAtLeast(0))
                )
            }
        }
    }
}

@Composable
private fun ContextStat(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold
        )
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun TokenStatCard(
    label: String,
    value: Long,
    color: Color,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        color = color.copy(alpha = 0.08f)
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = color
                )
                Text(
                    label,
                    style = MaterialTheme.typography.labelSmall,
                    color = color
                )
            }
            Text(
                text = formatTokens(value),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                text = "$value tokens",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun CostCard(
    totalCostUsd: Double,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.AttachMoney,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimaryContainer
                )
                Text(
                    "Estimated Cost",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
            Text(
                text = "~\$${String.format("%.4f", totalCostUsd)}",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onPrimaryContainer
            )
        }
    }
}

@Composable
private fun TokenBreakdownBar(
    inputTokens: Long,
    outputTokens: Long,
    cacheReadTokens: Long,
    cacheCreationTokens: Long,
    primaryColor: Color,
    secondaryColor: Color,
    tertiaryColor: Color,
    modifier: Modifier = Modifier
) {
    val total = (inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens).takeIf { it > 0 } ?: 1L
    val segments = listOf(
        Triple(inputTokens.toFloat() / total, primaryColor, "Input"),
        Triple(outputTokens.toFloat() / total, secondaryColor, "Output"),
        Triple(cacheReadTokens.toFloat() / total, tertiaryColor, "Cache R"),
        Triple(cacheCreationTokens.toFloat() / total, Color(0xFFF59E0B), "Cache W")
    ).filter { it.first > 0f }

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(
                "Token Breakdown",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold
            )
            // Stacked bar
            if (segments.isNotEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(12.dp)
                        .background(
                            MaterialTheme.colorScheme.surfaceVariant,
                            RoundedCornerShape(6.dp)
                        )
                ) {
                    Row(modifier = Modifier.fillMaxSize()) {
                        segments.forEachIndexed { index, (fraction, color, _) ->
                            val shape = when {
                                segments.size == 1 -> RoundedCornerShape(6.dp)
                                index == 0 -> RoundedCornerShape(topStart = 6.dp, bottomStart = 6.dp)
                                index == segments.lastIndex -> RoundedCornerShape(topEnd = 6.dp, bottomEnd = 6.dp)
                                else -> RoundedCornerShape(0.dp)
                            }
                            Box(
                                modifier = Modifier
                                    .fillMaxHeight()
                                    .weight(fraction)
                                    .background(color, shape)
                            )
                        }
                    }
                }
                // Legend
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    segments.forEach { (fraction, color, label) ->
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .background(color, RoundedCornerShape(2.dp))
                            )
                            Text(
                                "$label ${(fraction * 100).toInt()}%",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TokenLineChart(
    dataPoints: List<Pair<Int, Long>>,
    lineColor: Color,
    gridColor: Color,
    modifier: Modifier = Modifier
) {
    val animatedProgress by animateFloatAsState(
        targetValue = 1f,
        animationSpec = tween(durationMillis = 800, easing = FastOutSlowInEasing),
        label = "line_chart_progress"
    )

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                "Usage Over Time",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold
            )

            val maxValue = dataPoints.maxOf { it.second }.takeIf { it > 0 } ?: 1L
            val minValue = 0L

            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(120.dp)
            ) {
                val width = size.width
                val height = size.height
                val paddingLeft = 40f
                val paddingRight = 12f
                val paddingTop = 12f
                val paddingBottom = 24f
                val chartWidth = width - paddingLeft - paddingRight
                val chartHeight = height - paddingTop - paddingBottom

                // Grid lines (horizontal)
                val gridLineCount = 4
                for (i in 0..gridLineCount) {
                    val y = paddingTop + chartHeight * (1f - i.toFloat() / gridLineCount)
                    drawLine(
                        color = gridColor.copy(alpha = 0.5f),
                        start = Offset(paddingLeft, y),
                        end = Offset(width - paddingRight, y),
                        strokeWidth = 1f,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(4f, 4f))
                    )
                }

                if (dataPoints.size < 2) return@Canvas

                // Compute points
                val points = dataPoints.mapIndexed { index, (_, tokens) ->
                    val x = paddingLeft + (index.toFloat() / (dataPoints.size - 1)) * chartWidth
                    val normalizedY = (tokens - minValue).toFloat() / (maxValue - minValue).toFloat()
                    val y = paddingTop + chartHeight * (1f - normalizedY)
                    Offset(x, y)
                }

                // Animate: draw only up to animatedProgress
                val visibleCount = (points.size * animatedProgress).toInt().coerceAtLeast(2)
                val visiblePoints = points.take(visibleCount)

                // Fill area under line
                if (visiblePoints.size >= 2) {
                    val path = androidx.compose.ui.graphics.Path().apply {
                        moveTo(visiblePoints.first().x, paddingTop + chartHeight)
                        lineTo(visiblePoints.first().x, visiblePoints.first().y)
                        visiblePoints.drop(1).forEach { pt ->
                            lineTo(pt.x, pt.y)
                        }
                        lineTo(visiblePoints.last().x, paddingTop + chartHeight)
                        close()
                    }
                    drawPath(
                        path = path,
                        color = lineColor.copy(alpha = 0.12f)
                    )
                }

                // Draw line segments
                for (i in 0 until visiblePoints.size - 1) {
                    drawLine(
                        color = lineColor,
                        start = visiblePoints[i],
                        end = visiblePoints[i + 1],
                        strokeWidth = 2.5f,
                        cap = StrokeCap.Round
                    )
                }

                // Draw dots at each point
                visiblePoints.forEach { point ->
                    drawCircle(
                        color = lineColor,
                        radius = 4f,
                        center = point
                    )
                    drawCircle(
                        color = Color.White.copy(alpha = 0.8f),
                        radius = 2f,
                        center = point
                    )
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    "Message 1",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 10.sp
                )
                Text(
                    "Message ${dataPoints.size}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 10.sp
                )
            }
        }
    }
}

private fun formatTokens(count: Long): String {
    return when {
        count >= 1_000_000 -> String.format("%.1fM", count / 1_000_000.0)
        count >= 1_000 -> String.format("%.1fK", count / 1_000.0)
        else -> count.toString()
    }
}
