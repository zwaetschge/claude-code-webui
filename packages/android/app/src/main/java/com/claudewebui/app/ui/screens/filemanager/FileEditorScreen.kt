package com.claudewebui.app.ui.screens.filemanager

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumText

/**
 * Read and edit a workspace file.
 *
 * Replaces a screen that existed but was never reachable: the file-viewer route
 * popped straight back, so tapping a file did nothing.
 */
@Composable
fun FileEditorScreen(
    viewModel: FileEditorViewModel,
    onNavigateBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()

    PlumBackdrop {
        Scaffold(
            containerColor = Color.Transparent,
            // Include the IME so editors/fields lift above the keyboard.
            contentWindowInsets = WindowInsets.safeDrawing,
        ) { padding ->
            Column(
                Modifier.fillMaxSize().padding(padding).padding(horizontal = 14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                PlumScreenHeader(
                    title = state.fileName.ifBlank { "File" },
                    subtitle = state.path,
                    actions = {
                        PlumIconButton(Icons.Outlined.Refresh, "Reload", viewModel::load)
                        PlumIconButton(
                            Icons.AutoMirrored.Outlined.ArrowBack,
                            "Back",
                            onNavigateBack,
                        )
                    },
                )

                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        when {
                            state.isSaving -> "Saving…"
                            state.hasChanges -> "Unsaved changes"
                            state.savedAt != null -> "Saved"
                            else -> "No changes"
                        },
                        color = if (state.hasChanges) PlumAccent else PlumMuted,
                        fontSize = 12.sp,
                        modifier = Modifier.weight(1f),
                    )
                    if (state.hasChanges) {
                        ActionChip("Revert", enabled = !state.isSaving, onClick = viewModel::revert)
                    }
                    ActionChip(
                        "Save",
                        enabled = state.hasChanges && !state.isSaving,
                        onClick = viewModel::save,
                    )
                }

                state.error?.let { message ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(PlumSubtleFill)
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(message, color = PlumRed, fontSize = 12.sp, modifier = Modifier.weight(1f))
                        Text(
                            "Dismiss",
                            color = PlumAccent,
                            fontSize = 12.sp,
                            modifier = Modifier.clickable(onClick = viewModel::dismissError),
                        )
                    }
                }

                if (state.isLoading) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = PlumAccent, strokeWidth = 2.5.dp)
                    }
                } else {
                    GlassPanel(Modifier.fillMaxWidth().weight(1f), radius = 16.dp) {
                        BasicTextField(
                            value = state.draft,
                            onValueChange = viewModel::onDraftChange,
                            textStyle = TextStyle(
                                color = PlumText,
                                fontSize = 12.sp,
                                fontFamily = FontFamily.Monospace,
                                lineHeight = 17.sp,
                            ),
                            cursorBrush = SolidColor(PlumAccent),
                            modifier = Modifier
                                .fillMaxSize()
                                .verticalScroll(rememberScrollState())
                                .padding(13.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ActionChip(label: String, enabled: Boolean, onClick: () -> Unit) {
    Text(
        label,
        color = if (enabled) PlumText else PlumMuted,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(if (enabled) PlumAccent.copy(alpha = .18f) else PlumSubtleFill)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 15.dp, vertical = 9.dp),
    )
}
