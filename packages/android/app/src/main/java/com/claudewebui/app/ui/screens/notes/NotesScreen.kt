package com.claudewebui.app.ui.screens.notes

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
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
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.Note
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.isTabletWidth

/**
 * Scratch notes for one session — the mobile counterpart to the WebUI notepad.
 */
@Composable
fun NotesScreen(
    viewModel: NotesViewModel,
    onNavigateBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()

    PlumBackdrop {
        Scaffold(
            containerColor = Color.Transparent,
            // Include the IME so editors/fields lift above the keyboard.
            contentWindowInsets = WindowInsets.safeDrawing,
        ) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(
                    horizontal = if (isTabletWidth()) 40.dp else 16.dp,
                    vertical = 4.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    PlumScreenHeader(
                        title = "Notes",
                        subtitle = "Scratch space for this session",
                        actions = {
                            PlumIconButton(Icons.Outlined.Add, "New note", viewModel::startNew)
                            PlumIconButton(
                                Icons.AutoMirrored.Outlined.ArrowBack,
                                "Back",
                                onNavigateBack,
                            )
                        },
                    )
                }

                state.editingId?.let {
                    item {
                        GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
                            Column(
                                Modifier.padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                OutlinedTextField(
                                    value = state.draftTitle,
                                    onValueChange = viewModel::onTitleChange,
                                    label = { Text("Title") },
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth(),
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedBorderColor = PlumAccent,
                                        focusedLabelColor = PlumAccent,
                                    ),
                                )
                                OutlinedTextField(
                                    value = state.draftContent,
                                    onValueChange = viewModel::onContentChange,
                                    label = { Text("Note") },
                                    modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp),
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedBorderColor = PlumAccent,
                                        focusedLabelColor = PlumAccent,
                                    ),
                                )
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        if (state.isSaving) "Saving…" else "Saved automatically",
                                        color = PlumMuted,
                                        fontSize = 11.sp,
                                        modifier = Modifier.weight(1f),
                                    )
                                    Text(
                                        "Done",
                                        color = PlumText,
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(50))
                                            .background(PlumAccent.copy(alpha = .18f))
                                            .clickable(onClick = viewModel::closeEditor)
                                            .padding(horizontal = 16.dp, vertical = 9.dp),
                                    )
                                }
                            }
                        }
                    }
                }

                if (state.isLoading) {
                    item {
                        Box(Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = PlumAccent, strokeWidth = 2.5.dp)
                        }
                    }
                } else if (state.notes.isEmpty() && state.editingId == null) {
                    item {
                        GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
                            Column(
                                Modifier.fillMaxWidth().padding(28.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Text("No notes yet", color = PlumText, fontWeight = FontWeight.SemiBold)
                                Text(
                                    "Tap + to jot something down for this session.",
                                    color = PlumMuted,
                                    fontSize = 12.sp,
                                )
                            }
                        }
                    }
                }

                items(state.notes, key = { it.id }) { note ->
                    NoteRow(
                        note = note,
                        onOpen = { viewModel.startEditing(note) },
                        onTogglePin = { viewModel.togglePinned(note) },
                        onDelete = { viewModel.delete(note) },
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
                            Text(message, color = PlumRed, fontSize = 12.sp, modifier = Modifier.weight(1f))
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
private fun NoteRow(
    note: Note,
    onOpen: () -> Unit,
    onTogglePin: () -> Unit,
    onDelete: () -> Unit,
) {
    GlassPanel(Modifier.fillMaxWidth(), radius = 16.dp) {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    note.title.ifBlank { "Untitled" },
                    color = PlumText,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    note.content.ifBlank { "Empty" },
                    color = PlumMuted,
                    fontSize = 12.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Icon(
                Icons.Outlined.PushPin,
                if (note.isPinned) "Unpin" else "Pin",
                tint = if (note.isPinned) PlumAccent else PlumMuted,
                modifier = Modifier
                    .size(34.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .clickable(onClick = onTogglePin)
                    .padding(7.dp),
            )
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
