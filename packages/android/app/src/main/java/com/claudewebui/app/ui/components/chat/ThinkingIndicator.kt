package com.claudewebui.app.ui.components.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.*
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun ThinkingIndicator(
    isThinking: Boolean,
    toolName: String? = null,
    thinkingStartTime: Long = 0L,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(
        visible = isThinking || toolName != null,
        enter = fadeIn() + slideInVertically(initialOffsetY = { it / 2 }),
        exit = fadeOut() + slideOutVertically(targetOffsetY = { it / 2 }),
        modifier = modifier,
    ) {
        Row(
            modifier = Modifier
                .padding(start = 16.dp, end = 16.dp, bottom = 8.dp)
                .wrapContentWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // Avatar placeholder matching assistant bubble style
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                modifier = Modifier.size(28.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = "✦",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        fontSize = 12.sp,
                    )
                }
            }

            // Bubble content
            Surface(
                shape = RoundedCornerShape(
                    topStart = 4.dp, topEnd = 16.dp, bottomEnd = 16.dp, bottomStart = 16.dp
                ),
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                tonalElevation = 1.dp,
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (toolName != null) {
                        // Tool executing state. A long-running tool call is
                        // exactly where a missing timer reads as a hang, so it
                        // gets the same elapsed counter as thinking.
                        PulsingDots(color = MaterialTheme.colorScheme.tertiary)
                        ElapsedTime(
                            startTime = thinkingStartTime,
                            prefix = formatToolLabel(toolName).removeSuffix("…"),
                        )
                    } else {
                        // Thinking state
                        PulsingDots(color = MaterialTheme.colorScheme.primary)
                        ElapsedTime(
                            startTime = thinkingStartTime,
                            prefix = "Thinking",
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PulsingDots(
    color: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
) {
    val infiniteTransition = rememberInfiniteTransition(label = "dots")

    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(3) { index ->
            val scale by infiniteTransition.animateFloat(
                initialValue = 0.6f,
                targetValue = 1.0f,
                animationSpec = infiniteRepeatable(
                    animation = tween(
                        durationMillis = 600,
                        easing = FastOutSlowInEasing,
                        delayMillis = index * 120,
                    ),
                    repeatMode = RepeatMode.Reverse,
                ),
                label = "dot_scale_$index",
            )
            Surface(
                shape = CircleShape,
                color = color,
                modifier = Modifier
                    .size(6.dp)
                    .scale(scale),
            ) {}
        }
    }
}

@Composable
private fun ElapsedTime(
    startTime: Long,
    prefix: String,
    modifier: Modifier = Modifier,
) {
    var elapsed by remember { mutableStateOf(0L) }

    LaunchedEffect(startTime) {
        if (startTime > 0) {
            while (true) {
                elapsed = (System.currentTimeMillis() - startTime) / 1000
                kotlinx.coroutines.delay(1000)
            }
        }
    }

    Text(
        text = if (elapsed > 0) "$prefix… ${elapsed}s" else "$prefix…",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        fontSize = 13.sp,
        modifier = modifier,
    )
}

private fun formatToolLabel(toolName: String): String = when (toolName.lowercase()) {
    "read" -> "Reading file…"
    "write" -> "Writing file…"
    "edit" -> "Editing file…"
    "bash" -> "Running command…"
    "glob" -> "Searching files…"
    "grep" -> "Searching content…"
    "agent" -> "Running agent…"
    "todowrite" -> "Updating todos…"
    "websearch" -> "Searching web…"
    "webfetch" -> "Fetching URL…"
    else -> "Using $toolName…"
}
