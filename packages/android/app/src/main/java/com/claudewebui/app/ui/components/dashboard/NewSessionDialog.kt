package com.claudewebui.app.ui.components.dashboard

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.Category
import com.claudewebui.app.data.model.SessionTemplate
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.SessionMode
import com.claudewebui.app.data.repository.SessionLaunchSetup
import com.claudewebui.app.data.repository.SessionPreset
import com.claudewebui.app.data.repository.DEFAULT_SESSION_PRESETS
import com.claudewebui.app.ui.components.common.BadgeSize
import com.claudewebui.app.ui.components.common.ProviderBadge
import com.claudewebui.app.ui.theme.CliProvider
import com.claudewebui.app.ui.theme.ClaudeWebUITheme
import com.claudewebui.app.ui.theme.ProviderThemes

// ── NewSessionDialog ──────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun NewSessionDialog(
    categories: List<Category>,
    providers: List<CLIProvider> = CLIProvider.active,
    presets: List<SessionPreset> = DEFAULT_SESSION_PRESETS,
    templates: List<SessionTemplate> = emptyList(),
    lastSetup: SessionLaunchSetup = SessionLaunchSetup(),
    isCreating: Boolean = false,
    creationError: String? = null,
    onDismiss: () -> Unit,
    onCreate: (
        name: String,
        provider: CLIProvider,
        workingDirectory: String?,
        mode: SessionMode,
        categoryId: String?,
    ) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var sessionName by remember { mutableStateOf("") }
    var workingDirectory by remember { mutableStateOf(lastSetup.workingDirectory.orEmpty()) }
    var selectedProvider by remember {
        mutableStateOf<CLIProvider?>(lastSetup.provider.takeIf { it in providers } ?: providers.firstOrNull())
    }
    var selectedMode by remember { mutableStateOf(lastSetup.mode) }
    var selectedCategoryId by remember { mutableStateOf(lastSetup.categoryId) }
    var showAdvanced by remember { mutableStateOf(false) }
    var categoryMenuExpanded by remember { mutableStateOf(false) }

    LaunchedEffect(providers) {
        val currentProvider = selectedProvider
        if (currentProvider == null || currentProvider !in providers) {
            selectedProvider = providers.firstOrNull()
        }
    }

    val availableProvider = selectedProvider?.takeIf { it in providers }
    val createSession: () -> Unit = {
        if (availableProvider != null) {
            onCreate(
                sessionName,
                availableProvider,
                workingDirectory.trim().takeIf { it.isNotEmpty() },
                selectedMode,
                selectedCategoryId,
            )
        }
    }

    ModalBottomSheet(
        onDismissRequest = { if (!isCreating) onDismiss() },
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
        dragHandle = {
            Box(
                modifier = Modifier
                    .padding(top = 12.dp, bottom = 4.dp)
                    .size(width = 36.dp, height = 4.dp)
                    .clip(RoundedCornerShape(50))
                    .background(MaterialTheme.colorScheme.outlineVariant),
            )
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
        ) {
            // ── Header ───────────────────────────────────────────────────────
            Text(
                text = "New Session",
                style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = "Choose a provider to get started",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(modifier = Modifier.height(20.dp))

            // ── Provider Grid ────────────────────────────────────────────────
            SectionLabel("Provider")
            Spacer(modifier = Modifier.height(10.dp))

            if (providers.isEmpty()) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.surfaceContainer,
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text(
                        text = "No providers are enabled. Enable one in Settings to start a session.",
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    providers.forEach { provider ->
                        ProviderOption(
                            provider = provider,
                            isSelected = selectedProvider == provider,
                            onClick = { selectedProvider = provider },
                        )
                    }
                }
            }

            // ── Templates ────────────────────────────────────────────────────
            // A saved template fills provider, mode and directory in one tap;
            // everything stays editable afterwards.
            if (templates.isNotEmpty()) {
                Spacer(modifier = Modifier.height(20.dp))
                SectionLabel("Start from a template")
                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    templates.forEach { template ->
                        AssistChip(
                            onClick = {
                                template.cliProvider
                                    ?.let { CLIProvider.fromId(it) }
                                    ?.takeIf { it in providers }
                                    ?.let { selectedProvider = it }
                                template.mode
                                    ?.let { modeId ->
                                        SessionMode.entries.firstOrNull { m ->
                                            m.name.equals(modeId.replace('-', '_'), true)
                                        }
                                    }
                                    ?.let { selectedMode = it }
                                template.workingDirectory?.let { workingDirectory = it }
                                if (sessionName.isBlank()) sessionName = template.name
                            },
                            label = { Text(template.name) },
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            // ── Session Name ─────────────────────────────────────────────────
            SectionLabel("Session name (optional)")
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedTextField(
                value = sessionName,
                onValueChange = { sessionName = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = {
                    Text(
                        text = "Auto-generated if empty",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Sentences,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(
                    onDone = { createSession() },
                ),
                shape = RoundedCornerShape(12.dp),
            )

            Spacer(modifier = Modifier.height(16.dp))

            // ── Advanced toggle ──────────────────────────────────────────────
            TextButton(
                onClick = { showAdvanced = !showAdvanced },
                modifier = Modifier.align(Alignment.Start),
            ) {
                Icon(
                    imageVector = Icons.Default.ExpandMore,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text(if (showAdvanced) "Hide options" else "More options")
            }

            AnimatedVisibility(
                visible = showAdvanced,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut(),
            ) {
                Column {
                    // ── Workspace directory ──────────────────────────────────
                    SectionLabel("Workspace directory (optional)")
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = workingDirectory,
                        onValueChange = { workingDirectory = it },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = {
                            Text(
                                text = "/workspace/project",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        },
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.FolderOpen,
                                contentDescription = null,
                            )
                        },
                        supportingText = { Text("Leave empty to use the default workspace") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { createSession() }),
                        shape = RoundedCornerShape(12.dp),
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    // ── Mode selector ────────────────────────────────────────
                    SectionLabel("Mode")
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        SessionMode.entries.forEach { mode ->
                            ModeChip(
                                mode = mode,
                                isSelected = selectedMode == mode,
                                onClick = { selectedMode = mode },
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // ── Category selector ────────────────────────────────────
                    if (categories.isNotEmpty()) {
                        SectionLabel("Category")
                        Spacer(modifier = Modifier.height(8.dp))
                        Box {
                            Surface(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .clickable { categoryMenuExpanded = true },
                                color = MaterialTheme.colorScheme.surfaceContainer,
                                shape = RoundedCornerShape(12.dp),
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 16.dp, vertical = 14.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.FolderOpen,
                                        contentDescription = null,
                                        modifier = Modifier.size(18.dp),
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text = categories.find { it.id == selectedCategoryId }?.name
                                            ?: "No category",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = if (selectedCategoryId != null)
                                            MaterialTheme.colorScheme.onSurface
                                        else
                                            MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.weight(1f),
                                    )
                                    Icon(
                                        imageVector = Icons.Default.ExpandMore,
                                        contentDescription = null,
                                        modifier = Modifier.size(18.dp),
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }

                            DropdownMenu(
                                expanded = categoryMenuExpanded,
                                onDismissRequest = { categoryMenuExpanded = false },
                            ) {
                                DropdownMenuItem(
                                    text = { Text("No category") },
                                    onClick = {
                                        selectedCategoryId = null
                                        categoryMenuExpanded = false
                                    },
                                )
                                categories.forEach { cat ->
                                    DropdownMenuItem(
                                        text = { Text(cat.name) },
                                        leadingIcon = {
                                            CategoryColorDot(color = cat.color)
                                        },
                                        onClick = {
                                            selectedCategoryId = cat.id
                                            categoryMenuExpanded = false
                                        },
                                    )
                                }
                            }
                        }
                        Spacer(modifier = Modifier.height(16.dp))
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            creationError?.let { error ->
                Text(
                    text = error,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
            }

            // ── Create button ────────────────────────────────────────────────
            Button(
                onClick = createSession,
                enabled = availableProvider != null && !isCreating,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 52.dp),
                shape = RoundedCornerShape(14.dp),
            ) {
                if (isCreating) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Creating session…")
                } else if (availableProvider != null) {
                    ProviderBadge(
                        provider = availableProvider.toCliProvider(),
                        size = BadgeSize.SMALL,
                        showLabel = false,
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Start with ${availableProvider.toCliProvider().displayName}",
                        style = MaterialTheme.typography.labelLarge,
                    )
                } else {
                    Text(
                        text = "No provider available",
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
            }
        }
    }
}

// ── Provider Option Chip ──────────────────────────────────────────────────────

@Composable
private fun ProviderOption(
    provider: CLIProvider,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    val isDark = isSystemInDarkTheme()
    val cliProvider = provider.toCliProvider()
    val theme = ProviderThemes.get(cliProvider)
    val containerColor = if (isSelected) {
        ProviderThemes.containerColor(cliProvider, isDark)
    } else {
        MaterialTheme.colorScheme.surfaceContainer
    }
    val contentColor = if (isSelected) {
        ProviderThemes.onContainerColor(cliProvider, isDark)
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }

    Surface(
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .then(
                if (isSelected) {
                    Modifier.border(
                        width = 1.5.dp,
                        color = ProviderThemes.color(cliProvider, isDark).copy(alpha = 0.6f),
                        shape = RoundedCornerShape(12.dp),
                    )
                } else Modifier
            )
            .semantics {
                selected = isSelected
                role = Role.Button
            },
        color = containerColor,
        shape = RoundedCornerShape(12.dp),
        onClick = onClick,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(
                imageVector = theme.icon,
                contentDescription = theme.displayName,
                modifier = Modifier.size(22.dp),
                tint = contentColor,
            )
            Text(
                text = theme.displayName,
                style = MaterialTheme.typography.labelSmall,
                color = contentColor,
                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
            )
        }
    }
}

// ── Mode Chip ─────────────────────────────────────────────────────────────────

@Composable
private fun ModeChip(
    mode: SessionMode,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .semantics {
                selected = isSelected
                role = Role.Button
            },
        color = if (isSelected) MaterialTheme.colorScheme.primaryContainer
        else MaterialTheme.colorScheme.surfaceContainer,
        shape = RoundedCornerShape(10.dp),
        onClick = onClick,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (isSelected) {
                Icon(
                    imageVector = Icons.Default.Check,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                )
                Spacer(modifier = Modifier.height(2.dp))
            }
            Text(
                text = mode.label,
                style = MaterialTheme.typography.labelSmall,
                color = if (isSelected) MaterialTheme.colorScheme.onPrimaryContainer
                else MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
            )
        }
    }
}

// ── Category Color Dot ────────────────────────────────────────────────────────

@Composable
private fun CategoryColorDot(color: String) {
    Box(
        modifier = Modifier
            .size(12.dp)
            .clip(RoundedCornerShape(50))
            .background(parseHexColor(color)),
    )
}

// ── Helper Labels ─────────────────────────────────────────────────────────────

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        fontWeight = FontWeight.Medium,
    )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

private fun CLIProvider.toCliProvider(): CliProvider = when (this) {
    CLIProvider.CLAUDE -> CliProvider.CLAUDE
    CLIProvider.CODEX  -> CliProvider.CODEX
    CLIProvider.OPENCODE -> CliProvider.OPENCODE
    CLIProvider.PI -> CliProvider.PI
    CLIProvider.KIMI -> CliProvider.KIMI
    CLIProvider.ZAI -> CliProvider.ZAI
}

private val CliProvider.displayName: String
    get() = ProviderThemes.get(this).displayName

fun parseHexColor(hex: String): Color {
    return try {
        val clean = hex.removePrefix("#")
        val argb = when (clean.length) {
            6 -> "FF$clean"
            8 -> clean
            else -> "FF6366F1"
        }
        Color(argb.toLong(16).toInt())
    } catch (_: Exception) {
        Color(0xFF6366F1)
    }
}

// ── Preview ───────────────────────────────────────────────────────────────────

@Preview(showBackground = true)
@Composable
private fun NewSessionDialogPreview() {
    ClaudeWebUITheme {
        NewSessionDialog(
            categories = listOf(
                Category(
                    id = "1",
                    userId = "u1",
                    name = "Work",
                    color = "#6366f1",
                    icon = "folder",
                    sortOrder = 0,
                    createdAt = "",
                ),
            ),
            onDismiss = {},
            onCreate = { _, _, _, _, _ -> },
        )
    }
}
