package com.claudewebui.app.ui.components.common

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.claudewebui.app.ui.theme.ClaudeWebUITheme
import com.claudewebui.app.ui.theme.ErrorRed
import com.claudewebui.app.ui.theme.SuccessGreen

// ── Status ───────────────────────────────────────────────────────────────────

enum class SessionStatus {
    RUNNING,
    STOPPED,
    ERROR,
    IDLE,
}

// ── StatusDot Composable ─────────────────────────────────────────────────────

@Composable
fun StatusDot(
    status: SessionStatus,
    modifier: Modifier = Modifier,
    size: Dp = 10.dp,
) {
    val baseColor = when (status) {
        SessionStatus.RUNNING -> SuccessGreen
        SessionStatus.STOPPED -> Color(0xFF9CA3AF)
        SessionStatus.ERROR -> ErrorRed
        SessionStatus.IDLE -> Color(0xFFD4D3CE)
    }

    if (status == SessionStatus.RUNNING) {
        AnimatedStatusDot(color = baseColor, size = size, modifier = modifier)
    } else {
        StaticStatusDot(color = baseColor, size = size, modifier = modifier)
    }
}

// ── Static Dot ───────────────────────────────────────────────────────────────

@Composable
private fun StaticStatusDot(
    color: Color,
    size: Dp,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier.size(size)) {
        drawCircle(
            color = color,
            radius = this.size.minDimension / 2f,
            center = Offset(this.size.width / 2f, this.size.height / 2f),
        )
    }
}

// ── Animated Pulse Dot ───────────────────────────────────────────────────────

@Composable
private fun AnimatedStatusDot(
    color: Color,
    size: Dp,
    modifier: Modifier = Modifier,
) {
    val infiniteTransition = rememberInfiniteTransition(label = "statusPulse")
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 2.2f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1200, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "pulseScale",
    )
    val pulseAlpha by infiniteTransition.animateFloat(
        initialValue = 0.5f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1200, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "pulseAlpha",
    )

    Canvas(modifier = modifier.size(size * 2.5f)) {
        val center = Offset(this.size.width / 2f, this.size.height / 2f)
        val baseRadius = this.size.minDimension / 5f

        // Pulse ring
        drawCircle(
            color = color.copy(alpha = pulseAlpha),
            radius = baseRadius * pulseScale,
            center = center,
        )

        // Solid core
        drawCircle(
            color = color,
            radius = baseRadius,
            center = center,
        )
    }
}

// ── Previews ─────────────────────────────────────────────────────────────────

@Preview(showBackground = true, backgroundColor = 0xFFF0EFEA)
@Composable
private fun StatusDotPreview() {
    ClaudeWebUITheme {
        Row(
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StatusDot(status = SessionStatus.RUNNING)
            StatusDot(status = SessionStatus.STOPPED)
            StatusDot(status = SessionStatus.ERROR)
            StatusDot(status = SessionStatus.IDLE)
        }
    }
}
