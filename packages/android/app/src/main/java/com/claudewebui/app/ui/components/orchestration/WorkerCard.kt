package com.claudewebui.app.ui.components.orchestration

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.WorkerState
import com.claudewebui.app.data.model.WorkerStatus
import com.claudewebui.app.ui.theme.CliProvider
import com.claudewebui.app.ui.theme.ProviderThemes

@Composable
fun WorkerCard(
    worker: WorkerState,
    progress: Float,
    tokenCount: Int = 0,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val cliProvider = mapCLIToCliProvider(worker.provider)
    val theme = ProviderThemes.get(cliProvider)
    val providerColor = if (isDark) theme.colorDark else theme.color
    val containerColor = if (isDark) theme.containerColorDark else theme.containerColor
    val onContainerColor = if (isDark) theme.onContainerColorDark else theme.onContainerColor

    val borderColor by animateColorAsState(
        targetValue = when (worker.status) {
            WorkerStatus.BUSY, WorkerStatus.STARTING -> providerColor
            WorkerStatus.ERROR -> MaterialTheme.colorScheme.error
            WorkerStatus.STOPPED -> MaterialTheme.colorScheme.outline.copy(alpha = 0.3f)
            else -> MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)
        },
        animationSpec = tween(300),
        label = "borderColor",
    )

    Card(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onTap),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        ),
        border = BorderStroke(2.dp, borderColor),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // Header: provider badge + status
            Row(
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                // Provider chip
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(containerColor)
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                ) {
                    Icon(
                        imageVector = theme.icon,
                        contentDescription = null,
                        tint = onContainerColor,
                        modifier = Modifier.size(14.dp),
                    )
                    Text(
                        text = theme.displayName,
                        color = onContainerColor,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                }

                // Status indicator
                WorkerStatusDot(status = worker.status)
            }

            // Worker ID
            Text(
                text = "Worker ${worker.id.takeLast(6)}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            )

            // Current task
            AnimatedContent(
                targetState = worker.currentTask ?: when (worker.status) {
                    WorkerStatus.IDLE -> "Waiting for task…"
                    WorkerStatus.STARTING -> "Starting up…"
                    WorkerStatus.STOPPED -> "Stopped"
                    WorkerStatus.ERROR -> worker.errorMessage ?: "Error"
                    else -> "Idle"
                },
                transitionSpec = {
                    fadeIn(tween(200)) togetherWith fadeOut(tween(200))
                },
                label = "taskText",
            ) { taskText ->
                Text(
                    text = taskText,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (worker.status == WorkerStatus.ERROR)
                        MaterialTheme.colorScheme.error
                    else
                        MaterialTheme.colorScheme.onSurface,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    lineHeight = 18.sp,
                )
            }

            // Progress
            if (worker.status == WorkerStatus.BUSY || worker.status == WorkerStatus.STARTING || progress > 0f) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    LinearProgressIndicator(
                        progress = { progress },
                        modifier = Modifier
                            .weight(1f)
                            .height(4.dp)
                            .clip(RoundedCornerShape(2.dp)),
                        color = providerColor,
                        trackColor = providerColor.copy(alpha = 0.15f),
                    )
                    Text(
                        text = "${(progress * 100).toInt()}%",
                        style = MaterialTheme.typography.labelSmall,
                        color = providerColor,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }

            // Token usage (bottom row)
            if (tokenCount > 0) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Bolt,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                        modifier = Modifier.size(12.dp),
                    )
                    Text(
                        text = formatTokens(tokenCount),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                    )
                }
            }
        }
    }
}

@Composable
private fun WorkerStatusDot(
    status: WorkerStatus,
    modifier: Modifier = Modifier,
) {
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val pulsedScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.35f,
        animationSpec = infiniteRepeatable(
            animation = tween(800, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pulseScale",
    )

    val color = when (status) {
        WorkerStatus.IDLE -> Color(0xFF9CA3AF)
        WorkerStatus.STARTING -> Color(0xFFF59E0B)
        WorkerStatus.BUSY -> Color(0xFF22C55E)
        WorkerStatus.ERROR -> Color(0xFFEF4444)
        WorkerStatus.STOPPED -> Color(0xFF6B7280)
    }

    val label = when (status) {
        WorkerStatus.IDLE -> "Idle"
        WorkerStatus.STARTING -> "Starting"
        WorkerStatus.BUSY -> "Working"
        WorkerStatus.ERROR -> "Error"
        WorkerStatus.STOPPED -> "Stopped"
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        modifier = modifier,
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .scale(if (status == WorkerStatus.BUSY || status == WorkerStatus.STARTING) pulsedScale else 1f)
                .clip(CircleShape)
                .background(color),
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = color,
            fontWeight = FontWeight.Medium,
        )
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

@Suppress("DEPRECATION")
internal fun mapCLIToCliProvider(provider: CLIProvider): CliProvider = when (provider) {
    CLIProvider.CLAUDE -> CliProvider.CLAUDE
    CLIProvider.CODEX -> CliProvider.CODEX
    CLIProvider.OPENCODE -> CliProvider.OPENCODE
    CLIProvider.VIBE -> CliProvider.VIBE
    CLIProvider.GLM,
    CLIProvider.KIMI -> CliProvider.OPENCODE
    CLIProvider.GEMINI,
    CLIProvider.MULTI -> CliProvider.UNKNOWN
}

private fun formatTokens(tokens: Int): String = when {
    tokens >= 1_000_000 -> "${tokens / 1_000_000}M tokens"
    tokens >= 1_000 -> "${tokens / 1_000}k tokens"
    else -> "$tokens tokens"
}
