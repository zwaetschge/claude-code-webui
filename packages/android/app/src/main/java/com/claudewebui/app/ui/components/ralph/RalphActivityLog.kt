package com.claudewebui.app.ui.components.ralph

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.ui.screens.ralph.RalphActionType
import com.claudewebui.app.ui.screens.ralph.RalphLogEntry
import com.claudewebui.app.ui.theme.SuccessGreen
import java.text.SimpleDateFormat
import java.util.*
import kotlinx.coroutines.launch

@Composable
fun RalphActivityLog(
    entries: List<RalphLogEntry>,
    activeFilter: RalphActionType?,
    onFilterChange: (RalphActionType?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()
    var manualScrolled by remember { mutableStateOf(false) }

    // Auto-scroll to latest unless user has scrolled up manually
    val entryCount = entries.size
    LaunchedEffect(entryCount) {
        if (!manualScrolled && entryCount > 0) {
            coroutineScope.launch {
                listState.animateScrollToItem(entryCount - 1)
            }
        }
    }

    // Show scroll-to-bottom FAB when scrolled up
    val showScrollToBottom by remember {
        derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            val total = listState.layoutInfo.totalItemsCount
            total > 0 && last < total - 3
        }
    }

    val filtered = remember(entries, activeFilter) {
        if (activeFilter == null) entries else entries.filter { it.actionType == activeFilter }
    }

    Column(modifier = modifier) {
        // Filter chips
        LogFilterBar(
            activeFilter = activeFilter,
            onFilterChange = {
                onFilterChange(it)
                manualScrolled = false
            },
        )

        Spacer(Modifier.height(8.dp))

        Box(modifier = Modifier.weight(1f)) {
            if (filtered.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = if (activeFilter != null) "No ${activeFilter.name.lowercase()} entries" else "No activity yet",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                    )
                }
            } else {
                LazyColumn(
                    state = listState,
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    itemsIndexed(
                        items = filtered,
                        key = { _, entry -> entry.id },
                    ) { index, entry ->
                        LogEntryRow(
                            entry = entry,
                            isLatest = index == filtered.lastIndex,
                            modifier = Modifier.animateItem(),
                        )
                    }
                }
            }

            // Scroll to bottom FAB
            androidx.compose.animation.AnimatedVisibility(
                visible = showScrollToBottom,
                enter = fadeIn() + scaleIn(),
                exit = fadeOut() + scaleOut(),
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(8.dp),
            ) {
                SmallFloatingActionButton(
                    onClick = {
                        coroutineScope.launch {
                            listState.animateScrollToItem(filtered.lastIndex)
                        }
                        manualScrolled = false
                    },
                    containerColor = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                ) {
                    Icon(Icons.Filled.KeyboardArrowDown, contentDescription = "Scroll to bottom")
                }
            }
        }
    }
}

@Composable
private fun LogFilterBar(
    activeFilter: RalphActionType?,
    onFilterChange: (RalphActionType?) -> Unit,
) {
    val allTypes = RalphActionType.entries

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(androidx.compose.foundation.rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // "All" chip
        FilterChip(
            selected = activeFilter == null,
            onClick = { onFilterChange(null) },
            label = { Text("All", style = MaterialTheme.typography.labelSmall) },
        )

        allTypes.forEach { type ->
            val (icon, color) = actionTypeIconAndColor(type)
            FilterChip(
                selected = activeFilter == type,
                onClick = { onFilterChange(if (activeFilter == type) null else type) },
                label = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Icon(icon, contentDescription = null, modifier = Modifier.size(12.dp))
                        Text(
                            type.name.lowercase().replaceFirstChar { it.uppercase() },
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                },
                leadingIcon = null,
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = color.copy(alpha = 0.15f),
                    selectedLabelColor = color,
                    selectedLeadingIconColor = color,
                ),
            )
        }
    }
}

@Composable
private fun LogEntryRow(
    entry: RalphLogEntry,
    isLatest: Boolean,
    modifier: Modifier = Modifier,
) {
    val (icon, color) = actionTypeIconAndColor(entry.actionType)
    var expanded by remember { mutableStateOf(false) }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(
                if (isLatest) color.copy(alpha = 0.05f) else Color.Transparent,
            )
            .clickable(
                enabled = entry.detail != null,
                onClick = { expanded = !expanded },
            )
            .padding(horizontal = 10.dp, vertical = 7.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        // Icon
        Box(
            modifier = Modifier
                .size(26.dp)
                .clip(CircleShape)
                .background(color.copy(alpha = 0.12f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = color,
                modifier = Modifier.size(14.dp),
            )
        }

        // Content
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row(
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = entry.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = if (expanded) Int.MAX_VALUE else 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = formatTime(entry.timestamp),
                    style = MaterialTheme.typography.labelSmall,
                    fontSize = 10.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                    modifier = Modifier.padding(start = 6.dp),
                )
            }

            // Detail (expandable)
            AnimatedVisibility(visible = expanded && entry.detail != null) {
                Text(
                    text = entry.detail ?: "",
                    style = MaterialTheme.typography.labelSmall,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(MaterialTheme.colorScheme.surfaceContainerLow)
                        .padding(8.dp),
                )
            }
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

@Composable
private fun actionTypeIconAndColor(type: RalphActionType): Pair<ImageVector, Color> {
    return when (type) {
        RalphActionType.THINKING -> Icons.Filled.Psychology to MaterialTheme.colorScheme.primary
        RalphActionType.TOOL_USE -> Icons.Filled.Build to Color(0xFFF59E0B)
        RalphActionType.FILE_CHANGE -> Icons.Filled.Description to Color(0xFF3B82F6)
        RalphActionType.DECISION -> Icons.Filled.Lightbulb to Color(0xFF8B5CF6)
        RalphActionType.ERROR -> Icons.Filled.Error to MaterialTheme.colorScheme.error
        RalphActionType.INFO -> Icons.Filled.Info to MaterialTheme.colorScheme.onSurfaceVariant
        RalphActionType.ITERATION -> Icons.Filled.Loop to SuccessGreen
    }
}

private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

private fun formatTime(timestamp: Long): String =
    timeFormat.format(Date(timestamp))
