package com.claudewebui.app.ui.screens.chat

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
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionMode

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionConfigSheet(
    session: Session,
    availableModels: List<String>,
    onDismiss: () -> Unit,
    onSave: (title: String, provider: CLIProvider, model: String?, mode: SessionMode) -> Unit
) {
    var title by remember { mutableStateOf(session.name) }
    var selectedProvider by remember { mutableStateOf(session.cliProvider) }
    var selectedModel by remember { mutableStateOf<String?>(null) }
    var selectedMode by remember { mutableStateOf(SessionMode.MANUAL) }
    var providerDropdownExpanded by remember { mutableStateOf(false) }
    var modelDropdownExpanded by remember { mutableStateOf(false) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        dragHandle = { BottomSheetDefaults.DragHandle() }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "Session Settings",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold
                )
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = "Close")
                }
            }

            HorizontalDivider()

            // Section: Session Info
            ConfigSection(title = "Session Info") {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Title") },
                    leadingIcon = {
                        Icon(Icons.Default.Edit, contentDescription = null, modifier = Modifier.size(18.dp))
                    },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                InfoRow(
                    label = "Created",
                    value = session.createdAt.take(10),
                    icon = Icons.Default.CalendarToday
                )
                InfoRow(
                    label = "Working Directory",
                    value = session.workingDirectory,
                    icon = Icons.Default.Folder
                )
                InfoRow(
                    label = "Status",
                    value = session.status.name.lowercase().replaceFirstChar { it.uppercaseChar() },
                    icon = Icons.Default.Circle
                )
            }

            HorizontalDivider()

            // Section: Provider
            ConfigSection(title = "CLI Provider") {
                ExposedDropdownMenuBox(
                    expanded = providerDropdownExpanded,
                    onExpandedChange = { providerDropdownExpanded = it }
                ) {
                    OutlinedTextField(
                        value = selectedProvider.displayName,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Provider") },
                        leadingIcon = {
                            Icon(Icons.Default.SmartToy, contentDescription = null, modifier = Modifier.size(18.dp))
                        },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = providerDropdownExpanded) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor()
                    )
                    ExposedDropdownMenu(
                        expanded = providerDropdownExpanded,
                        onDismissRequest = { providerDropdownExpanded = false }
                    ) {
                        CLIProvider.active.forEach { provider ->
                            DropdownMenuItem(
                                text = {
                                    Text(provider.displayName)
                                },
                                onClick = {
                                    selectedProvider = provider
                                    selectedModel = null
                                    providerDropdownExpanded = false
                                },
                                leadingIcon = {
                                    if (provider == selectedProvider) {
                                        Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                                    }
                                }
                            )
                        }
                    }
                }
            }

            // Section: Model
            if (availableModels.isNotEmpty()) {
                HorizontalDivider()
                ConfigSection(title = "Model") {
                    ExposedDropdownMenuBox(
                        expanded = modelDropdownExpanded,
                        onExpandedChange = { modelDropdownExpanded = it }
                    ) {
                        OutlinedTextField(
                            value = selectedModel ?: "Default",
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("Model") },
                            leadingIcon = {
                                Icon(Icons.Default.Memory, contentDescription = null, modifier = Modifier.size(18.dp))
                            },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = modelDropdownExpanded) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .menuAnchor()
                        )
                        ExposedDropdownMenu(
                            expanded = modelDropdownExpanded,
                            onDismissRequest = { modelDropdownExpanded = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text("Default") },
                                onClick = {
                                    selectedModel = null
                                    modelDropdownExpanded = false
                                },
                                leadingIcon = {
                                    if (selectedModel == null) {
                                        Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                                    }
                                }
                            )
                            availableModels.forEach { model ->
                                DropdownMenuItem(
                                    text = { Text(model, style = MaterialTheme.typography.bodySmall) },
                                    onClick = {
                                        selectedModel = model
                                        modelDropdownExpanded = false
                                    },
                                    leadingIcon = {
                                        if (selectedModel == model) {
                                            Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                                        }
                                    }
                                )
                            }
                        }
                    }
                }
            }

            HorizontalDivider()

            // Section: Mode
            ConfigSection(title = "Session Mode") {
                SessionModeSelector(
                    selectedMode = selectedMode,
                    onModeSelected = { selectedMode = it }
                )
            }

            HorizontalDivider()

            // Save button
            Button(
                onClick = {
                    onSave(title, selectedProvider, selectedModel, selectedMode)
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = title.isNotBlank()
            ) {
                Icon(Icons.Default.Save, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Save Changes")
            }
        }
    }
}

@Composable
private fun ConfigSection(
    title: String,
    content: @Composable ColumnScope.() -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.SemiBold
        )
        content()
    }
}

@Composable
private fun InfoRow(
    label: String,
    value: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            icon,
            contentDescription = null,
            modifier = Modifier.size(16.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = "$label:",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(100.dp)
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.weight(1f)
        )
    }
}

@Composable
private fun SessionModeSelector(
    selectedMode: SessionMode,
    onModeSelected: (SessionMode) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SessionModeOption(
            mode = SessionMode.MANUAL,
            label = "Manual",
            description = "Confirm each tool use",
            icon = Icons.Default.TouchApp,
            selected = selectedMode == SessionMode.MANUAL,
            onClick = { onModeSelected(SessionMode.MANUAL) }
        )
        SessionModeOption(
            mode = SessionMode.AUTO_ACCEPT,
            label = "Auto-Accept",
            description = "Accept all tool uses automatically",
            icon = Icons.Default.PlayArrow,
            selected = selectedMode == SessionMode.AUTO_ACCEPT,
            onClick = { onModeSelected(SessionMode.AUTO_ACCEPT) }
        )
        SessionModeOption(
            mode = SessionMode.PLANNING,
            label = "Planning",
            description = "Read-only, no file modifications",
            icon = Icons.Default.Architecture,
            selected = selectedMode == SessionMode.PLANNING,
            onClick = { onModeSelected(SessionMode.PLANNING) }
        )
        SessionModeOption(
            mode = SessionMode.DANGER,
            label = "Danger",
            description = "Skip all confirmations (use with care)",
            icon = Icons.Default.Warning,
            selected = selectedMode == SessionMode.DANGER,
            onClick = { onModeSelected(SessionMode.DANGER) }
        )
    }
}

@Composable
private fun SessionModeOption(
    mode: SessionMode,
    label: String,
    description: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    selected: Boolean,
    onClick: () -> Unit
) {
    val isDanger = mode == SessionMode.DANGER
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(10.dp),
        color = when {
            selected && isDanger -> MaterialTheme.colorScheme.errorContainer
            selected -> MaterialTheme.colorScheme.primaryContainer
            else -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        },
        border = if (selected) ButtonDefaults.outlinedButtonBorder else null
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                icon,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = when {
                    selected && isDanger -> MaterialTheme.colorScheme.onErrorContainer
                    selected -> MaterialTheme.colorScheme.onPrimaryContainer
                    isDanger -> MaterialTheme.colorScheme.error
                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                }
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    color = when {
                        selected && isDanger -> MaterialTheme.colorScheme.onErrorContainer
                        selected -> MaterialTheme.colorScheme.onPrimaryContainer
                        isDanger -> MaterialTheme.colorScheme.error
                        else -> MaterialTheme.colorScheme.onSurface
                    }
                )
                Text(
                    text = description,
                    style = MaterialTheme.typography.labelSmall,
                    color = when {
                        selected && isDanger -> MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.7f)
                        selected -> MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                        else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                    }
                )
            }
            if (selected) {
                Icon(
                    Icons.Default.CheckCircle,
                    contentDescription = "Selected",
                    modifier = Modifier.size(18.dp),
                    tint = when {
                        isDanger -> MaterialTheme.colorScheme.onErrorContainer
                        else -> MaterialTheme.colorScheme.onPrimaryContainer
                    }
                )
            }
        }
    }
}
