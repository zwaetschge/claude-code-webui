package com.claudewebui.app.ui.components.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.TodoItem
import com.claudewebui.app.data.model.TodoStatus
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import com.claudewebui.app.ui.components.common.PlumText

/**
 * Compact run status above the message list: how far the agent's task list has
 * come, how many follow-ups are queued, and how full the context window is.
 * Mirrors the WebUI's TaskWorkbench header; collapsed it is a single line, and
 * tapping expands the full todo list.
 *
 * Renders nothing when there is neither a task list, a queue, nor context
 * pressure worth warning about — an empty strip would only cost chat space.
 */
@Composable
fun TaskWorkbenchStrip(
    todos: List<TodoItem>,
    queuedCount: Int,
    contextUsedPercent: Double,
    modifier: Modifier = Modifier,
) {
    val contextHot = contextUsedPercent >= 70.0
    if (todos.isEmpty() && queuedCount == 0 && !contextHot) return

    var expanded by remember { mutableStateOf(false) }
    val done = todos.count { it.status == TodoStatus.COMPLETED }
    val active = todos.firstOrNull { it.status == TodoStatus.IN_PROGRESS }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(PlumSurfaceStrong)
            .border(1.dp, PlumBorder, RoundedCornerShape(14.dp))
            .clickable(enabled = todos.isNotEmpty()) { expanded = !expanded }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (todos.isNotEmpty()) {
                Text(
                    "Tasks $done/${todos.size}",
                    style = MaterialTheme.typography.labelMedium,
                    color = PlumAccent,
                )
                Text(
                    "  ·  ",
                    style = MaterialTheme.typography.labelMedium,
                    color = PlumMuted,
                )
            }
            Text(
                active?.let { it.activeForm ?: it.content }
                    ?: if (queuedCount > 0) "Waiting" else "Context",
                style = MaterialTheme.typography.labelMedium,
                color = PlumText,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (queuedCount > 0) {
                Text(
                    "$queuedCount queued",
                    style = MaterialTheme.typography.labelSmall,
                    color = PlumMuted,
                )
            }
            if (contextHot) {
                Text(
                    "  ${contextUsedPercent.toInt()}% ctx",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (contextUsedPercent >= 90.0) Color(0xFFEF4444) else Color(0xFFF59E0B),
                )
            }
        }

        if (todos.isNotEmpty()) {
            LinearProgressIndicator(
                progress = { done.toFloat() / todos.size.coerceAtLeast(1) },
                modifier = Modifier.fillMaxWidth().height(3.dp),
                color = PlumAccent,
                trackColor = PlumBorder,
            )
        }

        AnimatedVisibility(
            visible = expanded && todos.isNotEmpty(),
            enter = expandVertically() + fadeIn(),
            exit = shrinkVertically() + fadeOut(),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                todos.forEach { todo ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            when (todo.status) {
                                TodoStatus.COMPLETED -> "✓"
                                TodoStatus.IN_PROGRESS -> "▸"
                                TodoStatus.PENDING -> "○"
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = when (todo.status) {
                                TodoStatus.COMPLETED -> Color(0xFF22C55E)
                                TodoStatus.IN_PROGRESS -> PlumAccent
                                TodoStatus.PENDING -> PlumMuted
                            },
                            modifier = Modifier.padding(end = 6.dp),
                        )
                        Text(
                            todo.content,
                            style = MaterialTheme.typography.labelSmall,
                            color = if (todo.status == TodoStatus.COMPLETED) PlumMuted else PlumText,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}
