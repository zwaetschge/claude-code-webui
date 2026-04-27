package com.claudewebui.app.ui.components.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.*
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.ToolExecution
import com.claudewebui.app.data.model.ToolStatus

// ── Agent Card ────────────────────────────────────────────────────────────────

@Composable
fun AgentCard(
    agentType: String,
    description: String?,
    status: ToolStatus,
    tools: List<ToolExecution> = emptyList(),
    durationMs: Long? = null,
    modifier: Modifier = Modifier,
    initiallyExpanded: Boolean = false,
) {
    val agentInfo = ToolIconMapper.forAgent(agentType)
    var expanded by remember { mutableStateOf(initiallyExpanded || status == ToolStatus.STARTED) }
    val chevronAngle by animateFloatAsState(
        targetValue = if (expanded) 180f else 0f,
        animationSpec = tween(200),
        label = "chevron",
    )

    val borderColor = when (status) {
        ToolStatus.STARTED -> agentInfo.color
        ToolStatus.COMPLETED -> Color(0xFF22C55E)
        ToolStatus.ERROR -> MaterialTheme.colorScheme.error
    }

    // Animated border for running state
    val infiniteTransition = rememberInfiniteTransition(label = "agentBorder")
    val borderAlpha by infiniteTransition.animateFloat(
        initialValue = 0.4f,
        targetValue = 1.0f,
        animationSpec = infiniteRepeatable(
            animation = tween(900, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "borderAlpha",
    )
    val activeBorderAlpha = if (status == ToolStatus.STARTED) borderAlpha else 0.35f

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .animateContentSize()
            .border(
                width = 1.dp,
                color = borderColor.copy(alpha = activeBorderAlpha),
                shape = RoundedCornerShape(10.dp),
            ),
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
    ) {
        Column {
            // ── Header row ────────────────────────────────────────────────────
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { if (tools.isNotEmpty()) expanded = !expanded }
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                // Agent icon with tinted background
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .background(
                            color = agentInfo.color.copy(alpha = 0.12f),
                            shape = RoundedCornerShape(8.dp),
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    when (status) {
                        ToolStatus.STARTED -> AgentSpinner(color = agentInfo.color)
                        ToolStatus.COMPLETED -> Icon(
                            imageVector = Icons.Filled.CheckCircle,
                            contentDescription = null,
                            tint = Color(0xFF22C55E),
                            modifier = Modifier.size(20.dp),
                        )
                        ToolStatus.ERROR -> Icon(
                            imageVector = Icons.Filled.Cancel,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }

                Column(modifier = Modifier.weight(1f)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(
                            imageVector = agentInfo.icon,
                            contentDescription = null,
                            tint = agentInfo.color,
                            modifier = Modifier.size(13.dp),
                        )
                        Text(
                            text = agentInfo.label,
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = agentInfo.color,
                        )
                        if (status == ToolStatus.STARTED) {
                            RunningPill()
                        }
                    }
                    description?.let {
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = it,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                            lineHeight = 16.sp,
                        )
                    }
                }

                // Right side: duration + chevron
                Column(horizontalAlignment = Alignment.End) {
                    durationMs?.let {
                        Text(
                            text = formatDurationShort(it),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 10.sp,
                        )
                    }
                    if (tools.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(2.dp),
                        ) {
                            Text(
                                text = "${tools.size}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontSize = 10.sp,
                            )
                            Icon(
                                imageVector = Icons.Outlined.Build,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(10.dp),
                            )
                            Icon(
                                imageVector = Icons.Outlined.KeyboardArrowDown,
                                contentDescription = if (expanded) "Collapse" else "Expand",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier
                                    .size(16.dp)
                                    .rotate(chevronAngle),
                            )
                        }
                    }
                }
            }

            // ── Nested tool calls ─────────────────────────────────────────────
            AnimatedVisibility(
                visible = expanded && tools.isNotEmpty(),
                enter = expandVertically(),
                exit = shrinkVertically(),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            color = MaterialTheme.colorScheme.surfaceContainerHighest,
                            shape = RoundedCornerShape(bottomStart = 10.dp, bottomEnd = 10.dp),
                        ),
                ) {
                    HorizontalDivider(
                        color = MaterialTheme.colorScheme.outlineVariant,
                        thickness = 0.5.dp,
                    )

                    Column(
                        modifier = Modifier.padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        // Section header
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.padding(bottom = 2.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Build,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                                modifier = Modifier.size(11.dp),
                            )
                            Text(
                                text = "Tool Calls",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                                fontSize = 10.sp,
                                letterSpacing = 0.8.sp,
                            )
                        }

                        tools.forEach { tool ->
                            ToolExecutionCard(
                                tool = tool,
                                modifier = Modifier.padding(start = 8.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

// ── Sub-components ────────────────────────────────────────────────────────────

@Composable
private fun AgentSpinner(color: Color) {
    val infiniteTransition = rememberInfiniteTransition(label = "agentSpinner")
    val rotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(1200, easing = LinearEasing),
        ),
        label = "spin",
    )
    Icon(
        imageVector = Icons.Outlined.AutoMode,
        contentDescription = "Running",
        tint = color,
        modifier = Modifier
            .size(20.dp)
            .rotate(rotation),
    )
}

@Composable
private fun RunningPill() {
    val infiniteTransition = rememberInfiniteTransition(label = "runningPill")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 0.5f,
        targetValue = 1.0f,
        animationSpec = infiniteRepeatable(
            animation = tween(700),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pillAlpha",
    )
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = Color(0xFF22C55E).copy(alpha = 0.12f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(5.dp)
                    .background(
                        color = Color(0xFF22C55E).copy(alpha = alpha),
                        shape = RoundedCornerShape(3.dp),
                    )
            )
            Text(
                text = "running",
                style = MaterialTheme.typography.labelSmall,
                color = Color(0xFF22C55E).copy(alpha = alpha),
                fontSize = 9.sp,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

private fun formatDurationShort(millis: Long): String = when {
    millis < 1000 -> "${millis}ms"
    millis < 60_000 -> "${"%.1f".format(millis / 1000.0)}s"
    else -> "${millis / 60_000}m ${(millis % 60_000) / 1000}s"
}
