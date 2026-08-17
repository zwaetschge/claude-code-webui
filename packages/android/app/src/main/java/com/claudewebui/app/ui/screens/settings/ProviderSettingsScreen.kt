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
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
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
import com.claudewebui.app.data.model.AIProvider
import com.claudewebui.app.data.model.ProviderType
import com.claudewebui.app.ui.theme.ClaudeColor
import com.claudewebui.app.ui.theme.CodexColor
import com.claudewebui.app.ui.theme.GoogleColor
import kotlinx.coroutines.launch
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumRed

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProviderSettingsScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    var showAddSheet by remember { mutableStateOf(false) }
    var editingProvider by remember { mutableStateOf<AIProvider?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("AI Providers", fontWeight = FontWeight.SemiBold) },
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
                Icon(Icons.Default.Add, contentDescription = "Add provider")
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
            if (state.providers.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(
                            Icons.Default.Cloud,
                            contentDescription = null,
                            modifier = Modifier.size(48.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            "No providers configured",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            "Tap + to add an AI provider",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            state.providers.forEach { provider ->
                ProviderCard(
                    provider = provider,
                    testResult = state.providerTestResults[provider.id] ?: TestResult.Idle,
                    onToggle = { enabled -> viewModel.toggleProvider(provider.id, enabled) },
                    onEdit = { editingProvider = provider },
                    onDelete = { viewModel.deleteProvider(provider.id) },
                    onTest = { viewModel.testProviderConnection(provider.id) },
                )
            }

            Spacer(Modifier.height(72.dp)) // FAB clearance
        }
    }

    // ── Add sheet ─────────────────────────────────────────────────────────────
    if (showAddSheet) {
        ModalBottomSheet(
            onDismissRequest = { showAddSheet = false },
            sheetState = sheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            ProviderEditForm(
                provider = null,
                onSave = { name, type, apiKey, baseUrl, models ->
                    viewModel.addProvider(name, type, apiKey, baseUrl, models)
                    scope.launch { sheetState.hide() }.invokeOnCompletion { showAddSheet = false }
                },
                onCancel = {
                    scope.launch { sheetState.hide() }.invokeOnCompletion { showAddSheet = false }
                },
            )
        }
    }

    // ── Edit sheet ────────────────────────────────────────────────────────────
    editingProvider?.let { provider ->
        ModalBottomSheet(
            onDismissRequest = { editingProvider = null },
            sheetState = sheetState,
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            ProviderEditForm(
                provider = provider,
                onSave = { name, type, apiKey, baseUrl, models ->
                    viewModel.updateProvider(
                        id = provider.id,
                        name = name,
                        apiKey = apiKey,
                        baseUrl = baseUrl,
                        models = models,
                    )
                    scope.launch { sheetState.hide() }.invokeOnCompletion { editingProvider = null }
                },
                onCancel = {
                    scope.launch { sheetState.hide() }.invokeOnCompletion { editingProvider = null }
                },
            )
        }
    }
}

// ── Provider card ─────────────────────────────────────────────────────────────

@Composable
private fun ProviderCard(
    provider: AIProvider,
    testResult: TestResult,
    onToggle: (Boolean) -> Unit,
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
                    Text(provider.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                },
                supportingContent = {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            provider.type.name.lowercase().replaceFirstChar { it.uppercase() },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        provider.defaultModel?.let { model ->
                            Text(
                                "Default: $model",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                leadingContent = {
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(providerColor(provider.type).copy(alpha = 0.15f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = providerInitial(provider.type),
                            style = MaterialTheme.typography.titleMedium,
                            color = providerColor(provider.type),
                            fontWeight = FontWeight.Bold,
                        )
                    }
                },
                trailingContent = {
                    Switch(
                        checked = provider.enabled,
                        onCheckedChange = onToggle,
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = MaterialTheme.colorScheme.primary,
                            checkedTrackColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.4f),
                        ),
                    )
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
            ) {
                // Test connection button
                FilledTonalButton(
                    onClick = onTest,
                    enabled = testResult !is TestResult.Testing,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    AnimatedContent(
                        targetState = testResult,
                        transitionSpec = { fadeIn() togetherWith fadeOut() },
                        label = "test_result",
                    ) { result ->
                        when (result) {
                            is TestResult.Testing -> {
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                                    Text("Testing…", style = MaterialTheme.typography.labelMedium)
                                }
                            }
                            is TestResult.Success -> {
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(Icons.Default.Check, contentDescription = null, tint = PlumGreen, modifier = Modifier.size(14.dp))
                                    Text("Connected", style = MaterialTheme.typography.labelMedium, color = PlumGreen)
                                }
                            }
                            is TestResult.Failure -> {
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(Icons.Default.Close, contentDescription = null, tint = PlumRed, modifier = Modifier.size(14.dp))
                                    Text("Failed", style = MaterialTheme.typography.labelMedium, color = PlumRed)
                                }
                            }
                            else -> {
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(14.dp))
                                    Text("Test", style = MaterialTheme.typography.labelMedium)
                                }
                            }
                        }
                    }
                }

                IconButton(onClick = onEdit) {
                    Icon(Icons.Default.Edit, contentDescription = "Edit", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }

                IconButton(onClick = { showDeleteConfirm = true }) {
                    Icon(Icons.Default.Delete, contentDescription = "Delete", tint = PlumRed)
                }
            }
        }
    }

    if (showDeleteConfirm) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("Remove provider") },
            text = { Text("Remove '${provider.name}'? This cannot be undone.") },
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

// ── Provider edit form ────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProviderEditForm(
    provider: AIProvider?,
    onSave: (name: String, type: ProviderType, apiKey: String?, baseUrl: String?, models: List<String>) -> Unit,
    onCancel: () -> Unit,
) {
    var name by remember { mutableStateOf(provider?.name ?: "") }
    var selectedType by remember { mutableStateOf(provider?.type ?: ProviderType.ANTHROPIC) }
    var apiKey by remember { mutableStateOf("") }
    var apiKeyVisible by remember { mutableStateOf(false) }
    var baseUrl by remember { mutableStateOf(provider?.baseUrl ?: "") }
    var modelsText by remember { mutableStateOf(provider?.models ?: "") }
    var typeDropdownExpanded by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = if (provider == null) "Add Provider" else "Edit Provider",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.SemiBold,
        )

        // Name
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            label = { Text("Name") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            shape = RoundedCornerShape(12.dp),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary, focusedLabelColor = MaterialTheme.colorScheme.primary),
        )

        // Type dropdown
        ExposedDropdownMenuBox(
            expanded = typeDropdownExpanded,
            onExpandedChange = { typeDropdownExpanded = it },
        ) {
            OutlinedTextField(
                value = selectedType.name.lowercase().replaceFirstChar { it.uppercase() },
                onValueChange = {},
                readOnly = true,
                label = { Text("Provider type") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = typeDropdownExpanded) },
                modifier = Modifier.fillMaxWidth().menuAnchor(),
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary, focusedLabelColor = MaterialTheme.colorScheme.primary),
            )
            ExposedDropdownMenu(
                expanded = typeDropdownExpanded,
                onDismissRequest = { typeDropdownExpanded = false },
            ) {
                ProviderType.entries.forEach { type ->
                    DropdownMenuItem(
                        text = { Text(type.name.lowercase().replaceFirstChar { it.uppercase() }) },
                        onClick = {
                            selectedType = type
                            typeDropdownExpanded = false
                        },
                    )
                }
            }
        }

        // API Key (masked)
        OutlinedTextField(
            value = apiKey,
            onValueChange = { apiKey = it },
            label = { Text(if (provider != null) "API key (leave empty to keep current)" else "API key") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            visualTransformation = if (apiKeyVisible) VisualTransformation.None else PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            trailingIcon = {
                IconButton(onClick = { apiKeyVisible = !apiKeyVisible }) {
                    Icon(
                        if (apiKeyVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = if (apiKeyVisible) "Hide" else "Show",
                        modifier = Modifier.size(20.dp),
                    )
                }
            },
            shape = RoundedCornerShape(12.dp),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary, focusedLabelColor = MaterialTheme.colorScheme.primary),
        )

        // Base URL (optional)
        OutlinedTextField(
            value = baseUrl,
            onValueChange = { baseUrl = it },
            label = { Text("Base URL (optional)") },
            placeholder = { Text("https://api.openai.com/v1") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            shape = RoundedCornerShape(12.dp),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary, focusedLabelColor = MaterialTheme.colorScheme.primary),
        )

        // Models (comma-separated)
        OutlinedTextField(
            value = modelsText,
            onValueChange = { modelsText = it },
            label = { Text("Models (comma-separated, optional)") },
            placeholder = { Text("gpt-4o, gpt-3.5-turbo") },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary, focusedLabelColor = MaterialTheme.colorScheme.primary),
        )

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
                    val models = modelsText.split(",").map { it.trim() }.filter { it.isNotBlank() }
                    onSave(name, selectedType, apiKey.takeIf { it.isNotBlank() }, baseUrl.takeIf { it.isNotBlank() }, models)
                },
                enabled = name.isNotBlank(),
                modifier = Modifier.weight(2f),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
            ) {
                Text(if (provider == null) "Add" else "Save")
            }
        }

        Spacer(Modifier.height(24.dp))
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

@Composable
private fun providerColor(type: ProviderType): Color = when (type) {
    ProviderType.ANTHROPIC -> ClaudeColor
    ProviderType.OPENAI -> CodexColor
    ProviderType.GOOGLE -> GoogleColor
    ProviderType.OPENROUTER -> PlumAmber
    ProviderType.OLLAMA -> MaterialTheme.colorScheme.tertiary
    ProviderType.ZAI -> MaterialTheme.colorScheme.secondary
    ProviderType.CUSTOM -> MaterialTheme.colorScheme.onSurfaceVariant
}

private fun providerInitial(type: ProviderType): String = when (type) {
    ProviderType.ANTHROPIC -> "A"
    ProviderType.OPENAI -> "O"
    ProviderType.GOOGLE -> "G"
    ProviderType.OPENROUTER -> "R"
    ProviderType.OLLAMA -> "L"
    ProviderType.ZAI -> "Z"
    ProviderType.CUSTOM -> "C"
}
