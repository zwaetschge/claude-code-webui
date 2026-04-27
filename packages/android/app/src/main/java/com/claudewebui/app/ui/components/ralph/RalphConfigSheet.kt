package com.claudewebui.app.ui.components.ralph

import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.claudewebui.app.ui.screens.ralph.RalphConfigDraft

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RalphConfigSheet(
    draft: RalphConfigDraft,
    onDraftChange: (RalphConfigDraft) -> Unit,
    onStart: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var showConfirmation by remember { mutableStateOf(false) }

    if (showConfirmation) {
        RalphStartConfirmationDialog(
            idea = draft.idea,
            dangerMode = draft.autoApprovePermissions,
            onConfirm = {
                showConfirmation = false
                onStart()
            },
            onDismiss = { showConfirmation = false },
        )
    }

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
                    imageVector = Icons.Filled.SmartToy,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                )
                Column {
                    Text(
                        text = "Configure Ralph",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = "Autonomous AI agent",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            HorizontalDivider()

            // Objective
            SectionLabel("Objective / Goal")
            OutlinedTextField(
                value = draft.idea,
                onValueChange = { onDraftChange(draft.copy(idea = it)) },
                placeholder = { Text("Describe what Ralph should accomplish autonomously…") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
                maxLines = 6,
                shape = RoundedCornerShape(12.dp),
                leadingIcon = {
                    Icon(
                        Icons.Filled.Flag,
                        contentDescription = null,
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                },
            )

            // Constraints
            SectionLabel("Constraints (optional)")
            OutlinedTextField(
                value = draft.constraints,
                onValueChange = { onDraftChange(draft.copy(constraints = it)) },
                placeholder = { Text("What should Ralph NOT do? (e.g., don't delete files, no network calls)") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
                maxLines = 4,
                shape = RoundedCornerShape(12.dp),
                leadingIcon = {
                    Icon(
                        Icons.Filled.Block,
                        contentDescription = null,
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                },
            )

            // Provider selection
            SectionLabel("AI Provider")
            ProviderPickerRow(
                selected = draft.cliProvider,
                onSelect = { onDraftChange(draft.copy(cliProvider = it)) },
            )

            // Iterations per task slider
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    SectionLabel("Max Iterations / Task")
                    Text(
                        text = "${draft.maxIterationsPerTask}",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                Slider(
                    value = draft.maxIterationsPerTask.toFloat(),
                    onValueChange = { onDraftChange(draft.copy(maxIterationsPerTask = it.toInt())) },
                    valueRange = 3f..30f,
                    steps = 26,
                )
            }

            // Total iterations slider
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    SectionLabel("Max Total Iterations")
                    Text(
                        text = "${draft.maxTotalIterations}",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                Slider(
                    value = draft.maxTotalIterations.toFloat(),
                    onValueChange = { onDraftChange(draft.copy(maxTotalIterations = it.toInt())) },
                    valueRange = 10f..200f,
                    steps = 18,
                )
            }

            // Auto-approve toggle
            Card(
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(
                    containerColor = if (draft.autoApprovePermissions)
                        MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f)
                    else
                        MaterialTheme.colorScheme.surfaceVariant,
                ),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.weight(1f),
                    ) {
                        Icon(
                            imageVector = if (draft.autoApprovePermissions)
                                Icons.Filled.Warning
                            else
                                Icons.Filled.Security,
                            contentDescription = null,
                            tint = if (draft.autoApprovePermissions)
                                MaterialTheme.colorScheme.error
                            else
                                MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Column {
                            Text(
                                text = "Auto-approve Permissions",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Medium,
                            )
                            Text(
                                text = if (draft.autoApprovePermissions)
                                    "Danger mode — skips all permission prompts"
                                else
                                    "Ralph will pause and ask before sensitive actions",
                                style = MaterialTheme.typography.bodySmall,
                                color = if (draft.autoApprovePermissions)
                                    MaterialTheme.colorScheme.error.copy(alpha = 0.8f)
                                else
                                    MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    Switch(
                        checked = draft.autoApprovePermissions,
                        onCheckedChange = { onDraftChange(draft.copy(autoApprovePermissions = it)) },
                        colors = SwitchDefaults.colors(
                            checkedTrackColor = MaterialTheme.colorScheme.error,
                            checkedThumbColor = MaterialTheme.colorScheme.onError,
                        ),
                    )
                }
            }

            Spacer(Modifier.height(4.dp))

            // Start button
            Button(
                onClick = { showConfirmation = true },
                enabled = draft.idea.isNotBlank(),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(14.dp),
                colors = if (draft.autoApprovePermissions)
                    ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    )
                else
                    ButtonDefaults.buttonColors(),
            ) {
                Icon(Icons.Filled.PlayArrow, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(
                    text = if (draft.autoApprovePermissions) "Start Ralph (Danger Mode)" else "Start Ralph",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun ProviderPickerRow(
    selected: String,
    onSelect: (String) -> Unit,
) {
    val providers = listOf("claude", "gemini", "codex", "glm", "kimi")
    val labels = mapOf(
        "claude" to "Claude",
        "gemini" to "Gemini",
        "codex" to "Codex",
        "glm" to "GLM",
        "kimi" to "Kimi",
    )

    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(androidx.compose.foundation.rememberScrollState()),
    ) {
        providers.forEach { provider ->
            val isSelected = selected == provider
            FilterChip(
                selected = isSelected,
                onClick = { onSelect(provider) },
                label = { Text(labels[provider] ?: provider) },
            )
        }
    }
}

@Composable
private fun RalphStartConfirmationDialog(
    idea: String,
    dangerMode: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                imageVector = if (dangerMode) Icons.Filled.Warning else Icons.Filled.SmartToy,
                contentDescription = null,
                tint = if (dangerMode) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
            )
        },
        title = {
            Text(
                text = if (dangerMode) "Start in Danger Mode?" else "Start Ralph?",
                fontWeight = FontWeight.Bold,
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "Ralph will autonomously work on:",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = "\"${idea.take(100)}${if (idea.length > 100) "…" else ""}\"",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                )
                if (dangerMode) {
                    Text(
                        text = "⚠ Danger mode is active — Ralph will skip all permission prompts and may modify files, run commands, or make network calls without asking.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onConfirm,
                colors = if (dangerMode) ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.error,
                ) else ButtonDefaults.buttonColors(),
            ) {
                Text("Start")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}
