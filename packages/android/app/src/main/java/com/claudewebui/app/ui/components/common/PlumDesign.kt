package com.claudewebui.app.ui.components.common

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Analytics
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.ShowChart
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.ViewList
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.CLIProvider

val PlumBackground = Color(0xFF080B0D)
val PlumSurface = Color(0xE616191C)
val PlumSurfaceStrong = Color(0xF21B1E21)
val PlumBorder = Color(0xFF34383D)
val PlumBorderSoft = Color(0xFF24292E)
val PlumText = Color(0xFFF3F1F5)
val PlumMuted = Color(0xFFA8A6AE)
val PlumAccent = Color(0xFFB56BFF)
val PlumAccentDeep = Color(0xFF7247E8)
val PlumGreen = Color(0xFF35E59A)
val PlumBlue = Color(0xFF3298FF)
val PlumAmber = Color(0xFFFFB536)
val PlumRed = Color(0xFFFF575F)

enum class MainDestination(
    val label: String,
    val icon: ImageVector,
) {
    SESSIONS("Sessions", Icons.Outlined.ViewList),
    ACTIVITY("Activity", Icons.Outlined.ShowChart),
    ANALYTICS("Analytics", Icons.Outlined.Analytics),
    LIBRARY("Library", Icons.Outlined.FolderOpen),
    SETTINGS("Settings", Icons.Outlined.Settings),
}

@Composable
fun PlumBackdrop(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(PlumBackground),
    ) {
        Canvas(Modifier.fillMaxSize()) {
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(Color(0x302B7FFF), Color.Transparent),
                    center = Offset(size.width * .05f, size.height * .28f),
                    radius = size.width * .75f,
                ),
                radius = size.width * .75f,
                center = Offset(size.width * .05f, size.height * .28f),
            )
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(Color(0x2D8F3DFF), Color.Transparent),
                    center = Offset(size.width * .98f, size.height * .04f),
                    radius = size.width * .60f,
                ),
                radius = size.width * .60f,
                center = Offset(size.width * .98f, size.height * .04f),
            )
            val step = 36.dp.toPx()
            var x = 0f
            while (x <= size.width) {
                drawLine(
                    color = Color.White.copy(alpha = .018f),
                    start = Offset(x, 0f),
                    end = Offset(x, size.height),
                    strokeWidth = 1f,
                )
                x += step
            }
            var y = 0f
            while (y <= size.height) {
                drawLine(
                    color = Color.White.copy(alpha = .018f),
                    start = Offset(0f, y),
                    end = Offset(size.width, y),
                    strokeWidth = 1f,
                )
                y += step
            }
        }
        content()
    }
}

@Composable
fun GlassPanel(
    modifier: Modifier = Modifier,
    radius: Dp = 20.dp,
    borderColor: Color = PlumBorder,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(radius))
            .background(PlumSurface)
            .border(1.dp, borderColor, RoundedCornerShape(radius)),
    ) {
        content()
    }
}

@Composable
fun PlumIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = PlumText,
) {
    Box(
        modifier = modifier
            .size(48.dp)
            .clip(CircleShape)
            .background(Color(0xE6212428))
            .border(1.dp, PlumBorderSoft, CircleShape)
            .clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription, tint = tint, modifier = Modifier.size(24.dp))
    }
}

@Composable
fun PlumScreenHeader(
    title: String,
    subtitle: String,
    modifier: Modifier = Modifier,
    live: Boolean = false,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 18.dp, end = 18.dp, top = 14.dp, bottom = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title,
                    color = PlumText,
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = (-0.6).sp,
                )
                if (live) {
                    Box(
                        Modifier
                            .padding(start = 10.dp, end = 7.dp)
                            .size(8.dp)
                            .background(PlumGreen, CircleShape),
                    )
                    Text("Live", color = PlumMuted, fontSize = 14.sp)
                }
            }
            Text(
                subtitle,
                color = PlumMuted,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), content = actions)
    }
}

@Composable
fun PlumBottomBar(
    selected: MainDestination,
    onNavigate: (MainDestination) -> Unit,
    modifier: Modifier = Modifier,
    badgeDestination: MainDestination? = MainDestination.ACTIVITY,
    badgeCount: Int = 0,
) {
    GlassPanel(
        modifier = modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = 14.dp, vertical = 8.dp)
            .height(78.dp),
        radius = 30.dp,
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 4.dp, vertical = 5.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MainDestination.entries.forEach { destination ->
                val active = destination == selected
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(22.dp))
                        .then(
                            if (active) {
                                Modifier
                                    .background(Color(0x3D7C46CC))
                                    .border(1.dp, PlumAccent, RoundedCornerShape(22.dp))
                            } else Modifier
                        )
                        .clickable { onNavigate(destination) }
                        .padding(vertical = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Box {
                        Icon(
                            destination.icon,
                            contentDescription = destination.label,
                            tint = if (active) PlumAccent else PlumMuted,
                            modifier = Modifier.size(23.dp),
                        )
                        if (destination == badgeDestination && badgeCount > 0) {
                            Box(
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .size(15.dp)
                                    .background(PlumAmber, CircleShape),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    badgeCount.coerceAtMost(9).toString(),
                                    color = Color.Black,
                                    fontSize = 9.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    }
                    Text(
                        destination.label,
                        color = if (active) PlumAccent else PlumMuted,
                        fontSize = 11.sp,
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                    )
                }
            }
        }
    }
}

@Composable
fun StatusPill(
    label: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(9.dp))
            .background(color.copy(alpha = .14f))
            .padding(horizontal = 10.dp, vertical = 6.dp),
    ) {
        Text(label, color = color, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun SectionHeading(
    title: String,
    modifier: Modifier = Modifier,
    caption: String? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, color = PlumText, fontSize = 19.sp, fontWeight = FontWeight.Bold)
        if (caption != null) {
            Text("  $caption", color = PlumMuted, fontSize = 14.sp)
        }
        Box(Modifier.weight(1f))
        trailing?.invoke()
    }
}

fun providerColor(provider: CLIProvider): Color = when (provider) {
    CLIProvider.CODEX -> PlumGreen
    CLIProvider.OPENCODE -> PlumAccent
    CLIProvider.PI -> PlumBlue
    CLIProvider.KIMI -> Color(0xFF2582ED)
    CLIProvider.CLAUDE -> PlumAmber
}

fun providerLabel(provider: CLIProvider): String = when (provider) {
    CLIProvider.CODEX -> "CODEX"
    CLIProvider.OPENCODE -> "OPENCODE"
    CLIProvider.PI -> "PI"
    CLIProvider.KIMI -> "KIMI"
    CLIProvider.CLAUDE -> "CLAUDE"
}

fun providerModel(provider: CLIProvider): String = when (provider) {
    CLIProvider.CODEX -> "gpt-5.5"
    CLIProvider.OPENCODE -> "glm-5.1"
    CLIProvider.PI -> "glm-5.1"
    CLIProvider.KIMI -> "kimi-for-coding"
    CLIProvider.CLAUDE -> "sonnet"
}

@Composable
fun Sparkline(
    color: Color,
    values: List<Float>,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier) {
        if (values.size < 2) return@Canvas
        val max = values.maxOrNull()?.coerceAtLeast(1f) ?: 1f
        val min = values.minOrNull() ?: 0f
        val range = (max - min).coerceAtLeast(1f)
        val step = size.width / (values.size - 1)
        val points = values.mapIndexed { index, value ->
            Offset(index * step, size.height - ((value - min) / range) * size.height)
        }
        for (index in 0 until points.lastIndex) {
            drawLine(
                color = color,
                start = points[index],
                end = points[index + 1],
                strokeWidth = 2.dp.toPx(),
                cap = StrokeCap.Round,
            )
        }
        drawPath(
            path = androidx.compose.ui.graphics.Path().apply {
                moveTo(points.first().x, size.height)
                points.forEach { lineTo(it.x, it.y) }
                lineTo(points.last().x, size.height)
                close()
            },
            brush = Brush.verticalGradient(listOf(color.copy(alpha = .24f), Color.Transparent)),
        )
    }
}
