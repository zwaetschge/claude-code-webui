package com.claudewebui.app.ui.screens.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.OpenCodeProvider
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.StatusPill

@Composable
fun OpenCodeProvidersPanel(
    providers: List<OpenCodeProvider>,
    saving: Boolean,
    tests: Map<String, TestResult>,
    testMessages: Map<String, String>,
    error: String?,
    onSave: (String, String, String, String, Boolean) -> Unit,
    onDelete: (String) -> Unit,
    onTest: (String) -> Unit,
) {
    var editing by remember { mutableStateOf<OpenCodeProvider?>(null) }
    var creating by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<OpenCodeProvider?>(null) }

    GlassPanel(Modifier.fillMaxWidth(), radius = 19.dp) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Provider accounts", color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    Text("Shared by OpenCode and Pi; keys stay encrypted on the server.", color = PlumMuted, fontSize = 11.sp)
                }
                Text(
                    "Add",
                    color = PlumAccent,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.clickable { creating = true; editing = null }.padding(8.dp),
                )
            }

            providers.forEach { provider ->
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(provider.name, color = PlumText, fontWeight = FontWeight.Bold)
                            Text(
                                listOfNotNull(
                                    provider.id,
                                    provider.baseUrl?.takeIf { it.isNotBlank() },
                                    provider.envVars.takeIf { it.isNotEmpty() }?.joinToString(" / "),
                                ).joinToString(" · "),
                                color = PlumMuted,
                                fontSize = 10.sp,
                                maxLines = 2,
                            )
                        }
                        StatusPill(if (provider.hasKey) "Key stored" else "No key", if (provider.hasKey) PlumGreen else PlumMuted)
                    }
                    testMessages[provider.id]?.let { message ->
                        Text(
                            message,
                            color = if (tests[provider.id] is TestResult.Success) PlumGreen else PlumRed,
                            fontSize = 10.sp,
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(onClick = { onTest(provider.id) }, enabled = tests[provider.id] !is TestResult.Testing) {
                            Text(if (tests[provider.id] is TestResult.Testing) "Testing…" else "Test")
                        }
                        TextButton(onClick = { editing = provider; creating = false }) { Text("Edit") }
                        TextButton(onClick = { deleting = provider }) { Text("Delete", color = PlumRed) }
                    }
                }
            }

            if (providers.isEmpty() && !creating) {
                Text("No OpenCode provider keys configured.", color = PlumMuted, fontSize = 12.sp)
            }

            if (creating || editing != null) {
                OpenCodeProviderForm(
                    provider = editing,
                    saving = saving,
                    error = error,
                    onCancel = { creating = false; editing = null },
                    onSave = { id, name, key, url, enabled ->
                        onSave(id, name, key, url, enabled)
                        creating = false
                        editing = null
                    },
                )
            }
        }
    }

    deleting?.let { provider ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete ${provider.name}?") },
            text = { Text("The encrypted provider key will be removed for OpenCode and Pi.") },
            confirmButton = {
                TextButton(onClick = { onDelete(provider.id); deleting = null }) {
                    Text("Delete", color = PlumRed)
                }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun OpenCodeProviderForm(
    provider: OpenCodeProvider?,
    saving: Boolean,
    error: String?,
    onCancel: () -> Unit,
    onSave: (String, String, String, String, Boolean) -> Unit,
) {
    var id by remember(provider?.id) { mutableStateOf(provider?.id.orEmpty()) }
    var name by remember(provider?.id) { mutableStateOf(provider?.name.orEmpty()) }
    var key by remember(provider?.id) { mutableStateOf("") }
    var baseUrl by remember(provider?.id) { mutableStateOf(provider?.baseUrl.orEmpty()) }
    var enabled by remember(provider?.id) { mutableStateOf(provider?.enabled ?: true) }
    val valid = id.isNotBlank() && name.isNotBlank() && (provider?.hasKey == true || key.isNotBlank()) && !saving

    Text(if (provider == null) "New provider" else "Edit provider", color = PlumText, fontWeight = FontWeight.Bold)
    Text("Common IDs: z-ai, openai, anthropic, deepseek, opencode-go", color = PlumMuted, fontSize = 10.sp)
    OutlinedTextField(value = id, onValueChange = { id = it }, label = { Text("Provider ID") }, enabled = provider == null, singleLine = true, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Display name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(
        value = key,
        onValueChange = { key = it },
        label = { Text(if (provider?.hasKey == true) "New API key (leave blank to keep)" else "API key") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedTextField(value = baseUrl, onValueChange = { baseUrl = it }, label = { Text("Base URL (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Enabled", color = PlumText, modifier = Modifier.weight(1f))
        Switch(checked = enabled, onCheckedChange = { enabled = it })
    }
    error?.let { Text(it, color = PlumRed, fontSize = 11.sp) }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
        TextButton(onClick = onCancel, enabled = !saving) { Text("Cancel") }
        TextButton(
            onClick = { onSave(id.trim(), name.trim(), key, baseUrl, enabled) },
            enabled = valid,
        ) { Text(if (saving) "Saving…" else "Save") }
    }
}
