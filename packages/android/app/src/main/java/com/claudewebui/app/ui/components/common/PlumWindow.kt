package com.claudewebui.app.ui.components.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Coarse width buckets, following the Material window size classes.
 *
 * The app was laid out for a phone, so on a tablet every list row stretched the
 * full width and the five-item nav bar spanned the whole screen. These buckets
 * let screens spend the extra width on more columns instead of longer lines.
 */
enum class WindowWidth { COMPACT, MEDIUM, EXPANDED }

@Composable
@ReadOnlyComposable
fun rememberWindowWidth(): WindowWidth {
    val widthDp = LocalConfiguration.current.screenWidthDp
    return when {
        widthDp >= 840 -> WindowWidth.EXPANDED
        widthDp >= 600 -> WindowWidth.MEDIUM
        else -> WindowWidth.COMPACT
    }
}

/**
 * Height buckets. Needed because width alone misreads the short-and-wide
 * windows: the Fold 8 Ultra's cover screen in landscape is roughly 840x360dp,
 * so it is "expanded" by width while having barely any vertical room, and a
 * 78dp navigation bar there would eat a fifth of the screen.
 */
enum class WindowHeight { COMPACT, MEDIUM, EXPANDED }

@Composable
@ReadOnlyComposable
fun rememberWindowHeight(): WindowHeight {
    val heightDp = LocalConfiguration.current.screenHeightDp
    return when {
        heightDp >= 900 -> WindowHeight.EXPANDED
        heightDp >= 480 -> WindowHeight.MEDIUM
        else -> WindowHeight.COMPACT
    }
}

/** True when vertical space is tight enough to drop nav labels and padding. */
@Composable
@ReadOnlyComposable
fun isShortWindow(): Boolean = rememberWindowHeight() == WindowHeight.COMPACT

/** True from the tablet breakpoint upwards. */
@Composable
@ReadOnlyComposable
fun isTabletWidth(): Boolean = rememberWindowWidth() != WindowWidth.COMPACT

/**
 * How many list columns to use at the current width. Text stays readable at
 * roughly 55-70 characters per line, so wide screens get columns rather than
 * one very long measure.
 */
@Composable
@ReadOnlyComposable
fun listColumns(): Int = when (rememberWindowWidth()) {
    // Two columns need real width. At MEDIUM (e.g. the unfolded Fold at
    // ~609dp, minus a 96dp rail) each cell came out around 250dp, which
    // truncated every second entry name — one column reads far better there.
    WindowWidth.EXPANDED -> 2
    WindowWidth.MEDIUM -> 1
    WindowWidth.COMPACT -> 1
}

/** How many metric tiles fit per row. */
@Composable
@ReadOnlyComposable
fun metricColumns(): Int = when (rememberWindowWidth()) {
    WindowWidth.EXPANDED -> 4
    WindowWidth.MEDIUM -> 2
    WindowWidth.COMPACT -> 2
}

/**
 * Width of a category chip. The strip holds six of them and must not overflow;
 * at MEDIUM the rail already claims 96dp, so the chips have to stay narrow.
 */
@Composable
@ReadOnlyComposable
fun chipWidth(): Dp = when (rememberWindowWidth()) {
    WindowWidth.EXPANDED -> 84.dp
    WindowWidth.MEDIUM -> 68.dp
    WindowWidth.COMPACT -> 62.dp
}

/**
 * Caps content width and centres it, so a full-screen tablet window doesn't
 * stretch cards to an unreadable measure.
 */
@Composable
fun PlumContentWidth(
    modifier: Modifier = Modifier,
    max: Dp = 1100.dp,
    content: @Composable () -> Unit,
) {
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
        Box(Modifier.widthIn(max = max)) { content() }
    }
}

/**
 * Lays [items] out in [columns] columns, padding the final row with empty
 * weight so the last cell doesn't stretch across the leftover space.
 */
@Composable
fun <T> PlumGridRow(
    items: List<T>,
    columns: Int,
    spacing: Dp = 10.dp,
    itemContent: @Composable RowScope.(T) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(spacing)) {
        items.forEach { item -> itemContent(item) }
        repeat(columns - items.size) { Box(Modifier.weight(1f)) }
    }
}
