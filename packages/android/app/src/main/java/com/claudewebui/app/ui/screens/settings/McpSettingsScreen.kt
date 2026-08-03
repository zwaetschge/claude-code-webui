package com.claudewebui.app.ui.screens.settings

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Extension
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.McpServer
import com.claudewebui.app.data.model.McpServerType
import kotlinx.coroutines.launch
import com.claudewebui.app.ui.components.common.PlumBlue
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumRed

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun McpSettingsScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    var showAddSheet by remember { mutableStateOf(false) }
    var editingServer by remember { mutableStateOf<McpServer?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("MCP Servers", fontWeight = FontWeight.SemiBold) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showAddSheet = true },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = Color.White,
            ) {
                Icon(Icons.Default.Add, contentDescription = "Add MCP server")
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(innerPadding)
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (state.mcpServers.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Icon(
                            Icons.Default.Extension,
                            contentDescription = null,
                            modifier = Modifier.size(48.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            "No MCP servers configured",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            "Tap + to connect a Model Context Protocol server",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            state.mcpServers.forEach { server ->
                McpServerCard(
                    server = server,
                    testResult = state.mcpTestResults[server.id] ?: TestResult.Idle,
                    isExpanded = server.id in state.expandedMcpIds,
                    onToggleExpand = { viewModel.toggleMcpExpanded(server.id) },
                    onToggleEnabled = { enabled ->
                        viewModel.updateMcpServer(server.id, enabled = enabled)
                    },
                    onEdit = { editingServer = server },
                    onDelete = { viewModel.deleteMcpServer(server.id) },
                    onTest = { viewModel.testMcpConnection(server.id) },
                )
            }

            Spacer(Modifier.height(72.dp))
        }
    }

    // ── Add sheet ─────────────────────────────────────────────────────────────
    if (showAddSheet) {
        ModalBottomSheet(
            onDismissRequest = { showAddSheet = false },
            sheetState = sheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            McpServerEditForm(
                server = null,
                onSave = { name, type, url, command, args, env ->
                    viewModel.addMcpServer(name, type, url, command, args, env)
                    scope.launch { sheetState.hide() }.invokeOnCompletion { showAddSheet = false }
                },
                onCancel = {
                    scope.launch { sheetState.hide() }.invokeOnCompletion { showAddSheet = false }
                },
            )
        }
    }

    // ── Edit sheet ────────────────────────────────────────────────────────────
    editingServer?.let { server ->
        ModalBottomSheet(
            onDismissRequest = { editingServer = null },
            sheetState = sheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            McpServerEditForm(
                server = server,
                onSave = { name, type, url, command, _, _ ->
                    viewModel.updateMcpServer(server.id, name = name, url = url, command = command)
                    scope.launch { sheetState.hide() }.invokeOnCompletion { editingServer = null }
                },
                onCancel = {
                    scope.launch { sheetState.hide() }.invokeOnCompletion { editingServer = null }
                },
            )
        }
    }
}

// ── MCP server card ───────────────────────────────────────────────────────────

@Composable
private fun McpServerCard(
    server: McpServer,
    testResult: TestResult,
    isExpanded: Boolean,
    onToggleExpand: () -> Unit,
    onToggleEnabled: (Boolean) -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onTest: () -> Unit,
) {
    var showDeleteConfirm by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column {
            ListItem(
                headlineContent = {
                    Text(server.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                },
                supportingContent = {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        // Type badge
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(
                                        if (server.type == McpServerType.SSE)
                                            PlumBlue.copy(alpha = 0.15f)
                                        else
                                            MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)
                                    )
                                    .padding(horizontal = 6.dp, vertical = 2.dp),
                            ) {
                                Text(
                                    text = server.type.name,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (server.type == McpServerType.SSE) PlumBlue else MaterialTheme.colorScheme.primary,
                                )
                            }

                            // Status dot
                            Box(
                                modifier = Modifier
                                    .size(6.dp)
                                    .clip(androidx.compose.foundation.shape.CircleShape)
                                    .background(
                                        if (server.enabled) PlumGreen
                                        else MaterialTheme.colorScheme.onSurfaceVariant
                                    ),
                            )
                            Text(
                                if (server.enabled) "Enabled" else "Disabled",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }

                        // URL or command
                        val address = server.url ?: server.command
                        if (address != null) {
                            Text(
                                address,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                            )
                        }
                    }
                },
                leadingContent = {
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(PlumBlue.copy(alpha = 0.15f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Default.Extension,
                            contentDescription = null,
                            tint = PlumBlue,
                            modifier = Modifier.size(22.dp),
                        )
                    }
                },
                trailingContent = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Switch(
                            checked = server.enabled,
                            onCheckedChange = onToggleEnabled,
                            colors = SwitchDefaults.colors(
                                checkedThumbColor = MaterialTheme.colorScheme.primary,
                                checkedTrackColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.4f),
                            ),
                        )
                    }
                },
                colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface),
            )

            HorizontalDivider(
                modifier = Modifier.padding(horizontal = 16.dp),
                color = MaterialTheme.colorScheme.outlineVariant,
            )

            // Action row
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Test button
                FilledTonalButton(
                    onClick = onTest,
                    enabled = testResult !is TestResult.Testing,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    AnimatedContent(
                        targetState = testResult,
                        transitionSpec = { fadeIn() togetherWith fadeOut() },
                        label = "mcp_test",
                    ) { result ->
                        when (result) {
                            is TestResult.Testing -> Row(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                                Text("Testing…", style = MaterialTheme.typography.labelMedium)
                            }
                            is TestResult.Success -> Row(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.Default.Check, contentDescription = null, tint = PlumGreen, modifier = Modifier.size(14.dp))
                                Text("Connected", style = MaterialTheme.typography.labelMedium, color = PlumGreen)
                            }
                            is TestResult.Failure -> Row(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.Default.Close, contentDescription = null, tint = PlumRed, modifier = Modifier.size(14.dp))
                                Text("Failed", style = MaterialTheme.typography.labelMedium, color = PlumRed)
                            }
                            else -> Row(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(14.dp))
                                Text("Test", style = MaterialTheme.typography.labelMedium)
                            }
                        }
                    }
                }

                // Expand tools button
                IconButton(onClick = onToggleExpand) {
                    Icon(
                        if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                        contentDescription = if (isExpanded) "Collapse" else "Show tools",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                IconButton(onClick = onEdit) {
                    Icon(Icons.Default.Edit, contentDescription = "Edit", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }

                IconButton(onClick = { showDeleteConfirm = true }) {
                    Icon(Icons.Default.Delete, contentDescription = "Delete", tint = PlumRed)
                }
            }

            // Expandable tools section
            AnimatedVisibility(
                visible = isExpanded,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut(),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Available tools",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(8.dp))
                    // Placeholder — real implementation would fetch tools from server
                    Text(
                        "Tools are discovered when the server connects.\nEnable the server and test connection to populate.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    if (server.args.isNotEmpty()) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Args: ${server.args.joinToString(" ")}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (server.env.isNotEmpty()) {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "Env: ${server.env.keys.joinToString(", ")}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }
        }
    }

    if (showDeleteConfirm) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("Remove MCP server") },
            text = { Text("Remove '${server.name}'? This cannot be undone.") },
            confirmButton = {
                TextButton(
                    onClick = { showDeleteConfirm = false; onDelete() },
                    colors = ButtonDefaults.textButtonColors(contentColor = PlumRed),
                ) { Text("Remove") }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) { Text("Cancel") }
            },
        )
    }
}

// ── MCP server edit form ──────────────────────────────────────────────────────

@Composable
private fun McpServerEditForm(
    server: McpServer?,
    onSave: (
        name: String,
        type: McpServerType,
        url: String?,
        command: String?,
        args: List<String>,
        env: Map<String, String>,
    ) -> Unit,
    onCancel: () -> Unit,
) {
    var name by remember { mutableStateOf(server?.name ?: "") }
    var selectedType by remember { mutableStateOf(server?.type ?: McpServerType.SSE) }
    var url by remember { mutableStateOf(server?.url ?: "") }
    var command by remember { mutableStateOf(server?.command ?: "") }
    var argsText by remember { mutableStateOf(server?.args?.joinToString(" ") ?: "") }
    var authToken by remember { mutableStateOf("") }
    var tokenVisible by remember { mutableStateOf(false) }
    var envText by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = if (server == null) "Add MCP Server" else "Edit MCP Server",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
        )

        // Name
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            label = { Text("Server name") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            shape = RoundedCornerShape(12.dp),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary, focusedLabelColor = MaterialTheme.colorScheme.primary),
        )

        // Type selector
        Column {
            Text(
                "Transport type",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(8.dp))
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                McpServerType.entries.forEachIndexed { index, type ->
                    SegmentedButton(
                        selected = selectedType == type,
                        onClick = { selectedType = type },
                        shape = SegmentedButtonDefaults.itemShape(index = index, count = McpServerType.entries.size),
                        label = {
                            Text(
                                when (type) {
                                    McpServerType.SSE -> "SSE (HTTP)"
                                    McpServerType.SUBPROCESS -> "Subprocess"
                                },
                                style = MaterialTheme.typography.labelSmall,
                            )
                        },
                    )
                }
            }
        }

        // Type-specific fields
        AnimatedVisibility(visible = selectedType == McpServerType.SSE) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text("Server URL") },
                    placeholder = { Text("https://mcp.example.com/sse") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary, focusedLabelColor = MaterialTheme.colorScheme.primary),
                )
                OutlinedTextField(
                    value = authToken,
                    onValueChange = { authToken = it },
                    label = { Text("Auth token (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    visualTransformation = if (tokenVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    trailingIcon = {
                        IconButton(onClick = { tokenVisible = !tokenVisible }) {
                            Icon(
                                if (tokenVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                contentDescription = null,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    },
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary, focusedLabelColor = MaterialTheme.colorScheme.primary),
                )
            }
        }

        AnimatedVisibility(visible = selectedType == McpServerType.SUBPROCESS) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = command,
                    onValueChange = { command = it },
                    label = { Text("Command") },
                    placeholder = { Text("npx @mcp-server/package") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary, focusedLabelColor = MaterialTheme.colorScheme.primary),
                )
                OutlinedTextField(
                    value = argsText,
                    onValueChange = { argsText = it },
                    label = { Text("Arguments (space-separated)") },
                    placeholder = { Text("--port 3000 --verbose") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary, focusedLabelColor = MaterialTheme.colorScheme.primary),
                )
                OutlinedTextField(
                    value = envText,
                    onValueChange = { envText = it },
                    label = { Text("Environment (KEY=VALUE, one per line)") },
                    placeholder = { Text("API_KEY=abc123\nDEBUG=true") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                    maxLines = 4,
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary, focusedLabelColor = MaterialTheme.colorScheme.primary),
                )
            }
        }

        // Buttons
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            TextButton(onClick = onCancel, modifier = Modifier.weight(1f)) {
                Text("Cancel")
            }
            Button(
                onClick = {
                    val args = argsText.split(" ").map { it.trim() }.filter { it.isNotBlank() }
                    val env = envText.lines()
                        .map { it.trim() }
                        .filter { it.contains("=") }
                        .associate { line ->
                            val (key, value) = line.split("=", limit = 2)
                            key.trim() to value.trim()
                        }
                    onSave(
                        name,
                        selectedType,
                        url.takeIf { selectedType == McpServerType.SSE && it.isNotBlank() },
                        command.takeIf { selectedType == McpServerType.SUBPROCESS && it.isNotBlank() },
                        args,
                        env,
                    )
                },
                enabled = name.isNotBlank() && (
                    (selectedType == McpServerType.SSE && url.isNotBlank()) ||
                    (selectedType == McpServerType.SUBPROCESS && command.isNotBlank())
                ),
                modifier = Modifier.weight(2f),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
            ) {
                Text(if (server == null) "Add" else "Save")
            }
        }

        Spacer(Modifier.height(24.dp))
    }
}
