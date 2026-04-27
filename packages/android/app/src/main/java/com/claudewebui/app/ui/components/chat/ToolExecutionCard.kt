package com.claudewebui.app.ui.components.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.*
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.ToolExecution
import com.claudewebui.app.data.model.ToolStatus
import com.claudewebui.app.ui.theme.JetBrainsMonoFamily
import kotlinx.serialization.json.*

@Composable
fun ToolExecutionCard(
    tool: ToolExecution,
    modifier: Modifier = Modifier,
    initiallyExpanded: Boolean = false,
) {
    var expanded by remember(tool.toolId) {
        mutableStateOf(initiallyExpanded || tool.status == ToolStatus.STARTED)
    }

    val chevronAngle by animateFloatAsState(
        targetValue = if (expanded) 180f else 0f,
        animationSpec = tween(200),
        label = "chevron",
    )

    val toolConfig = toolConfig(tool.toolName)
    val statusColor = statusColor(tool.status)

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .animateContentSize(),
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        tonalElevation = 0.dp,
        border = androidx.compose.foundation.BorderStroke(
            width = 1.dp,
            color = statusColor.copy(alpha = 0.3f),
        ),
    ) {
        Column {
            // Header row — always visible
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { expanded = !expanded }
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // Tool icon
                Icon(
                    imageVector = toolConfig.icon,
                    contentDescription = tool.toolName,
                    tint = toolConfig.color,
                    modifier = Modifier.size(16.dp),
                )

                // Tool name
                Text(
                    text = toolConfig.label,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )

                // File path or command preview (if available)
                toolConfig.extractPreview(tool)?.let { preview ->
                    Text(
                        text = preview,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        modifier = Modifier.weight(2f),
                        fontFamily = JetBrainsMonoFamily,
                        fontSize = 11.sp,
                    )
                }

                // Status indicator
                StatusBadge(status = tool.status, color = statusColor)

                // Expand/collapse icon
                Icon(
                    imageVector = Icons.Filled.KeyboardArrowDown,
                    contentDescription = if (expanded) "Collapse" else "Expand",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .size(16.dp)
                        .rotate(chevronAngle),
                )
            }

            // Expanded content
            AnimatedVisibility(
                visible = expanded,
                enter = expandVertically(),
                exit = shrinkVertically(),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            color = MaterialTheme.colorScheme.surfaceContainerHighest,
                            shape = RoundedCornerShape(bottomStart = 8.dp, bottomEnd = 8.dp),
                        )
                ) {
                    // Divider
                    HorizontalDivider(
                        color = MaterialTheme.colorScheme.outlineVariant,
                        thickness = 0.5.dp,
                    )

                    // Input section
                    tool.input?.let { input ->
                        ExpandedSection(
                            label = "Input",
                            content = formatJson(input),
                            isCode = true,
                        )
                    }

                    // Result section
                    tool.result?.let { result ->
                        if (result.isNotBlank()) {
                            ExpandedSection(
                                label = "Output",
                                content = result,
                                isCode = true,
                                isSuccess = true,
                            )
                        }
                    }

                    // Error section
                    tool.error?.let { error ->
                        ExpandedSection(
                            label = "Error",
                            content = error,
                            isCode = false,
                            isError = true,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ExpandedSection(
    label: String,
    content: String,
    isCode: Boolean,
    isSuccess: Boolean = false,
    isError: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val textColor = when {
        isError -> MaterialTheme.colorScheme.error
        isSuccess -> MaterialTheme.colorScheme.onSurfaceVariant
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            fontSize = 10.sp,
            fontWeight = FontWeight.SemiBold,
        )

        val displayContent = content.take(2000).let {
            if (content.length > 2000) "$it\n… (truncated)" else it
        }

        Text(
            text = displayContent,
            style = MaterialTheme.typography.bodySmall.copy(
                fontFamily = if (isCode) JetBrainsMonoFamily else null,
                fontSize = 12.sp,
                lineHeight = 18.sp,
                color = textColor,
            ),
        )
    }
}

@Composable
private fun StatusBadge(
    status: ToolStatus,
    color: Color,
    modifier: Modifier = Modifier,
) {
    when (status) {
        ToolStatus.STARTED -> {
            val infiniteTransition = rememberInfiniteTransition(label = "spinner")
            val rotation by infiniteTransition.animateFloat(
                initialValue = 0f,
                targetValue = 360f,
                animationSpec = infiniteRepeatable(
                    animation = tween(800, easing = LinearEasing)
                ),
                label = "rotation",
            )
            Icon(
                imageVector = Icons.Outlined.Refresh,
                contentDescription = "Running",
                tint = color,
                modifier = modifier
                    .size(14.dp)
                    .rotate(rotation),
            )
        }
        ToolStatus.COMPLETED -> {
            Icon(
                imageVector = Icons.Filled.CheckCircle,
                contentDescription = "Completed",
                tint = color,
                modifier = modifier.size(14.dp),
            )
        }
        ToolStatus.ERROR -> {
            Icon(
                imageVector = Icons.Filled.Cancel,
                contentDescription = "Error",
                tint = color,
                modifier = modifier.size(14.dp),
            )
        }
    }
}

// ── Tool Config ───────────────────────────────────────────────────────────────

private data class ToolConfig(
    val label: String,
    val icon: ImageVector,
    val color: Color,
    val extractPreview: (ToolExecution) -> String?,
)

private fun toolConfig(toolName: String): ToolConfig {
    val name = toolName.lowercase()
    return when {
        name == "read" -> ToolConfig(
            label = "Read File",
            icon = Icons.Outlined.Description,
            color = Color(0xFF3B82F6),
            extractPreview = { tool -> extractStringField(tool.input, "file_path") },
        )
        name == "write" -> ToolConfig(
            label = "Write File",
            icon = Icons.Outlined.Edit,
            color = Color(0xFF22C55E),
            extractPreview = { tool -> extractStringField(tool.input, "file_path") },
        )
        name == "edit" || name == "multiedit" -> ToolConfig(
            label = if (name == "multiedit") "Multi-Edit" else "Edit File",
            icon = Icons.Outlined.DriveFileRenameOutline,
            color = Color(0xFFF59E0B),
            extractPreview = { tool -> extractStringField(tool.input, "file_path") },
        )
        name == "bash" -> ToolConfig(
            label = "Bash",
            icon = Icons.Outlined.Terminal,
            color = Color(0xFF8B5CF6),
            extractPreview = { tool ->
                extractStringField(tool.input, "command")?.take(60)
            },
        )
        name == "glob" -> ToolConfig(
            label = "Find Files",
            icon = Icons.Outlined.FolderOpen,
            color = Color(0xFF06B6D4),
            extractPreview = { tool -> extractStringField(tool.input, "pattern") },
        )
        name == "grep" -> ToolConfig(
            label = "Search",
            icon = Icons.Outlined.Search,
            color = Color(0xFFEC4899),
            extractPreview = { tool -> extractStringField(tool.input, "pattern") },
        )
        name == "agent" || name.contains("agent") -> ToolConfig(
            label = "Agent",
            icon = Icons.Outlined.Psychology,
            color = Color(0xFFCC785C),
            extractPreview = { tool ->
                extractStringField(tool.input, "description")
                    ?: extractStringField(tool.input, "task")
            },
        )
        name == "todowrite" -> ToolConfig(
            label = "Update Todos",
            icon = Icons.Outlined.Checklist,
            color = Color(0xFF10B981),
            extractPreview = { _ -> null },
        )
        name == "websearch" -> ToolConfig(
            label = "Web Search",
            icon = Icons.Outlined.TravelExplore,
            color = Color(0xFF3B82F6),
            extractPreview = { tool -> extractStringField(tool.input, "query") },
        )
        name == "webfetch" -> ToolConfig(
            label = "Fetch URL",
            icon = Icons.Outlined.Language,
            color = Color(0xFF3B82F6),
            extractPreview = { tool -> extractStringField(tool.input, "url") },
        )
        else -> ToolConfig(
            label = toolName,
            icon = Icons.Outlined.Build,
            color = Color(0xFF6B7280),
            extractPreview = { _ -> null },
        )
    }
}

@Composable
private fun statusColor(status: ToolStatus): Color = when (status) {
    ToolStatus.STARTED -> MaterialTheme.colorScheme.tertiary
    ToolStatus.COMPLETED -> Color(0xFF22C55E)
    ToolStatus.ERROR -> MaterialTheme.colorScheme.error
}

// ── JSON Helpers ──────────────────────────────────────────────────────────────

private fun extractStringField(element: kotlinx.serialization.json.JsonElement?, field: String): String? {
    return try {
        element?.jsonObject?.get(field)?.jsonPrimitive?.content
    } catch (_: Exception) { null }
}

private fun formatJson(element: kotlinx.serialization.json.JsonElement): String {
    return try {
        Json { prettyPrint = true }.encodeToString(JsonElement.serializer(), element)
    } catch (_: Exception) {
        element.toString()
    }
}
