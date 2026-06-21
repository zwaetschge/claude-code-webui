package com.claudewebui.app.ui.components.orchestration

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.TaskRouting
import com.claudewebui.app.data.model.WorkerConfig
import com.claudewebui.app.ui.screens.orchestration.OrchestrationConfigDraft
import com.claudewebui.app.ui.theme.CliProvider
import com.claudewebui.app.ui.theme.ProviderThemes

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrchestrationConfigSheet(
    draft: OrchestrationConfigDraft,
    onDraftChange: (OrchestrationConfigDraft) -> Unit,
    onStart: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        modifier = modifier,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        dragHandle = { BottomSheetDefaults.DragHandle() },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            // Title
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(
                    imageVector = Icons.Filled.Groups,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                )
                Text(
                    text = "Configure Orchestration",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
            }

            HorizontalDivider()

            // Task input
            SectionLabel("Objective")
            OutlinedTextField(
                value = draft.task,
                onValueChange = { onDraftChange(draft.copy(task = it)) },
                placeholder = { Text("What should the AI workers accomplish together?") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
                maxLines = 6,
                shape = RoundedCornerShape(12.dp),
            )

            // Master coordinator
            SectionLabel("Master Coordinator")
            ProviderSelector(
                selected = draft.masterProvider,
                label = "Master",
                onSelect = { onDraftChange(draft.copy(masterProvider = it)) },
            )

            // Workers section
            SectionLabel("Workers (${draft.workers.size})")
            draft.workers.forEachIndexed { index, workerConfig ->
                WorkerConfigRow(
                    index = index,
                    config = workerConfig,
                    onProviderChange = { provider ->
                        val updated = draft.workers.toMutableList().also {
                            it[index] = workerConfig.copy(provider = provider)
                        }
                        onDraftChange(draft.copy(workers = updated))
                    },
                    onRemove = if (draft.workers.size > 2) {
                        {
                            val updated = draft.workers.toMutableList().also { it.removeAt(index) }
                            onDraftChange(draft.copy(workers = updated))
                        }
                    } else null,
                )
            }

            if (draft.workers.size < 6) {
                OutlinedButton(
                    onClick = {
                        val newWorker = WorkerConfig(provider = CLIProvider.CODEX)
                        onDraftChange(draft.copy(workers = draft.workers + newWorker))
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Icon(Icons.Filled.Add, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Add Worker")
                }
            }

            // Strategy
            SectionLabel("Routing Strategy")
            Row(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                StrategyChip(
                    label = "Auto",
                    description = "Master assigns tasks intelligently",
                    selected = draft.strategy == TaskRouting.AUTO,
                    modifier = Modifier.weight(1f),
                    onClick = { onDraftChange(draft.copy(strategy = TaskRouting.AUTO)) },
                )
                StrategyChip(
                    label = "Manual",
                    description = "Fixed task distribution",
                    selected = draft.strategy == TaskRouting.MANUAL,
                    modifier = Modifier.weight(1f),
                    onClick = { onDraftChange(draft.copy(strategy = TaskRouting.MANUAL)) },
                )
            }

            // Parallel execution
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column {
                    Text(
                        text = "Parallel Execution",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        text = "Run workers simultaneously",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(
                    checked = draft.parallelExecution,
                    onCheckedChange = { onDraftChange(draft.copy(parallelExecution = it)) },
                )
            }

            if (draft.parallelExecution) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            text = "Max Parallel Tasks",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Text(
                            text = "${draft.maxParallelTasks}",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                    Slider(
                        value = draft.maxParallelTasks.toFloat(),
                        onValueChange = { onDraftChange(draft.copy(maxParallelTasks = it.toInt())) },
                        valueRange = 1f..6f,
                        steps = 4,
                    )
                }
            }

            Spacer(Modifier.height(4.dp))

            // Start button
            Button(
                onClick = onStart,
                enabled = draft.task.isNotBlank() && draft.workers.isNotEmpty(),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(14.dp),
            ) {
                Icon(Icons.Filled.PlayArrow, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "Start Orchestration",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(bottom = 2.dp),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProviderSelector(
    selected: CLIProvider,
    label: String,
    onSelect: (CLIProvider) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val cliProvider = mapCLIToCliProvider(selected)
    val theme = ProviderThemes.get(cliProvider)
    val providerColor = if (isDark) theme.colorDark else theme.color

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
        modifier = modifier,
    ) {
        OutlinedTextField(
            value = theme.displayName,
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            leadingIcon = {
                Icon(
                    imageVector = theme.icon,
                    contentDescription = null,
                    tint = providerColor,
                    modifier = Modifier.size(20.dp),
                )
            },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable),
            shape = RoundedCornerShape(12.dp),
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            listOf(
                CLIProvider.CODEX,
                CLIProvider.OPENCODE,
                CLIProvider.VIBE,
                CLIProvider.CLAUDE,
            ).forEach { provider ->
                val pTheme = ProviderThemes.get(mapCLIToCliProvider(provider))
                val pColor = if (isDark) pTheme.colorDark else pTheme.color
                DropdownMenuItem(
                    text = { Text(pTheme.displayName) },
                    leadingIcon = {
                        Icon(pTheme.icon, contentDescription = null, tint = pColor)
                    },
                    onClick = {
                        onSelect(provider)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun WorkerConfigRow(
    index: Int,
    config: WorkerConfig,
    onProviderChange: (CLIProvider) -> Unit,
    onRemove: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = modifier.fillMaxWidth(),
    ) {
        Text(
            text = "W${index + 1}",
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.width(28.dp),
        )
        Box(modifier = Modifier.weight(1f)) {
            ProviderSelector(
                selected = config.provider,
                label = "Provider",
                onSelect = onProviderChange,
            )
        }
        if (onRemove != null) {
            IconButton(onClick = onRemove, modifier = Modifier.size(40.dp)) {
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = "Remove worker",
                    tint = MaterialTheme.colorScheme.error,
                )
            }
        } else {
            Spacer(Modifier.width(40.dp))
        }
    }
}

@Composable
private fun StrategyChip(
    label: String,
    description: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val containerColor = if (selected)
        MaterialTheme.colorScheme.primaryContainer
    else
        MaterialTheme.colorScheme.surfaceVariant

    val contentColor = if (selected)
        MaterialTheme.colorScheme.onPrimaryContainer
    else
        MaterialTheme.colorScheme.onSurfaceVariant

    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(containerColor)
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (selected) {
                Icon(
                    imageVector = Icons.Filled.CheckCircle,
                    contentDescription = null,
                    tint = contentColor,
                    modifier = Modifier.size(16.dp),
                )
            }
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                color = contentColor,
            )
        }
        Text(
            text = description,
            style = MaterialTheme.typography.bodySmall,
            color = contentColor.copy(alpha = 0.7f),
        )
    }
}
