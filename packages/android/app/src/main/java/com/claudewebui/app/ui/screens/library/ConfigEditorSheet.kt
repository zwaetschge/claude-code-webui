package com.claudewebui.app.ui.screens.library

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.ConfigDocument
import com.claudewebui.app.data.model.ConfigItemKind
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumText

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConfigEditorSheet(
    document: ConfigDocument?,
    loading: Boolean,
    saving: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onSave: (ConfigDocument) -> Unit,
    onDelete: (ConfigDocument) -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        if (loading || document == null) {
            Box(
                Modifier.fillMaxWidth().height(220.dp),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }
        } else {
            key(document.kind, document.key) {
                ConfigEditorForm(document, saving, error, onDismiss, onSave, onDelete)
            }
        }
    }
}

@Composable
private fun ConfigEditorForm(
    original: ConfigDocument,
    saving: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onSave: (ConfigDocument) -> Unit,
    onDelete: (ConfigDocument) -> Unit,
) {
    var name by remember { mutableStateOf(original.name) }
    var description by remember { mutableStateOf(original.description) }
    var content by remember { mutableStateOf(original.content) }
    var tools by remember { mutableStateOf(original.tools.joinToString(", ")) }
    var model by remember { mutableStateOf(original.model) }
    var version by remember { mutableStateOf(original.version) }
    var author by remember { mutableStateOf(original.author) }
    var category by remember { mutableStateOf(original.category) }
    var confirmDelete by remember { mutableStateOf(false) }

    val label = when (original.kind) {
        ConfigItemKind.AGENT -> "Agent"
        ConfigItemKind.SKILL -> "Skill"
        ConfigItemKind.PLUGIN -> "Plugin"
    }
    val valid = name.isNotBlank() && content.isNotBlank() && !saving
    val edited = original.copy(
        name = name.trim(),
        description = description.trim(),
        content = content,
        tools = tools.split(',').map { it.trim() }.filter { it.isNotBlank() },
        model = model.trim(),
        version = version.trim().ifBlank { "1.0.0" },
        author = author.trim(),
        category = category.trim(),
    )

    Column(
        Modifier
            .fillMaxWidth()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            if (original.key == null) "New $label" else "Edit $label",
            color = PlumText,
            fontWeight = FontWeight.Bold,
        )
        Text(
            "Saved on the server and available to new CLI sessions.",
            color = PlumMuted,
        )

        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            label = { Text("Name") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = description,
            onValueChange = { description = it },
            label = { Text("Description") },
            minLines = 2,
            maxLines = 4,
            modifier = Modifier.fillMaxWidth(),
        )

        if (original.kind != ConfigItemKind.PLUGIN) {
            OutlinedTextField(
                value = tools,
                onValueChange = { tools = it },
                label = { Text(if (original.kind == ConfigItemKind.SKILL) "Allowed tools" else "Tools") },
                supportingText = { Text("Comma separated") },
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = model,
                onValueChange = { model = it },
                label = { Text("Model (optional)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = version,
                    onValueChange = { version = it },
                    label = { Text("Version") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = category,
                    onValueChange = { category = it },
                    label = { Text("Category") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
            }
            OutlinedTextField(
                value = author,
                onValueChange = { author = it },
                label = { Text("Author") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        OutlinedTextField(
            value = content,
            onValueChange = { content = it },
            label = {
                Text(if (original.kind == ConfigItemKind.AGENT) "Prompt" else "Markdown content")
            },
            textStyle = androidx.compose.ui.text.TextStyle(fontFamily = FontFamily.Monospace),
            minLines = 10,
            modifier = Modifier.fillMaxWidth(),
        )

        error?.let { Text(it, color = PlumRed) }

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (original.key != null) {
                TextButton(onClick = { confirmDelete = true }, enabled = !saving) {
                    Text("Delete", color = PlumRed)
                }
            }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = onDismiss, enabled = !saving) { Text("Cancel") }
            Button(onClick = { onSave(edited) }, enabled = valid) {
                if (saving) CircularProgressIndicator(strokeWidth = 2.dp)
                else Text("Save")
            }
        }
        Spacer(Modifier.height(24.dp))
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete $label?") },
            text = { Text("${original.name} will be removed from the shared server library.") },
            confirmButton = {
                TextButton(onClick = { onDelete(original) }) { Text("Delete", color = PlumRed) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) { Text("Cancel") }
            },
        )
    }
}
