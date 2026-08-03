package com.claudewebui.app.ui.screens.settings

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Security
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.PermissionAction
import kotlinx.coroutines.launch
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBlue
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumRed

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PermissionsScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    var showAddSheet by remember { mutableStateOf(false) }
    var editingRule by remember { mutableStateOf<PermissionRule?>(null) }
    var deletingRule by remember { mutableStateOf<PermissionRule?>(null) }
    var showResetDialog by remember { mutableStateOf(false) }

    LaunchedEffect(state.error) {
        state.error?.let { snackbarHostState.showSnackbar(it) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Permissions", fontWeight = FontWeight.SemiBold) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    TextButton(
                        onClick = { showResetDialog = true },
                        enabled = state.permissionRules.isNotEmpty(),
                    ) {
                        Text("Reset All", color = MaterialTheme.colorScheme.error)
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
                Icon(Icons.Default.Add, contentDescription = "Add Rule")
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            // Default permission mode card
            item {
                DefaultPermissionModeCard(
                    current = state.defaultPermissionMode,
                    onModeChange = { action -> scope.launch { viewModel.setDefaultPermissionMode(action) } },
                )
            }

            if (state.permissionRules.isEmpty()) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 48.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Icon(
                                Icons.Default.Security,
                                contentDescription = null,
                                modifier = Modifier.size(48.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                "No custom rules",
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                "Tap + to add a permission rule",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            } else {
                item {
                    Column(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    ) {
                        Text(
                            "CUSTOM RULES",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
                item {
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp),
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                    ) {
                        state.permissionRules.forEachIndexed { index, rule ->
                            PermissionRuleRow(
                                rule = rule,
                                onEdit = { editingRule = rule },
                                onDelete = { deletingRule = rule },
                            )
                            if (index < state.permissionRules.lastIndex) {
                                HorizontalDivider(
                                    modifier = Modifier.padding(horizontal = 16.dp),
                                    color = MaterialTheme.colorScheme.outlineVariant,
                                )
                            }
                        }
                    }
                }
            }

            item { Spacer(Modifier.height(88.dp)) }
        }
    }

    if (showAddSheet) {
        PermissionRuleSheet(
            rule = null,
            onDismiss = { showAddSheet = false },
            onSave = { pattern, action, scope_ ->
                scope.launch {
                    viewModel.addPermissionRule(pattern, action, scope_)
                    showAddSheet = false
                }
            },
        )
    }

    editingRule?.let { rule ->
        PermissionRuleSheet(
            rule = rule,
            onDismiss = { editingRule = null },
            onSave = { pattern, action, scope_ ->
                scope.launch {
                    viewModel.updatePermissionRule(rule.id, pattern, action, scope_)
                    editingRule = null
                }
            },
        )
    }

    deletingRule?.let { rule ->
        AlertDialog(
            onDismissRequest = { deletingRule = null },
            title = { Text("Delete Rule") },
            text = { Text("Delete the rule for \"${rule.toolPattern}\"?") },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            viewModel.deletePermissionRule(rule.id)
                            deletingRule = null
                        }
                    },
                ) {
                    Text("Delete", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { deletingRule = null }) { Text("Cancel") }
            },
        )
    }

    if (showResetDialog) {
        AlertDialog(
            onDismissRequest = { showResetDialog = false },
            title = { Text("Reset All Rules") },
            text = { Text("Remove all ${state.permissionRules.size} custom permission rules? This cannot be undone.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            viewModel.resetAllPermissions()
                            showResetDialog = false
                        }
                    },
                ) {
                    Text("Reset", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showResetDialog = false }) { Text("Cancel") }
            },
        )
    }
}

// ── Default Permission Mode Card ───────────────────────────────────────────────

@Composable
private fun DefaultPermissionModeCard(
    current: PermissionAction,
    onModeChange: (PermissionAction) -> Unit,
) {
    val modes = listOf(
        PermissionAction.ALLOW_ONCE to "Ask",
        PermissionAction.ALLOW_GLOBAL to "Auto-Allow",
        PermissionAction.DENY to "Deny",
    )

    Column(modifier = Modifier.padding(16.dp)) {
        Text(
            "DEFAULT MODE",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(8.dp))
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "Default permission behavior for all tools unless overridden by a custom rule.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                    modes.forEachIndexed { index, (action, label) ->
                        SegmentedButton(
                            selected = current == action,
                            onClick = { onModeChange(action) },
                            shape = SegmentedButtonDefaults.itemShape(index, modes.size),
                            label = { Text(label) },
                        )
                    }
                }
                // Description of current mode
                AnimatedContent(targetState = current, label = "permissionMode") { mode ->
                    val (color, desc) = when (mode) {
                        PermissionAction.ALLOW_ONCE -> PlumAmber to "The active provider will prompt you before using each tool."
                        PermissionAction.ALLOW_GLOBAL, PermissionAction.ALLOW_PROJECT -> PlumGreen to "The active provider can use tools without confirmation."
                        PermissionAction.DENY -> PlumRed to "Tool calls are blocked by default."
                    }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(color.copy(alpha = 0.1f))
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .background(color),
                        )
                        Text(
                            desc,
                            style = MaterialTheme.typography.bodySmall,
                            color = color,
                        )
                    }
                }
            }
        }
    }
}

// ── Permission Rule Row ────────────────────────────────────────────────────────

@Composable
private fun PermissionRuleRow(
    rule: PermissionRule,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    val (actionColor, actionLabel) = when (rule.action) {
        PermissionAction.ALLOW_ONCE -> PlumGreen to "Allow Once"
        PermissionAction.ALLOW_PROJECT -> PlumGreen to "Allow Project"
        PermissionAction.ALLOW_GLOBAL -> PlumGreen to "Allow Global"
        PermissionAction.DENY -> PlumRed to "Deny"
    }

    val scopeColor = when (rule.scope) {
        PermissionScope.GLOBAL -> MaterialTheme.colorScheme.primary
        PermissionScope.SESSION -> PlumBlue
    }

    ListItem(
        headlineContent = {
            Text(
                rule.toolPattern,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
            )
        },
        supportingContent = {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(top = 4.dp),
            ) {
                PermissionBadge(label = actionLabel, color = actionColor)
                PermissionBadge(label = rule.scope.name.lowercase().replaceFirstChar { it.uppercase() }, color = scopeColor)
            }
        },
        trailingContent = {
            Row {
                IconButton(onClick = onEdit) {
                    Icon(
                        Icons.Default.Edit,
                        contentDescription = "Edit",
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp),
                    )
                }
                IconButton(onClick = onDelete) {
                    Icon(
                        Icons.Default.Delete,
                        contentDescription = "Delete",
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
        },
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface),
    )
}

@Composable
private fun PermissionBadge(label: String, color: Color) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = color,
            fontWeight = FontWeight.Medium,
        )
    }
}

// ── Permission Rule Sheet ──────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PermissionRuleSheet(
    rule: PermissionRule?,
    onDismiss: () -> Unit,
    onSave: (pattern: String, action: PermissionAction, scope: PermissionScope) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var pattern by remember { mutableStateOf(rule?.toolPattern ?: "") }
    var selectedAction by remember { mutableStateOf(rule?.action ?: PermissionAction.ALLOW_GLOBAL) }
    var selectedScope by remember { mutableStateOf(rule?.scope ?: PermissionScope.GLOBAL) }

    val isValid = pattern.isNotBlank()

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                if (rule == null) "New Permission Rule" else "Edit Rule",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )

            // Tool Pattern
            OutlinedTextField(
                value = pattern,
                onValueChange = { pattern = it },
                label = { Text("Tool Pattern *") },
                placeholder = { Text("e.g. Bash, Read, Write:*, mcp__*") },
                supportingText = { Text("Use * as wildcard. Matches tool names exactly or by prefix.") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    focusedLabelColor = MaterialTheme.colorScheme.primary,
                ),
            )

            // Action selector
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "Action",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                val actions = listOf(
                    PermissionAction.ALLOW_GLOBAL to "Allow",
                    PermissionAction.DENY to "Deny",
                    PermissionAction.ALLOW_ONCE to "Allow Once",
                )
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    actions.forEach { (action, label) ->
                        val (color, desc) = when (action) {
                            PermissionAction.ALLOW_GLOBAL -> PlumGreen to "Always permit this tool"
                            PermissionAction.DENY -> PlumRed to "Always block this tool"
                            PermissionAction.ALLOW_ONCE -> PlumBlue to "Permit once per request"
                            PermissionAction.ALLOW_PROJECT -> PlumAmber to "Permit for this project"
                        }
                        val isSelected = selectedAction == action
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(
                                    if (isSelected) color.copy(alpha = 0.12f)
                                    else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
                                )
                                .then(
                                    Modifier.let {
                                        it
                                    }
                                )
                                .padding(12.dp),
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                androidx.compose.material3.RadioButton(
                                    selected = isSelected,
                                    onClick = { selectedAction = action },
                                    colors = androidx.compose.material3.RadioButtonDefaults.colors(
                                        selectedColor = color,
                                    ),
                                )
                                Column {
                                    Text(
                                        label,
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                                        color = if (isSelected) color else MaterialTheme.colorScheme.onSurface,
                                    )
                                    Text(
                                        desc,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // Scope selector
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "Scope",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                    listOf(PermissionScope.SESSION, PermissionScope.GLOBAL).forEachIndexed { index, scope ->
                        SegmentedButton(
                            selected = selectedScope == scope,
                            onClick = { selectedScope = scope },
                            shape = SegmentedButtonDefaults.itemShape(index, 2),
                            label = {
                                Text(
                                    when (scope) {
                                        PermissionScope.SESSION -> "Session"
                                        PermissionScope.GLOBAL -> "Global"
                                    }
                                )
                            },
                        )
                    }
                }
                Text(
                    when (selectedScope) {
                        PermissionScope.SESSION -> "Rule applies only to the current session."
                        PermissionScope.GLOBAL -> "Rule persists across all sessions."
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // Save / Cancel
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                TextButton(
                    onClick = onDismiss,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Cancel")
                }
                androidx.compose.material3.Button(
                    onClick = { onSave(pattern.trim(), selectedAction, selectedScope) },
                    modifier = Modifier.weight(1f),
                    enabled = isValid,
                    colors = androidx.compose.material3.ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                    ),
                ) {
                    Text(if (rule == null) "Add Rule" else "Save")
                }
            }

            Spacer(Modifier.height(8.dp))
        }
    }
}
