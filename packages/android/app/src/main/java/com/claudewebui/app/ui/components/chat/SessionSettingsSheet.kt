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
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.ReasoningLevel
import com.claudewebui.app.data.model.Session
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
 * Provider, model and reasoning are persisted settings that the harness reads
 * when it starts, so changing them mid-run only takes effect after a restart —
 * the caller surfaces that. Mode is live and goes over the socket.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun SessionSettingsSheet(
    session: Session,
    mode: SessionMode,
    availableModels: List<String>,
    isApplying: Boolean,
    onProviderChange: (CLIProvider) -> Unit,
    onModelChange: (String?) -> Unit,
    onReasoningChange: (String?) -> Unit,
    onModeChange: (SessionMode) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
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

            SettingsGroup("Provider", "Takes effect on the next run") {
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

            SettingsGroup("Model", "Takes effect on the next run") {
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

            SettingsGroup("Reasoning", "Takes effect on the next run") {
                OptionRow(
                    title = "Provider default",
                    subtitle = null,
                    selected = session.cliReasoning.isNullOrBlank(),
                    enabled = !isApplying,
                ) { onReasoningChange(null) }
                ReasoningLevel.entries.forEach { level ->
                    OptionRow(
                        title = level.label,
                        subtitle = null,
                        selected = level.id.equals(session.cliReasoning, ignoreCase = true),
                        enabled = !isApplying,
                    ) { onReasoningChange(level.id) }
                }
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
