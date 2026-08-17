package com.claudewebui.app.ui.screens.settings

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Extension
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBlue
import com.claudewebui.app.ui.components.common.PlumGreen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CliToolsScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()

    // Load CLI tools when screen appears
    LaunchedEffect(Unit) {
        viewModel.loadCliTools()
    }

    val query = state.cliToolSearchQuery
    val filteredTools = state.cliTools.filter { tool ->
        query.isBlank() ||
            tool.name.contains(query, ignoreCase = true) ||
            tool.description.contains(query, ignoreCase = true)
    }

    // Group by category
    val builtinTools = filteredTools.filter { it.category == CliToolCategory.BUILTIN }
    val customTools = filteredTools.filter { it.category == CliToolCategory.CUSTOM }
    val mcpTools = filteredTools.filter { it.category == CliToolCategory.MCP_PROVIDED }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("CLI Tools", fontWeight = FontWeight.SemiBold) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            // Search bar
            item {
                OutlinedTextField(
                    value = query,
                    onValueChange = viewModel::setCliToolSearchQuery,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    placeholder = { Text("Search tools…") },
                    leadingIcon = {
                        Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(20.dp))
                    },
                    trailingIcon = {
                        AnimatedVisibility(visible = query.isNotBlank(), enter = fadeIn(), exit = fadeOut()) {
                            IconButton(onClick = { viewModel.setCliToolSearchQuery("") }) {
                                Icon(Icons.Default.Close, contentDescription = "Clear", modifier = Modifier.size(18.dp))
                            }
                        }
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = MaterialTheme.colorScheme.primary,
                        focusedLabelColor = MaterialTheme.colorScheme.primary,
                    ),
                )
            }

            // Summary chip
            item {
                val enabledCount = state.cliTools.count { it.enabled }
                val totalCount = state.cliTools.size
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(PlumGreen.copy(alpha = 0.15f))
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    ) {
                        Text(
                            "$enabledCount / $totalCount enabled",
                            style = MaterialTheme.typography.labelSmall,
                            color = PlumGreen,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                }
            }

            // Built-in tools
            if (builtinTools.isNotEmpty()) {
                item {
                    ToolSectionHeader(
                        label = "Built-in",
                        icon = Icons.Default.Build,
                        color = MaterialTheme.colorScheme.primary,
                        count = builtinTools.size,
                    )
                }
                item {
                    ToolGroupCard {
                        builtinTools.forEachIndexed { index, tool ->
                            ToolRow(
                                tool = tool,
                                onToggle = { enabled -> viewModel.toggleTool(tool.id, enabled) },
                            )
                            if (index < builtinTools.lastIndex) {
                                HorizontalDivider(
                                    modifier = Modifier.padding(horizontal = 16.dp),
                                    color = MaterialTheme.colorScheme.outlineVariant,
                                )
                            }
                        }
                    }
                }
            }

            // Custom tools
            if (customTools.isNotEmpty()) {
                item {
                    ToolSectionHeader(
                        label = "Custom",
                        icon = Icons.Default.Terminal,
                        color = PlumBlue,
                        count = customTools.size,
                    )
                }
                item {
                    ToolGroupCard {
                        customTools.forEachIndexed { index, tool ->
                            ToolRow(
                                tool = tool,
                                onToggle = { enabled -> viewModel.toggleTool(tool.id, enabled) },
                            )
                            if (index < customTools.lastIndex) {
                                HorizontalDivider(
                                    modifier = Modifier.padding(horizontal = 16.dp),
                                    color = MaterialTheme.colorScheme.outlineVariant,
                                )
                            }
                        }
                    }
                }
            }

            // MCP-provided tools
            if (mcpTools.isNotEmpty()) {
                item {
                    ToolSectionHeader(
                        label = "MCP-provided",
                        icon = Icons.Default.Extension,
                        color = PlumAmber,
                        count = mcpTools.size,
                    )
                }
                item {
                    ToolGroupCard {
                        mcpTools.forEachIndexed { index, tool ->
                            ToolRow(
                                tool = tool,
                                onToggle = { enabled -> viewModel.toggleTool(tool.id, enabled) },
                            )
                            if (index < mcpTools.lastIndex) {
                                HorizontalDivider(
                                    modifier = Modifier.padding(horizontal = 16.dp),
                                    color = MaterialTheme.colorScheme.outlineVariant,
                                )
                            }
                        }
                    }
                }
            }

            if (filteredTools.isEmpty()) {
                item {
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Icon(
                                Icons.Default.Terminal,
                                contentDescription = null,
                                modifier = Modifier.size(48.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                if (query.isBlank()) "No tools available" else "No tools match \"$query\"",
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

// ── Tool section header ───────────────────────────────────────────────────────

@Composable
private fun ToolSectionHeader(
    label: String,
    icon: ImageVector,
    color: androidx.compose.ui.graphics.Color,
    count: Int,
) {
    Row(
        modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(16.dp))
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = color,
            fontWeight = FontWeight.SemiBold,
        )
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(4.dp))
                .background(color.copy(alpha = 0.1f))
                .padding(horizontal = 6.dp, vertical = 2.dp),
        ) {
            Text(
                count.toString(),
                style = MaterialTheme.typography.labelSmall,
                color = color,
            )
        }
    }
}

// ── Tool group card wrapper ───────────────────────────────────────────────────

@Composable
private fun ToolGroupCard(content: @Composable () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        content()
    }
    Spacer(Modifier.height(8.dp))
}

// ── Tool row ──────────────────────────────────────────────────────────────────

@Composable
private fun ToolRow(
    tool: CliTool,
    onToggle: (Boolean) -> Unit,
) {
    val categoryColor = when (tool.category) {
        CliToolCategory.BUILTIN -> MaterialTheme.colorScheme.primary
        CliToolCategory.CUSTOM -> PlumBlue
        CliToolCategory.MCP_PROVIDED -> PlumAmber
    }

    ListItem(
        headlineContent = {
            Text(
                tool.name,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                color = if (tool.enabled) MaterialTheme.colorScheme.onSurface
                        else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        supportingContent = {
            Text(
                tool.description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
            )
        },
        leadingContent = {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(categoryColor.copy(alpha = if (tool.enabled) 0.15f else 0.07f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    tool.name.take(2),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (tool.enabled) categoryColor else categoryColor.copy(alpha = 0.4f),
                    fontWeight = FontWeight.Bold,
                )
            }
        },
        trailingContent = {
            Switch(
                checked = tool.enabled,
                onCheckedChange = onToggle,
                colors = SwitchDefaults.colors(
                    checkedThumbColor = MaterialTheme.colorScheme.primary,
                    checkedTrackColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.4f),
                ),
            )
        },
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface),
    )
}
