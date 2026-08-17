package com.claudewebui.app.ui.components.chat

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.PermissionAction
import com.claudewebui.app.data.model.PermissionRequest
import com.claudewebui.app.ui.theme.JetBrainsMonoFamily
import kotlinx.coroutines.delay
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// ── Permission Request Card ───────────────────────────────────────────────────

/** Dangerous operations that warrant a red warning treatment */
private val DESTRUCTIVE_PATTERNS = listOf(
    "rm ", "rmdir", "rm -", "sudo rm", "del ", "delete",
    "force", "--force", "-f ", "DROP TABLE", "DROP DATABASE",
    "force-recreate", "git push --force", "git push -f",
    "truncate", "mkfs", "dd if=", "shred",
)

@Composable
fun PermissionRequestCard(
    request: PermissionRequest,
    onAction: (PermissionAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptic = LocalHapticFeedback.current
    val toolInfo = ToolIconMapper.forTool(request.toolName)
    val isDestructive = isDestructiveOperation(request)

    // Key the state as well as the coroutine to the request. A new approval
    // must never inherit the previous card's elapsed/expired state.
    var elapsedSeconds by remember(request.requestId) { mutableIntStateOf(0) }

    LaunchedEffect(request.requestId) {
        elapsedSeconds = 0
        repeat(PERMISSION_REQUEST_LIFETIME_SECONDS) {
            delay(1000)
            elapsedSeconds++
        }
    }

    val secondsRemaining = permissionSecondsRemaining(elapsedSeconds)
    val awaitingServer = secondsRemaining == 0
    val timerProgress = secondsRemaining.toFloat() / PERMISSION_REQUEST_LIFETIME_SECONDS
    val timerColor by animateColorAsState(
        targetValue = when {
            timerProgress > 0.5f -> Color(0xFF22C55E)
            timerProgress > 0.25f -> Color(0xFFF59E0B)
            else -> Color(0xFFEF4444)
        },
        animationSpec = tween(300),
        label = "timerColor",
    )

    val cardBorderColor = if (isDestructive) {
        Color(0xFFEF4444).copy(alpha = 0.4f)
    } else {
        MaterialTheme.colorScheme.outlineVariant
    }
    val cardBgColor = if (isDestructive) {
        Color(0xFFEF4444).copy(alpha = 0.04f)
    } else {
        MaterialTheme.colorScheme.surfaceContainerHigh
    }

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .border(
                width = 1.dp,
                color = cardBorderColor,
                shape = RoundedCornerShape(12.dp),
            ),
        shape = RoundedCornerShape(12.dp),
        color = cardBgColor,
    ) {
        Column(modifier = Modifier.padding(14.dp)) {

            // ── Top: permission type header ───────────────────────────────────
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // Permission icon (lock with exclamation for destructive)
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .background(
                            color = if (isDestructive)
                                Color(0xFFEF4444).copy(alpha = 0.12f)
                            else
                                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f),
                            shape = RoundedCornerShape(8.dp),
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = if (isDestructive) Icons.Outlined.Warning else Icons.Outlined.Lock,
                        contentDescription = null,
                        tint = if (isDestructive) Color(0xFFEF4444) else MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(16.dp),
                    )
                }

                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = if (isDestructive) "Permission Required — Destructive" else "Permission Required",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = if (isDestructive) Color(0xFFEF4444) else MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = "The active agent wants to use a tool",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 11.sp,
                    )
                }

                // Countdown chip
                if (!awaitingServer) {
                    CountdownChip(
                        seconds = secondsRemaining,
                        color = timerColor,
                        progress = timerProgress,
                    )
                } else {
                    AwaitingServerChip()
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // ── Tool info row ─────────────────────────────────────────────────
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        color = MaterialTheme.colorScheme.surfaceContainerHighest,
                        shape = RoundedCornerShape(8.dp),
                    )
                    .padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(
                    imageVector = toolInfo.icon,
                    contentDescription = null,
                    tint = toolInfo.color,
                    modifier = Modifier.size(18.dp),
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = toolInfo.label,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = request.description,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        lineHeight = 16.sp,
                    )
                }
            }

            // ── Command / path preview ────────────────────────────────────────
            extractCommandPreview(request)?.let { preview ->
                Spacer(modifier = Modifier.height(8.dp))
                CommandPreview(
                    text = preview,
                    isDestructive = isDestructive,
                )
            }

            Spacer(modifier = Modifier.height(14.dp))

            // ── Action buttons ────────────────────────────────────────────────
            // The backend is authoritative. Keep the controls usable after the
            // local countdown: transport latency must not disable a request
            // that the server still accepts.
            PermissionActions(
                isDestructive = isDestructive,
                onAllow = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onAction(PermissionAction.ALLOW_ONCE)
                },
                onAllowAlways = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onAction(PermissionAction.ALLOW_PROJECT)
                },
                onDeny = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onAction(PermissionAction.DENY)
                },
            )

            // ── Timer progress bar ────────────────────────────────────────────
            if (!awaitingServer) {
                Spacer(modifier = Modifier.height(10.dp))
                LinearProgressIndicator(
                    progress = { timerProgress },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(2.dp)
                        .clip(RoundedCornerShape(1.dp)),
                    color = timerColor,
                    trackColor = timerColor.copy(alpha = 0.15f),
                )
            }
        }
    }
}

// ── Sub-components ────────────────────────────────────────────────────────────

@Composable
private fun CountdownChip(seconds: Int, color: Color, progress: Float) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = color.copy(alpha = 0.12f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(
                imageVector = Icons.Outlined.Timer,
                contentDescription = null,
                tint = color,
                modifier = Modifier.size(12.dp),
            )
            Text(
                text = "${seconds}s",
                style = MaterialTheme.typography.labelSmall,
                color = color,
                fontWeight = FontWeight.SemiBold,
                fontSize = 11.sp,
            )
        }
    }
}

@Composable
private fun AwaitingServerChip() {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
    ) {
        Text(
            text = "Checking…",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun CommandPreview(text: String, isDestructive: Boolean) {
    val bgColor = if (isDestructive) Color(0xFFEF4444).copy(alpha = 0.06f)
    else MaterialTheme.colorScheme.surfaceContainerHighest
    val borderColor = if (isDestructive) Color(0xFFEF4444).copy(alpha = 0.2f)
    else MaterialTheme.colorScheme.outlineVariant

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(color = bgColor, shape = RoundedCornerShape(6.dp))
            .border(width = 0.5.dp, color = borderColor, shape = RoundedCornerShape(6.dp))
            .padding(horizontal = 10.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            imageVector = Icons.Outlined.Terminal,
            contentDescription = null,
            tint = if (isDestructive) Color(0xFFEF4444) else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(13.dp),
        )
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall.copy(
                fontFamily = JetBrainsMonoFamily,
                fontSize = 11.sp,
            ),
            color = if (isDestructive) Color(0xFFEF4444) else MaterialTheme.colorScheme.onSurface,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun PermissionActions(
    isDestructive: Boolean,
    onAllow: () -> Unit,
    onAllowAlways: () -> Unit,
    onDeny: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // Deny button — always first, muted
        OutlinedButton(
            onClick = onDeny,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            colors = ButtonDefaults.outlinedButtonColors(
                contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
        ) {
            Icon(
                imageVector = Icons.Outlined.Block,
                contentDescription = null,
                modifier = Modifier.size(14.dp),
            )
            Spacer(modifier = Modifier.width(4.dp))
            Text(
                text = "Deny",
                style = MaterialTheme.typography.labelMedium,
            )
        }

        // Allow once button
        FilledTonalButton(
            onClick = onAllow,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            colors = ButtonDefaults.filledTonalButtonColors(
                containerColor = if (isDestructive)
                    Color(0xFFEF4444).copy(alpha = 0.15f)
                else
                    MaterialTheme.colorScheme.secondaryContainer,
                contentColor = if (isDestructive)
                    Color(0xFFEF4444)
                else
                    MaterialTheme.colorScheme.onSecondaryContainer,
            ),
        ) {
            Icon(
                imageVector = Icons.Outlined.Check,
                contentDescription = null,
                modifier = Modifier.size(14.dp),
            )
            Spacer(modifier = Modifier.width(4.dp))
            Text(
                text = "Allow",
                style = MaterialTheme.typography.labelMedium,
            )
        }

        // Allow always button — only for non-destructive (too risky otherwise)
        if (!isDestructive) {
            FilledTonalButton(
                onClick = onAllowAlways,
                modifier = Modifier.weight(1.3f),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                colors = ButtonDefaults.filledTonalButtonColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.7f),
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                ),
            ) {
                Icon(
                    imageVector = Icons.Outlined.CheckCircle,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    text = "Allow Always",
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

private fun isDestructiveOperation(request: PermissionRequest): Boolean {
    val description = request.description.lowercase()
    val inputStr = request.toolInput?.toString()?.lowercase() ?: ""
    return DESTRUCTIVE_PATTERNS.any { pattern ->
        description.contains(pattern.lowercase()) || inputStr.contains(pattern.lowercase())
    }
}

private fun extractCommandPreview(request: PermissionRequest): String? {
    val input = request.toolInput ?: return null
    return try {
        val obj = input.jsonObject
        obj["command"]?.jsonPrimitive?.content
            ?: obj["file_path"]?.jsonPrimitive?.content
            ?: obj["pattern"]?.jsonPrimitive?.content
            ?: obj["url"]?.jsonPrimitive?.content
    } catch (_: Exception) { null }
}
