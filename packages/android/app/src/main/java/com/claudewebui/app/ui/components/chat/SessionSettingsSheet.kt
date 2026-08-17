package com.claudewebui.app.ui.components.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.ConfigSkill
import com.claudewebui.app.data.model.StyleKind
import com.claudewebui.app.data.model.ReasoningLevel
import com.claudewebui.app.data.model.ServiceTier
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionPeerLink
import com.claudewebui.app.data.model.SessionMode
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.providerColor

/**
 * Per-session controls: which harness runs it, on which model, at which
 * reasoning level, and how freely it may use tools.
 *
 * Provider, model and reasoning are persisted settings. The backend reloads a
 * running harness immediately while preserving its conversation context. Mode
 * remains a live socket setting.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun SessionSettingsSheet(
    session: Session,
    mode: SessionMode,
    availableModels: List<String>,
    isApplying: Boolean,
    allowedDirectories: List<String>,
    directoriesLoading: Boolean,
    onProviderChange: (CLIProvider) -> Unit,
    onModelChange: (String?) -> Unit,
    onReasoningChange: (String?) -> Unit,
    onModeChange: (SessionMode) -> Unit,
    onAddAllowedDirectory: (String) -> Unit,
    onRemoveAllowedDirectory: (String) -> Unit,
    designStyles: List<ConfigSkill> = emptyList(),
    writingStyles: List<ConfigSkill> = emptyList(),
    onStyleChange: (StyleKind, String?) -> Unit = { _, _ -> },
    meshPeers: List<SessionPeerLink> = emptyList(),
    /** Freeze this setup as a reusable template. */
    onSaveTemplate: (String) -> Unit = {},
    /** Hand the whole transcript to the system share sheet. */
    onShareTranscript: () -> Unit = {},
    isSharing: Boolean = false,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var newDirectory by remember { mutableStateOf("") }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = PlumSurfaceStrong,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .heightIn(max = 620.dp)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Text("Session settings", color = PlumText, fontSize = 18.sp, fontWeight = FontWeight.Bold)

            SettingsGroup("Mode", "Applies immediately") {
                SessionMode.entries.forEach { option ->
                    OptionRow(
                        title = option.label,
                        subtitle = option.description,
                        selected = option == mode,
                        enabled = true,
                    ) { onModeChange(option) }
                }
            }

            SettingsGroup("Provider", "Applies immediately") {
                CLIProvider.active.forEach { provider ->
                    OptionRow(
                        title = provider.displayName,
                        subtitle = null,
                        selected = provider == session.cliProvider,
                        enabled = !isApplying,
                        accent = providerColor(provider),
                    ) { onProviderChange(provider) }
                }
            }

            SettingsGroup("Model", "Applies immediately") {
                OptionRow(
                    title = "Provider default",
                    subtitle = null,
                    selected = session.cliModel.isNullOrBlank(),
                    enabled = !isApplying,
                ) { onModelChange(null) }
                availableModels.forEach { model ->
                    OptionRow(
                        title = model,
                        subtitle = null,
                        selected = model == session.cliModel,
                        enabled = !isApplying,
                    ) { onModelChange(model) }
                }
                if (availableModels.isEmpty()) {
                    Text(
                        "This provider reports no model list",
                        color = PlumMuted,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(vertical = 6.dp),
                    )
                }
            }

            SettingsGroup("Reasoning", "Applies immediately") {
                val levels = ReasoningLevel.forProvider(session.cliProvider)
                val fastActive = session.cliServiceTier.equals(ServiceTier.FAST.id, ignoreCase = true)
                OptionRow(
                    title = "Provider default",
                    subtitle = null,
                    selected = session.cliReasoning.isNullOrBlank() && !fastActive,
                    enabled = !isApplying,
                ) { onReasoningChange(null) }
                levels.forEach { level ->
                    OptionRow(
                        title = level.label,
                        subtitle = null,
                        selected = !fastActive &&
                            level.id.equals(session.cliReasoning, ignoreCase = true),
                        enabled = !isApplying,
                    ) { onReasoningChange(level.id) }
                }
                // A level the server set but this provider no longer lists
                // (e.g. after a provider switch) would otherwise vanish from the
                // sheet and read as "Provider default".
                ReasoningLevel.fromId(session.cliReasoning)
                    ?.takeIf { it !in levels }
                    ?.let { orphan ->
                        OptionRow(
                            title = orphan.label,
                            subtitle = "Set on the server for another provider",
                            selected = !fastActive,
                            enabled = !isApplying,
                        ) { onReasoningChange(orphan.id) }
                    }
                if (session.cliProvider == CLIProvider.CODEX) {
                    OptionRow(
                        title = ServiceTier.FAST.label,
                        subtitle = "Codex service tier — lowest latency",
                        selected = fastActive,
                        enabled = !isApplying,
                    ) { onReasoningChange(ServiceTier.FAST.id) }
                }
            }

            if (designStyles.isNotEmpty() || writingStyles.isNotEmpty()) {
                SettingsGroup("Presentation presets", "Applied to this session's turns") {
                    StylePicker("Design", designStyles, session.designStyleSkill, isApplying) {
                        onStyleChange(StyleKind.DESIGN, it)
                    }
                    StylePicker("Writing", writingStyles, session.writingStyleSkill, isApplying) {
                        onStyleChange(StyleKind.WRITING, it)
                    }
                }
            }

            if (meshPeers.isNotEmpty()) {
                SettingsGroup("Session mesh", "Sessions this one can delegate to") {
                    meshPeers.forEach { peer ->
                        OptionRow(
                            title = peer.target?.name ?: peer.targetSessionId,
                            subtitle = listOfNotNull(
                                peer.role,
                                peer.target?.status,
                            ).joinToString(" · ").ifBlank { null },
                            selected = peer.enabled,
                            enabled = false,
                        ) { }
                    }
                }
            }

            SettingsGroup("This session", "Reuse or hand it off") {
                var templateName by remember(session.id) { mutableStateOf(session.name) }
                Text(
                    "A template keeps provider, model, mode and workspace — not the messages.",
                    color = PlumMuted,
                    fontSize = 11.sp,
                )
                OutlinedTextField(
                    value = templateName,
                    onValueChange = { templateName = it },
                    singleLine = true,
                    label = { Text("Template name") },
                    modifier = Modifier.fillMaxWidth(),
                )
                SheetActionRow(
                    label = "Save as template",
                    enabled = templateName.isNotBlank(),
                ) { onSaveTemplate(templateName.trim()) }
                SheetActionRow(
                    label = if (isSharing) "Preparing transcript…" else "Share transcript",
                    enabled = !isSharing,
                ) { onShareTranscript() }
            }

            SettingsGroup("Allowed directories", "Enforced per session") {
                Text(
                    "Adds explicit read/write roots beyond the session workspace.",
                    color = PlumMuted,
                    fontSize = 11.sp,
                )
                allowedDirectories.forEach { directory ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(PlumSubtleFill)
                            .border(1.dp, PlumBorder, RoundedCornerShape(12.dp))
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            directory,
                            color = PlumText,
                            fontSize = 11.sp,
                            modifier = Modifier.weight(1f),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        TextButton(
                            onClick = { onRemoveAllowedDirectory(directory) },
                            enabled = !directoriesLoading,
                        ) { Text("Remove") }
                    }
                }
                if (allowedDirectories.isEmpty()) {
                    Text("No additional roots", color = PlumMuted, fontSize = 11.sp)
                }
                OutlinedTextField(
                    value = newDirectory,
                    onValueChange = { newDirectory = it },
                    label = { Text("Server directory path") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = {
                        TextButton(
                            onClick = {
                                onAddAllowedDirectory(newDirectory)
                                newDirectory = ""
                            },
                            enabled = newDirectory.isNotBlank() && !directoriesLoading,
                        ) { Text("Add") }
                    },
                )
            }
        }
    }
}

@Composable
private fun SettingsGroup(
    title: String,
    caption: String,
    content: @Composable () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, color = PlumText, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Text(caption, color = PlumMuted, fontSize = 10.sp)
        }
        content()
    }
}

/** A plain action, as opposed to the selectable OptionRow above it. */
@Composable
private fun SheetActionRow(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(PlumSubtleFill)
            .border(1.dp, PlumBorder, RoundedCornerShape(12.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 11.dp),
    ) {
        Text(
            label,
            color = if (enabled) PlumAccent else PlumMuted,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun OptionRow(
    title: String,
    subtitle: String?,
    selected: Boolean,
    enabled: Boolean,
    accent: Color = PlumAccent,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(PlumSubtleFill)
            .border(1.dp, if (selected) accent else PlumBorder, RoundedCornerShape(12.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(13.dp)
                .clip(CircleShape)
                .background(if (selected) accent else Color.Transparent)
                .border(1.dp, if (selected) accent else PlumBorder, CircleShape),
        )
        Column(Modifier.weight(1f).padding(start = 11.dp)) {
            Text(
                title,
                color = if (enabled) PlumText else PlumMuted,
                fontSize = 13.sp,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            subtitle?.let { Text(it, color = PlumMuted, fontSize = 10.sp, maxLines = 1) }
        }
    }
}

/**
 * One preset slot: "None" plus the catalogue entries. Collapsed to a scrollable
 * list because the design library alone ships several dozen presets.
 */
@Composable
private fun StylePicker(
    label: String,
    styles: List<ConfigSkill>,
    selected: String?,
    isApplying: Boolean,
    onSelect: (String?) -> Unit,
) {
    if (styles.isEmpty()) return
    var expanded by remember { mutableStateOf(false) }
    val active = styles.firstOrNull { it.id == selected || it.name == selected }

    OptionRow(
        title = label,
        subtitle = active?.name ?: "None",
        selected = active != null,
        enabled = !isApplying,
    ) { expanded = !expanded }

    if (expanded) {
        Column(
            Modifier
                .fillMaxWidth()
                .heightIn(max = 240.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            OptionRow(
                title = "None",
                subtitle = null,
                selected = active == null,
                enabled = !isApplying,
            ) {
                onSelect(null)
                expanded = false
            }
            styles.forEach { style ->
                OptionRow(
                    title = style.name,
                    subtitle = style.description.takeIf { it.isNotBlank() },
                    selected = style.id == selected || style.name == selected,
                    enabled = !isApplying,
                ) {
                    onSelect(style.id)
                    expanded = false
                }
            }
        }
    }
}
