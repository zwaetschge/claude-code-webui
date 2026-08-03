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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.Category
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.ui.components.common.BadgeSize
import com.claudewebui.app.ui.components.common.ProviderBadge
import com.claudewebui.app.ui.theme.CliProvider
import com.claudewebui.app.ui.theme.ClaudeWebUITheme
import com.claudewebui.app.ui.theme.ProviderThemes

// ── Session Modes ─────────────────────────────────────────────────────────────

enum class SessionMode(val label: String, val description: String) {
    NORMAL("Normal", "Standard single-agent session"),
}

// ── NewSessionDialog ──────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun NewSessionDialog(
    categories: List<Category>,
    providers: List<CLIProvider> = CLIProvider.active,
    onDismiss: () -> Unit,
    onCreate: (name: String, provider: CLIProvider, workingDirectory: String?) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var sessionName by remember { mutableStateOf("") }
    var selectedProvider by remember { mutableStateOf(CLIProvider.CODEX) }
    var selectedMode by remember { mutableStateOf(SessionMode.NORMAL) }
    var selectedCategoryId by remember { mutableStateOf<String?>(null) }
    var showAdvanced by remember { mutableStateOf(false) }
    var categoryMenuExpanded by remember { mutableStateOf(false) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
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

            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                providers.forEach { provider ->
                    ProviderOption(
                        provider = provider,
                        isSelected = selectedProvider == provider,
                        onClick = {
                            selectedProvider = provider
                            // Quick-start: if no title typed yet, create with defaults immediately
                        },
                        onQuickStart = {
                            onCreate(sessionName, provider, null)
                            onDismiss()
                        },
                    )
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
                    onDone = {
                        onCreate(sessionName, selectedProvider, null)
                        onDismiss()
                    }
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

            // ── Create button ────────────────────────────────────────────────
            Button(
                onClick = {
                    onCreate(sessionName, selectedProvider, null)
                    onDismiss()
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(14.dp),
            ) {
                ProviderBadge(
                    provider = selectedProvider.toCliProvider(),
                    size = BadgeSize.SMALL,
                    showLabel = false,
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Start with ${selectedProvider.toCliProvider().displayName}",
                    style = MaterialTheme.typography.labelLarge,
                )
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
    onQuickStart: () -> Unit,
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
            ),
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
        modifier = modifier.clip(RoundedCornerShape(10.dp)),
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
            onCreate = { _, _, _ -> },
        )
    }
}
