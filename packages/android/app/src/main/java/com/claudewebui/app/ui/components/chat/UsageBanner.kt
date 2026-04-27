package com.claudewebui.app.ui.components.chat

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

// ── Usage Data Model ──────────────────────────────────────────────────────────

data class TokenUsage(
    val inputTokens: Int,
    val outputTokens: Int,
    val cacheWriteTokens: Int = 0,
    val cacheReadTokens: Int = 0,
    val contextWindowSize: Int = 200_000, // Claude's 200k default
    val model: String = "claude-sonnet-4-5",
    val estimatedCostUsd: Double? = null,
)

// ── Usage Banner ──────────────────────────────────────────────────────────────

private const val CONTEXT_WARN_THRESHOLD = 0.80f   // auto-show at 80%
private const val CONTEXT_CRITICAL_THRESHOLD = 0.95f

@Composable
fun UsageBanner(
    usage: TokenUsage?,
    modifier: Modifier = Modifier,
) {
    if (usage == null) return

    val totalUsed = usage.inputTokens + usage.cacheReadTokens
    val contextFraction = (totalUsed.toFloat() / usage.contextWindowSize.toFloat()).coerceIn(0f, 1f)
    val autoVisible = contextFraction >= CONTEXT_WARN_THRESHOLD

    var userExpanded by remember { mutableStateOf(false) }
    var detailsExpanded by remember { mutableStateOf(false) }

    val visible = autoVisible || userExpanded

    val chevronAngle by animateFloatAsState(
        targetValue = if (detailsExpanded) 180f else 0f,
        animationSpec = tween(200),
        label = "chevron",
    )

    // Animate token counts with spring (visually satisfying counter)
    val animatedInput by animateIntAsState(
        targetValue = usage.inputTokens,
        animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
        label = "inputTokens",
    )
    val animatedOutput by animateIntAsState(
        targetValue = usage.outputTokens,
        animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
        label = "outputTokens",
    )

    val contextColor = contextProgressColor(contextFraction)

    // If below threshold, allow manual dismiss
    AnimatedVisibility(
        visible = visible,
        enter = expandVertically() + fadeIn(),
        exit = shrinkVertically() + fadeOut(),
        modifier = modifier,
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            tonalElevation = 0.dp,
            shape = RoundedCornerShape(0.dp), // banner goes full-width edge to edge
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { detailsExpanded = !detailsExpanded },
            ) {
                // ── Compact row ───────────────────────────────────────────────
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    // Context icon
                    Icon(
                        imageVector = if (contextFraction >= CONTEXT_CRITICAL_THRESHOLD)
                            Icons.Outlined.Warning else Icons.Outlined.Memory,
                        contentDescription = null,
                        tint = contextColor,
                        modifier = Modifier.size(15.dp),
                    )

                    // Context window progress bar
                    Column(modifier = Modifier.weight(1f)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                text = "Context window",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontSize = 11.sp,
                            )
                            Text(
                                text = "${(contextFraction * 100).roundToInt()}%",
                                style = MaterialTheme.typography.labelSmall,
                                color = contextColor,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 11.sp,
                            )
                        }
                        Spacer(modifier = Modifier.height(3.dp))
                        GradientProgressBar(
                            progress = contextFraction,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(4.dp),
                        )
                    }

                    // Token summary pill
                    TokenSummaryPill(
                        inputTokens = animatedInput,
                        outputTokens = animatedOutput,
                    )

                    // Expand chevron
                    Icon(
                        imageVector = Icons.Outlined.KeyboardArrowDown,
                        contentDescription = if (detailsExpanded) "Collapse" else "Expand",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                        modifier = Modifier
                            .size(16.dp)
                            .rotate(chevronAngle),
                    )
                }

                // ── Expanded details ──────────────────────────────────────────
                AnimatedVisibility(
                    visible = detailsExpanded,
                    enter = expandVertically(animationSpec = tween(200)) + fadeIn(),
                    exit = shrinkVertically(animationSpec = tween(160)) + fadeOut(),
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surfaceContainerHighest)
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        HorizontalDivider(
                            color = MaterialTheme.colorScheme.outlineVariant,
                            thickness = 0.5.dp,
                            modifier = Modifier.padding(bottom = 4.dp),
                        )

                        // Token breakdown grid
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            TokenStatItem(
                                label = "Input",
                                value = formatTokenCount(animatedInput),
                                icon = Icons.Outlined.ArrowUpward,
                                color = Color(0xFF3B82F6),
                                modifier = Modifier.weight(1f),
                            )
                            TokenStatItem(
                                label = "Output",
                                value = formatTokenCount(animatedOutput),
                                icon = Icons.Outlined.ArrowDownward,
                                color = Color(0xFF22C55E),
                                modifier = Modifier.weight(1f),
                            )
                            if (usage.cacheReadTokens > 0) {
                                TokenStatItem(
                                    label = "Cache Hit",
                                    value = formatTokenCount(usage.cacheReadTokens),
                                    icon = Icons.Outlined.FlashOn,
                                    color = Color(0xFFF59E0B),
                                    modifier = Modifier.weight(1f),
                                )
                            }
                            if (usage.cacheWriteTokens > 0) {
                                TokenStatItem(
                                    label = "Cache Write",
                                    value = formatTokenCount(usage.cacheWriteTokens),
                                    icon = Icons.Outlined.SaveAlt,
                                    color = Color(0xFF8B5CF6),
                                    modifier = Modifier.weight(1f),
                                )
                            }
                        }

                        // Context window usage detail
                        ContextWindowDetail(
                            usedTokens = totalUsed,
                            totalTokens = usage.contextWindowSize,
                            fraction = contextFraction,
                            contextColor = contextColor,
                        )

                        // Model + cost row
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.SmartToy,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.size(12.dp),
                                )
                                Text(
                                    text = usage.model,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    fontSize = 11.sp,
                                )
                            }

                            usage.estimatedCostUsd?.let { cost ->
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                                ) {
                                    Icon(
                                        imageVector = Icons.Outlined.AttachMoney,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.size(12.dp),
                                    )
                                    Text(
                                        text = "~$${"%.4f".format(cost)}",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        fontSize = 11.sp,
                                    )
                                }
                            }
                        }

                        // Manual dismiss if not auto-triggered
                        if (!autoVisible) {
                            TextButton(
                                onClick = { userExpanded = false },
                                modifier = Modifier.align(Alignment.End),
                                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                            ) {
                                Text(
                                    text = "Dismiss",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── Sub-components ────────────────────────────────────────────────────────────

@Composable
private fun GradientProgressBar(
    progress: Float,
    modifier: Modifier = Modifier,
) {
    val colorLow = Color(0xFF22C55E)
    val colorMid = Color(0xFFF59E0B)
    val colorHigh = Color(0xFFEF4444)
    val indicatorColor = contextProgressColor(progress)

    Box(
        modifier = modifier.clip(RoundedCornerShape(2.dp)),
    ) {
        // Track
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f)),
        )
        // Fill
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .fillMaxWidth(fraction = progress.coerceIn(0f, 1f))
                .background(
                    brush = Brush.horizontalGradient(
                        colorStops = arrayOf(
                            0.0f to colorLow,
                            0.5f to colorMid,
                            1.0f to colorHigh,
                        ),
                    ),
                ),
        )
    }
}

@Composable
private fun TokenSummaryPill(inputTokens: Int, outputTokens: Int) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                text = formatTokenCount(inputTokens),
                style = MaterialTheme.typography.labelSmall,
                color = Color(0xFF3B82F6),
                fontWeight = FontWeight.SemiBold,
                fontSize = 10.sp,
            )
            Text(
                text = "/",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                fontSize = 10.sp,
            )
            Text(
                text = formatTokenCount(outputTokens),
                style = MaterialTheme.typography.labelSmall,
                color = Color(0xFF22C55E),
                fontWeight = FontWeight.SemiBold,
                fontSize = 10.sp,
            )
        }
    }
}

@Composable
private fun TokenStatItem(
    label: String,
    value: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .background(
                color = color.copy(alpha = 0.07f),
                shape = RoundedCornerShape(8.dp),
            )
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = color,
                modifier = Modifier.size(11.dp),
            )
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 10.sp,
            )
        }
        Text(
            text = value,
            style = MaterialTheme.typography.labelLarge,
            color = color,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
        )
    }
}

@Composable
private fun ContextWindowDetail(
    usedTokens: Int,
    totalTokens: Int,
    fraction: Float,
    contextColor: Color,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon(
                    imageVector = Icons.Outlined.DataUsage,
                    contentDescription = null,
                    tint = contextColor,
                    modifier = Modifier.size(12.dp),
                )
                Text(
                    text = "Context window",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 11.sp,
                )
            }
            Text(
                text = "${formatTokenCount(usedTokens)} / ${formatTokenCount(totalTokens)} tokens",
                style = MaterialTheme.typography.labelSmall,
                color = contextColor,
                fontWeight = FontWeight.Medium,
                fontSize = 11.sp,
            )
        }
        GradientProgressBar(
            progress = fraction,
            modifier = Modifier
                .fillMaxWidth()
                .height(6.dp),
        )
        if (fraction >= CONTEXT_WARN_THRESHOLD) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.padding(top = 2.dp),
            ) {
                Icon(
                    imageVector = Icons.Outlined.Info,
                    contentDescription = null,
                    tint = contextColor,
                    modifier = Modifier.size(12.dp),
                )
                Text(
                    text = if (fraction >= CONTEXT_CRITICAL_THRESHOLD)
                        "Context almost full — start a new session soon"
                    else
                        "Context filling up — consider starting a new session",
                    style = MaterialTheme.typography.labelSmall,
                    color = contextColor,
                    fontSize = 10.sp,
                )
            }
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

@Composable
private fun contextProgressColor(fraction: Float): Color {
    val colorLow = Color(0xFF22C55E)
    val colorMid = Color(0xFFF59E0B)
    val colorHigh = Color(0xFFEF4444)
    return when {
        fraction < 0.5f -> lerp(colorLow, colorMid, fraction / 0.5f)
        else -> lerp(colorMid, colorHigh, (fraction - 0.5f) / 0.5f)
    }
}

private fun formatTokenCount(count: Int): String = when {
    count >= 1_000_000 -> "${"%.1f".format(count / 1_000_000.0)}M"
    count >= 1_000 -> "${"%.1f".format(count / 1_000.0)}k"
    else -> count.toString()
}
