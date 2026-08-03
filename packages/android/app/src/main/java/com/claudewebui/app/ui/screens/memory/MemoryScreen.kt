package com.claudewebui.app.ui.screens.memory

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import com.claudewebui.app.data.model.MemoryFile
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.isTabletWidth

/**
 * The session's persistent memory files — the mobile counterpart to the WebUI
 * memory panel.
 */
@Composable
fun MemoryScreen(
    viewModel: MemoryViewModel,
    onNavigateBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    var newName by remember { mutableStateOf("") }
    val wide = isTabletWidth()

    if (showCreate) {
        AlertDialog(
            onDismissRequest = { showCreate = false },
            title = { Text("New memory") },
            text = {
                OutlinedTextField(
                    value = newName,
                    onValueChange = { newName = it },
                    label = { Text("File name") },
                    placeholder = { Text("deployment-notes") },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PlumAccent,
                        focusedLabelColor = PlumAccent,
                    ),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.create(newName)
                    newName = ""
                    showCreate = false
                }) { Text("Create", color = PlumAccent) }
            },
            dismissButton = {
                TextButton(onClick = { showCreate = false }) { Text("Cancel", color = PlumMuted) }
            },
        )
    }

    PlumBackdrop {
        Scaffold(containerColor = Color.Transparent) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(
                    horizontal = if (wide) 40.dp else 16.dp,
                    vertical = 4.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    PlumScreenHeader(
                        title = "Memory",
                        subtitle = state.memoryDir.ifBlank { "Persistent notes for this workspace" },
                        actions = {
                            PlumIconButton(
                                Icons.Outlined.Add,
                                "New memory",
                                onClick = { showCreate = true },
                            )
                            PlumIconButton(Icons.Outlined.Refresh, "Reload", viewModel::load)
                            PlumIconButton(
                                Icons.AutoMirrored.Outlined.ArrowBack,
                                "Back",
                                onNavigateBack,
                            )
                        },
                    )
                }

                state.openPath?.let {
                    item {
                        GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
                            Column(
                                Modifier.padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        state.openName,
                                        color = PlumText,
                                        fontWeight = FontWeight.Bold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f),
                                    )
                                    Text(
                                        when {
                                            state.isSaving -> "Saving…"
                                            state.hasChanges -> "Unsaved"
                                            else -> "Saved"
                                        },
                                        color = if (state.hasChanges) PlumAccent else PlumMuted,
                                        fontSize = 11.sp,
                                    )
                                }
                                OutlinedTextField(
                                    value = state.draft,
                                    onValueChange = viewModel::onDraftChange,
                                    modifier = Modifier.fillMaxWidth().heightIn(min = 200.dp),
                                    textStyle = TextStyle(
                                        color = PlumText,
                                        fontSize = 12.sp,
                                        fontFamily = FontFamily.Monospace,
                                        lineHeight = 17.sp,
                                    ),
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedBorderColor = PlumAccent,
                                        cursorColor = PlumAccent,
                                    ),
                                )
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Box(Modifier.weight(1f))
                                    Chip("Close", enabled = true, onClick = viewModel::closeEditor)
                                    Chip(
                                        "Save",
                                        enabled = state.hasChanges && !state.isSaving,
                                        onClick = viewModel::save,
                                    )
                                }
                            }
                        }
                    }
                }

                if (state.isLoading) {
                    item {
                        Box(
                            Modifier.fillMaxWidth().height(120.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(color = PlumAccent, strokeWidth = 2.5.dp)
                        }
                    }
                } else if (state.files.isEmpty()) {
                    item {
                        GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
                            Column(
                                Modifier.fillMaxWidth().padding(28.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                Text(
                                    "No memory files",
                                    color = PlumText,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(
                                    "Memories written by the agent show up here.",
                                    color = PlumMuted,
                                    fontSize = 12.sp,
                                )
                            }
                        }
                    }
                }

                items(state.files, key = { it.path }) { file ->
                    MemoryRow(
                        file = file,
                        selected = file.path == state.openPath,
                        onOpen = { viewModel.open(file) },
                        onDelete = { viewModel.delete(file) },
                    )
                }

                state.error?.let { message ->
                    item {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(PlumSubtleFill)
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                message,
                                color = PlumRed,
                                fontSize = 12.sp,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                "Dismiss",
                                color = PlumAccent,
                                fontSize = 12.sp,
                                modifier = Modifier.clickable(onClick = viewModel::dismissError),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MemoryRow(
    file: MemoryFile,
    selected: Boolean,
    onOpen: () -> Unit,
    onDelete: () -> Unit,
) {
    GlassPanel(Modifier.fillMaxWidth(), radius = 16.dp) {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            Icon(
                Icons.Outlined.Description,
                null,
                tint = if (selected) PlumAccent else PlumMuted,
                modifier = Modifier.size(20.dp),
            )
            Column(Modifier.weight(1f)) {
                Text(
                    file.name,
                    color = if (selected) PlumAccent else PlumText,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "${file.size} B · ${file.modifiedAt.take(10)}",
                    color = PlumMuted,
                    fontSize = 11.sp,
                    maxLines = 1,
                )
            }
            Icon(
                Icons.Outlined.Delete,
                "Delete",
                tint = PlumRed,
                modifier = Modifier
                    .size(34.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .clickable(onClick = onDelete)
                    .padding(7.dp),
            )
        }
    }
}

@Composable
private fun Chip(label: String, enabled: Boolean, onClick: () -> Unit) {
    Text(
        label,
        color = if (enabled) PlumText else PlumMuted,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        maxLines = 1,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(if (enabled) PlumAccent.copy(alpha = .18f) else PlumSubtleFill)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 15.dp, vertical = 9.dp),
    )
}
