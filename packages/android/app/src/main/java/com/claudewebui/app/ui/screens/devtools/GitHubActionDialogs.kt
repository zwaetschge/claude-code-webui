package com.claudewebui.app.ui.screens.devtools

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.GitHubRepo

@Composable
fun CreateRepoDialog(
    onDismiss: () -> Unit,
    onCreate: (String, String, Boolean) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var isPrivate by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Create GitHub repository") },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Repository name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text("Description (optional)") },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
                CheckRow("Private repository", isPrivate) { isPrivate = it }
                Text(
                    "The repository is initialized with a README so it can be cloned immediately.",
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = name.trim().matches(Regex("^[a-zA-Z0-9._-]+$")),
                onClick = { onCreate(name.trim(), description.trim(), isPrivate) },
            ) { Text("Create") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun CloneRepoDialog(
    repo: GitHubRepo,
    initialTarget: String,
    onDismiss: () -> Unit,
    onClone: (String, String) -> Unit,
) {
    var target by remember(initialTarget) { mutableStateOf(initialTarget) }
    var branch by remember(repo.defaultBranch) { mutableStateOf(repo.defaultBranch) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Clone ${repo.name}") },
        text = {
            Column {
                OutlinedTextField(
                    value = target,
                    onValueChange = { target = it },
                    label = { Text("Target directory") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = branch,
                    onValueChange = { branch = it },
                    label = { Text("Branch (optional)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = target.isNotBlank(),
                onClick = { onClone(target.trim(), branch.trim()) },
            ) { Text("Clone") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun PushRepoDialog(
    onDismiss: () -> Unit,
    onPush: (String, String, Boolean) -> Unit,
) {
    var remote by remember { mutableStateOf("origin") }
    var branch by remember { mutableStateOf("") }
    var force by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Push current workspace") },
        text = {
            Column {
                OutlinedTextField(
                    value = remote,
                    onValueChange = { remote = it },
                    label = { Text("Remote") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = branch,
                    onValueChange = { branch = it },
                    label = { Text("Branch (current if empty)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
                CheckRow("Force push", force) { force = it }
                if (force) {
                    Text("Force push may overwrite remote history.")
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onPush(remote.trim(), branch.trim(), force) }) {
                Text(if (force) "Force push" else "Push")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun CheckRow(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onCheckedChange(!checked) }
            .padding(top = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = checked, onCheckedChange = onCheckedChange)
        Text(label)
    }
}
