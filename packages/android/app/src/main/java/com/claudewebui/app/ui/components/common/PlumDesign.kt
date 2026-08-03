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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.Scaffold
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
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
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
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
import com.claudewebui.app.ui.theme.LocalPlumPalette

// Resolved through the active palette rather than hardcoded, so the whole app
// re-themes without touching the ~340 call sites that read these names.
// See ui/theme/PlumPalette.kt for the palettes themselves.
val PlumBackground: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.background
val PlumSurface: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.surface
val PlumSurfaceStrong: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.surfaceStrong
val PlumBorder: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.border
val PlumBorderSoft: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.borderSoft
val PlumText: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.text
val PlumMuted: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.muted
val PlumAccent: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.accent
val PlumAccentDeep: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.accentDeep
val PlumGreen: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.green
val PlumBlue: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.blue
val PlumAmber: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.amber
val PlumRed: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.red
val PlumSubtleFill: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.subtleFill
val PlumTrackFill: Color @Composable @ReadOnlyComposable get() = LocalPlumPalette.current.trackFill

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
    val palette = LocalPlumPalette.current
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(palette.background),
    ) {
        Canvas(Modifier.fillMaxSize()) {
            if (palette.glowPrimary != Color.Transparent) {
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(palette.glowPrimary, Color.Transparent),
                        center = Offset(size.width * .05f, size.height * .28f),
                        radius = size.width * .75f,
                    ),
                    radius = size.width * .75f,
                    center = Offset(size.width * .05f, size.height * .28f),
                )
            }
            if (palette.glowSecondary != Color.Transparent) {
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(palette.glowSecondary, Color.Transparent),
                        center = Offset(size.width * .98f, size.height * .04f),
                        radius = size.width * .60f,
                    ),
                    radius = size.width * .60f,
                    center = Offset(size.width * .98f, size.height * .04f),
                )
            }
            if (palette.grid != Color.Transparent) {
                val step = 36.dp.toPx()
                var x = 0f
                while (x <= size.width) {
                    drawLine(palette.grid, Offset(x, 0f), Offset(x, size.height), strokeWidth = 1f)
                    x += step
                }
                var y = 0f
                while (y <= size.height) {
                    drawLine(palette.grid, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
                    y += step
                }
            }
        }
        content()
    }
}

/**
 * Frosted glass surface, matching the WebUI's `.glass-panel`.
 *
 * Four things together make it read as glass rather than as a flat card: a
 * very translucent fill so the atmospheric backdrop shows through, a slight
 * top-to-bottom gradient, a soft drop shadow that lifts it off the background,
 * and a bright hairline along the top edge standing in for the CSS
 * `inset 0 1px 0` highlight. The backdrop itself is procedural and
 * low-frequency, so it needs no blur to look diffused behind the glass.
 */
@Composable
fun GlassPanel(
    modifier: Modifier = Modifier,
    radius: Dp = 20.dp,
    borderColor: Color = PlumBorder,
    content: @Composable () -> Unit,
) {
    val palette = LocalPlumPalette.current
    val shape = RoundedCornerShape(radius)
    Box(
        modifier = modifier
            .shadow(
                elevation = if (palette.glassShadow == Color.Transparent) 0.dp else 10.dp,
                shape = shape,
                ambientColor = palette.glassShadow,
                spotColor = palette.glassShadow,
            )
            .clip(shape)
            .background(
                Brush.verticalGradient(
                    listOf(palette.glassFillTop, palette.glassFill),
                ),
            )
            .border(1.dp, borderColor, shape),
    ) {
        if (palette.glassHighlight != Color.Transparent) {
            // The lit top edge. Inset horizontally so it fades out before the
            // corner radius, the way a real bevel catches light.
            Canvas(Modifier.matchParentSize()) {
                val inset = radius.toPx() * .55f
                drawLine(
                    brush = Brush.horizontalGradient(
                        0f to Color.Transparent,
                        .5f to palette.glassHighlight,
                        1f to Color.Transparent,
                    ),
                    start = Offset(inset, 1f),
                    end = Offset(size.width - inset, 1f),
                    strokeWidth = 1.dp.toPx(),
                )
            }
        }
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
            .background(LocalPlumPalette.current.controlSurface)
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

/**
 * A vertical navigation rail for wide windows.
 *
 * On the unfolded Fold and on a tablet the bottom bar sits far from the hands
 * and eats vertical space that a mostly-vertical app needs; a side rail is the
 * Material answer and keeps the destinations reachable near the edge.
 */
@Composable
fun PlumNavRail(
    selected: MainDestination,
    onNavigate: (MainDestination) -> Unit,
    modifier: Modifier = Modifier,
    badgeDestination: MainDestination? = MainDestination.ACTIVITY,
    badgeCount: Int = 0,
) {
    // Five labelled items need roughly 350dp; below that the labels go and the
    // rail narrows to icons so every destination still fits without scrolling.
    val short = isShortWindow()
    GlassPanel(
        modifier = modifier
            .fillMaxHeight()
            .width(if (short) 68.dp else 96.dp)
            .padding(start = 10.dp, top = 10.dp, bottom = 10.dp),
        radius = 26.dp,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .navigationBarsPadding()
                .padding(vertical = if (short) 6.dp else 12.dp, horizontal = 6.dp),
            verticalArrangement = Arrangement.spacedBy(if (short) 2.dp else 6.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            MainDestination.entries.forEach { destination ->
                val active = destination == selected
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(20.dp))
                        .then(
                            if (active) {
                                Modifier
                                    .background(LocalPlumPalette.current.selectionTint)
                                    .border(1.dp, PlumAccent, RoundedCornerShape(20.dp))
                            } else Modifier
                        )
                        .clickable { onNavigate(destination) }
                        .padding(vertical = if (short) 7.dp else 10.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
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
                    if (!short) {
                        Text(
                            destination.label,
                            color = if (active) PlumAccent else PlumMuted,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * Picks the navigation affordance that fits the window: a side rail once there
 * is width to spare, the bottom bar otherwise. Screens hand over their content
 * and get the correct insets either way.
 */
@Composable
fun PlumNavScaffold(
    selected: MainDestination,
    onNavigate: (MainDestination) -> Unit,
    badgeCount: Int = 0,
    floatingActionButton: @Composable (() -> Unit)? = null,
    content: @Composable (PaddingValues) -> Unit,
) {
    if (isTabletWidth()) {
        Row(Modifier.fillMaxSize()) {
            PlumNavRail(selected, onNavigate, badgeCount = badgeCount)
            // Without a Scaffold there is nothing applying window insets, so
            // the content would slide under the status bar.
            Box(Modifier.weight(1f).statusBarsPadding()) {
                content(PaddingValues(0.dp))
                // No bottom bar to sit above, so the action floats in the
                // content corner itself.
                floatingActionButton?.let { fab ->
                    Box(
                        Modifier
                            .align(Alignment.BottomEnd)
                            .navigationBarsPadding()
                            .padding(end = 22.dp, bottom = 22.dp),
                    ) { fab() }
                }
            }
        }
    } else {
        Scaffold(
            containerColor = Color.Transparent,
            bottomBar = { PlumBottomBar(selected, onNavigate, badgeCount = badgeCount) },
            floatingActionButton = { floatingActionButton?.invoke() },
            content = content,
        )
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
    val short = isShortWindow()
    GlassPanel(
        modifier = modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = 14.dp, vertical = if (short) 4.dp else 8.dp)
            .height(if (short) 54.dp else 78.dp),
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
                                    .background(LocalPlumPalette.current.selectionTint)
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
                    if (!short) Text(
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

// Composable because the brand tints now resolve through the active palette.
@Composable
@ReadOnlyComposable
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
