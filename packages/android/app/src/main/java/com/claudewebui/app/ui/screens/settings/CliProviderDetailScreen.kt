package com.claudewebui.app.ui.screens.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.Switch
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
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.StatusPill
import com.claudewebui.app.ui.components.common.isTabletWidth
import com.claudewebui.app.ui.components.common.providerColor
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import com.claudewebui.app.data.model.CliLoginSession
import com.claudewebui.app.data.model.ZaiApiStatus
import com.claudewebui.app.ui.components.common.PlumRed

/**
 * Detail view for one CLI harness.
 *
 * The settings list previously sent every provider row to the "AI Providers"
 * screen, which lists database-stored API providers — a different concept that
 * happens to be empty. This shows what the row actually refers to: whether the
 * harness is available, and which model it runs.
 */
@Composable
fun CliProviderDetailScreen(
    providerId: String,
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val provider = CLIProvider.entries.firstOrNull { it.name.equals(providerId, ignoreCase = true) }
    val config = state.cliProviders.firstOrNull { it.id.equals(providerId, ignoreCase = true) }
    val selectedModel = state.userSettings?.cliProviderModels?.get(providerId.lowercase())
        ?: config?.defaultModel
    // Before the registry arrives, "no config" and "harness not installed" look
    // identical — say which one it is instead of claiming it needs a login.
    val stillLoading = config == null && state.isLoading

    PlumBackdrop {
        Scaffold(containerColor = Color.Transparent) { padding ->
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
                        title = provider?.displayName ?: providerId,
                        subtitle = "Harness status and model",
                        actions = {
                            PlumIconButton(
                                Icons.AutoMirrored.Outlined.ArrowBack,
                                "Back",
                                onNavigateBack,
                            )
                        },
                    )
                }

                item {
                    GlassPanel(Modifier.fillMaxWidth(), radius = 19.dp) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                provider?.let {
                                    Box(Modifier.size(10.dp).background(providerColor(it), CircleShape))
                                }
                                Text(
                                    "  Status",
                                    color = PlumText,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.weight(1f),
                                )
                                val available = config?.available == true
                                when {
                                    stillLoading -> StatusPill("Loading…", PlumMuted)
                                    available -> StatusPill("Available", PlumGreen)
                                    else -> StatusPill("Needs login", PlumAmber)
                                }
                            }
                            DetailRow("Enabled", if (config?.enabled != false) "Yes" else "No")
                            DetailRow("Default model", config?.defaultModel ?: if (stillLoading) "…" else "—")
                            DetailRow("Models offered", if (stillLoading) "…" else (config?.models?.size?.toString() ?: "0"))
                        }
                    }
                }

                item {
                    CliLoginPanel(
                        providerId = providerId,
                        available = config?.available == true,
                        login = state.cliLogin?.takeIf { state.cliLoginProvider == providerId },
                        error = state.cliLoginError,
                        onStart = { viewModel.startCliLogin(providerId) },
                        onSubmitCode = viewModel::submitCliLoginCode,
                        onCancel = viewModel::cancelCliLogin,
                    )
                }

                if (providerId.lowercase() in setOf("codex", "opencode", "pi")) {
                    item {
                        RuntimeDefaultsPanel(
                            providerId = providerId.lowercase(),
                            reasoning = state.userSettings?.cliProviderReasoning
                                ?.get(providerId.lowercase()) ?: "medium",
                            codexWebSearch = state.userSettings?.codexWebSearch ?: "auto",
                            codexFast = state.userSettings?.cliProviderServiceTiers
                                ?.get("codex") == "fast",
                            onReasoning = { viewModel.setProviderReasoning(providerId, it) },
                            onWebSearch = viewModel::setCodexWebSearch,
                            onFastTier = viewModel::setCodexFastTier,
                        )
                    }
                }

                if (providerId.equals("zai", ignoreCase = true)) {
                    item {
                        ZaiApiPanel(
                            status = state.zaiApi,
                            saving = state.zaiApiSaving,
                            error = state.error,
                            onSave = viewModel::saveZaiApi,
                            onReset = viewModel::resetZaiApi,
                        )
                    }
                }

                if (providerId.equals("opencode", ignoreCase = true)) {
                    item {
                        OpenCodeProvidersPanel(
                            providers = state.openCodeProviders,
                            saving = state.openCodeSaving,
                            tests = state.openCodeTestResults,
                            testMessages = state.openCodeTestMessages,
                            error = state.error,
                            onSave = viewModel::saveOpenCodeProvider,
                            onDelete = viewModel::deleteOpenCodeProvider,
                            onTest = viewModel::testOpenCodeProvider,
                        )
                    }
                }

                if (!config?.models.isNullOrEmpty()) {
                    item {
                        Text(
                            "Model for new sessions",
                            color = PlumText,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                    items(config!!.models) { model ->
                        val active = model == selectedModel
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(13.dp))
                                .background(PlumSubtleFill)
                                .border(
                                    1.dp,
                                    if (active) PlumAccent else PlumBorder,
                                    RoundedCornerShape(13.dp),
                                )
                                .clickable { viewModel.setProviderModel(providerId, model) }
                                .padding(13.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                model,
                                color = PlumText,
                                fontSize = 13.sp,
                                modifier = Modifier.weight(1f),
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (active) {
                                Icon(
                                    Icons.Outlined.Check,
                                    "Selected",
                                    tint = PlumAccent,
                                    modifier = Modifier.size(19.dp),
                                )
                            }
                        }
                    }
                } else {
                    item {
                        GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
                            Box(
                                Modifier.fillMaxWidth().height(90.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    if (stillLoading) "Loading models…"
                                    else "This harness reports no model list",
                                    color = PlumMuted,
                                    fontSize = 12.sp,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ZaiApiPanel(
    status: ZaiApiStatus?,
    saving: Boolean,
    error: String?,
    onSave: (String, String, String, String, String) -> Unit,
    onReset: () -> Unit,
) {
    var baseUrl by remember(status?.baseUrl) {
        mutableStateOf(status?.baseUrl?.ifBlank { "https://api.z.ai/api/anthropic" }
            ?: "https://api.z.ai/api/anthropic")
    }
    var token by remember(status?.authTokenPreview) { mutableStateOf("") }
    var opus by remember(status?.opusModel) { mutableStateOf(status?.opusModel.orEmpty()) }
    var sonnet by remember(status?.sonnetModel) { mutableStateOf(status?.sonnetModel.orEmpty()) }
    var haiku by remember(status?.haikuModel) { mutableStateOf(status?.haikuModel.orEmpty()) }
    val canSave = baseUrl.isNotBlank() && (status?.configured == true || token.isNotBlank()) && !saving

    GlassPanel(Modifier.fillMaxWidth(), radius = 19.dp) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Z.AI endpoint", color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    Text(
                        "Separate from Claude subscription sessions.",
                        color = PlumMuted,
                        fontSize = 11.sp,
                    )
                }
                StatusPill(if (status?.configured == true) "Configured" else "Not configured", if (status?.configured == true) PlumGreen else PlumMuted)
            }
            OutlinedTextField(
                value = baseUrl,
                onValueChange = { baseUrl = it },
                label = { Text("Base URL") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = token,
                onValueChange = { token = it },
                label = { Text(if (status?.hasAuthToken == true) "New API token (leave blank to keep)" else "API token") },
                supportingText = status?.authTokenPreview?.let { preview -> { Text("Stored: $preview") } },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(value = opus, onValueChange = { opus = it }, label = { Text("Opus model") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = sonnet, onValueChange = { sonnet = it }, label = { Text("Sonnet model") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = haiku, onValueChange = { haiku = it }, label = { Text("Haiku model") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = PlumRed, fontSize = 11.sp) }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                if (status?.configured == true) ActionButton("Reset", enabled = !saving, onClick = onReset)
                ActionButton("Save", enabled = canSave) {
                    onSave(baseUrl, token, opus, sonnet, haiku)
                }
            }
        }
    }
}

@Composable
private fun RuntimeDefaultsPanel(
    providerId: String,
    reasoning: String,
    codexWebSearch: String,
    codexFast: Boolean,
    onReasoning: (String) -> Unit,
    onWebSearch: (String) -> Unit,
    onFastTier: (Boolean) -> Unit,
) {
    val reasoningOptions = if (providerId == "codex") {
        listOf("none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra")
    } else {
        listOf("low", "medium", "high", "max")
    }

    GlassPanel(Modifier.fillMaxWidth(), radius = 19.dp) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            Text("Runtime defaults", color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Text(
                "Applied to new sessions and the next provider turn.",
                color = PlumMuted,
                fontSize = 12.sp,
            )
            Text("Reasoning", color = PlumMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            reasoningOptions.chunked(4).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    row.forEach { option ->
                        ChoiceChip(
                            label = option,
                            selected = reasoning == option,
                            modifier = Modifier.weight(1f),
                        ) { onReasoning(option) }
                    }
                    repeat(4 - row.size) { Box(Modifier.weight(1f)) }
                }
            }

            if (providerId == "codex") {
                Text("Web search", color = PlumMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    listOf("auto", "cached", "live", "disabled").forEach { option ->
                        ChoiceChip(
                            label = option,
                            selected = codexWebSearch == option,
                            modifier = Modifier.weight(1f),
                        ) { onWebSearch(option) }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Fast service tier", color = PlumText, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        Text("Uses priority processing when the model supports it.", color = PlumMuted, fontSize = 11.sp)
                    }
                    Switch(checked = codexFast, onCheckedChange = onFastTier)
                }
            }
        }
    }
}

@Composable
private fun ChoiceChip(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .clip(RoundedCornerShape(50))
            .background(if (selected) PlumAccent.copy(alpha = .22f) else PlumSubtleFill)
            .border(1.dp, if (selected) PlumAccent else PlumBorder, RoundedCornerShape(50))
            .clickable(onClick = onClick)
            .padding(horizontal = 7.dp, vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (selected) PlumAccent else PlumText,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
    }
}

/**
 * Runs the harness's own login command on the server and shows what it wants.
 *
 * Two shapes come back: a device-code flow, where the user opens a URL and
 * types a code, and a prompt that wants a code pasted back — the latter is what
 * `awaiting_code` means.
 */
@Composable
private fun CliLoginPanel(
    providerId: String,
    available: Boolean,
    login: CliLoginSession?,
    error: String?,
    onStart: () -> Unit,
    onSubmitCode: (String) -> Unit,
    onCancel: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    val uriHandler = LocalUriHandler.current
    var code by remember(login?.id) { mutableStateOf("") }

    GlassPanel(Modifier.fillMaxWidth(), radius = 19.dp) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            Text("Sign in", color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)

            when {
                login == null -> {
                    Text(
                        if (available) {
                            "This harness is signed in. Run it again to switch accounts."
                        } else {
                            "Run the harness login on the server and follow it here."
                        },
                        color = PlumMuted,
                        fontSize = 12.sp,
                    )
                    ActionButton(if (available) "Sign in again" else "Sign in") { onStart() }
                }

                login.status == "starting" -> {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(
                            color = PlumAccent,
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(16.dp),
                        )
                        Text("  Starting $providerId login…", color = PlumMuted, fontSize = 12.sp)
                    }
                    ActionButton("Cancel") { onCancel() }
                }

                login.status == "completed" -> {
                    Text("Signed in successfully.", color = PlumGreen, fontSize = 12.sp)
                    ActionButton("Done") { onCancel() }
                }

                login.status == "error" -> {
                    Text(login.error ?: "Login failed", color = PlumRed, fontSize = 12.sp)
                    ActionButton("Try again") { onStart() }
                }

                else -> {
                    login.verificationCode?.let { verification ->
                        Text("Enter this code:", color = PlumMuted, fontSize = 11.sp)
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(PlumSubtleFill)
                                .border(1.dp, PlumBorder, RoundedCornerShape(12.dp))
                                .clickable { clipboard.setText(AnnotatedString(verification)) }
                                .padding(13.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                verification,
                                color = PlumText,
                                fontSize = 19.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.weight(1f),
                            )
                            Text("Copy", color = PlumAccent, fontSize = 12.sp)
                        }
                    }
                    login.loginUrl?.let { loginUrl ->
                        ActionButton("Open sign-in page") { uriHandler.openUri(loginUrl) }
                        Text(loginUrl, color = PlumMuted, fontSize = 10.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    if (login.needsCode) {
                        OutlinedTextField(
                            value = code,
                            onValueChange = { code = it },
                            label = { Text("Code from the provider") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        ActionButton("Submit code", enabled = code.isNotBlank()) { onSubmitCode(code.trim()) }
                    }
                    if (login.output.isNotBlank()) {
                        Text(
                            login.output.takeLast(400),
                            color = PlumMuted,
                            fontSize = 10.sp,
                            maxLines = 6,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    ActionButton("Cancel") { onCancel() }
                }
            }

            error?.let { Text(it, color = PlumRed, fontSize = 11.sp) }
        }
    }
}

@Composable
private fun ActionButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Text(
        label,
        color = if (enabled) PlumText else PlumMuted,
        fontSize = 13.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(if (enabled) PlumAccent.copy(alpha = .18f) else PlumSubtleFill)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    )
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = PlumMuted, fontSize = 12.sp, modifier = Modifier.weight(1f))
        Text(
            value,
            color = PlumText,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
