package com.claudewebui.app.ui.screens.settings

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.ui.text.input.PasswordVisualTransformation
import com.claudewebui.app.data.model.UpdateDiscordSettingsInput
import com.claudewebui.app.data.model.UpdateHomeAssistantSettingsInput
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.StatusPill
import com.claudewebui.app.ui.components.common.isTabletWidth

/**
 * ComfyUI, Discord and Home Assistant status with connection probes.
 */
@Composable
fun IntegrationsScreen(
    viewModel: IntegrationsViewModel,
    onNavigateBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val wide = isTabletWidth()

    LaunchedEffect(Unit) { viewModel.ensureLoaded() }

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
                        title = "Integrations",
                        subtitle = "Image generation, alerts and home automation",
                        actions = {
                            PlumIconButton(Icons.Outlined.Refresh, "Reload", viewModel::load)
                            PlumIconButton(
                                Icons.AutoMirrored.Outlined.ArrowBack,
                                "Back",
                                onNavigateBack,
                            )
                        },
                    )
                }

                if (state.isLoading) {
                    item {
                        Box(
                            Modifier.fillMaxWidth().height(140.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(color = PlumAccent, strokeWidth = 2.5.dp)
                        }
                    }
                } else {
                    item {
                        val comfy = state.comfyUi
                        IntegrationCard(
                            title = "ComfyUI",
                            enabled = comfy?.enabled == true,
                            configured = !comfy?.url.isNullOrBlank(),
                            details = listOfNotNull(
                                comfy?.url?.takeIf { it.isNotBlank() }?.let { "URL  $it" },
                            ),
                            test = state.comfyTest,
                            onTest = viewModel::testComfyUi,
                        )
                    }

                    item {
                        val discord = state.discord
                        IntegrationCard(
                            title = "Discord",
                            enabled = discord?.enabled == true,
                            configured = discord?.configured == true,
                            details = listOfNotNull(
                                discord?.transport?.takeIf { it.isNotBlank() }
                                    ?.let { "Transport  $it" },
                                discord?.channelLabel?.takeIf { it.isNotBlank() }
                                    ?.let { "Channel  #$it" },
                                discord?.minSeverity?.takeIf { it.isNotBlank() }
                                    ?.let { "Min severity  $it" },
                                discord?.let {
                                    "Outbox  ${it.outboxPending} pending · ${it.outboxFailed} failed"
                                },
                                discord?.lastSentAt?.let { "Last sent  ${it.take(19)}" },
                            ),
                            warning = state.discord?.lastError,
                            test = state.discordTest,
                            onTest = viewModel::testDiscord,
                        )
                    }

                    item {
                        val ha = state.homeAssistant
                        IntegrationCard(
                            title = "Home Assistant",
                            enabled = ha?.enabled == true,
                            configured = ha?.configured == true,
                            details = listOfNotNull(
                                ha?.baseUrl?.takeIf { it.isNotBlank() }?.let { "URL  $it" },
                                ha?.let {
                                    "Token  " + if (it.accessTokenConfigured) "configured" else "missing"
                                },
                            ),
                            test = state.haTest,
                            onTest = viewModel::testHomeAssistant,
                        )
                    }

                    item {
                        IntegrationEditor(state = state, viewModel = viewModel)
                    }

                    item {
                        Text(
                            "Secrets are write-only: the server reports only whether a token " +
                                "is present. Leave a field empty to keep the stored value.",
                            color = PlumMuted,
                            fontSize = 11.sp,
                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 6.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun IntegrationCard(
    title: String,
    enabled: Boolean,
    configured: Boolean,
    details: List<String>,
    test: TestState,
    onTest: () -> Unit,
    warning: String? = null,
) {
    GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
        Column(
            Modifier.fillMaxWidth().padding(15.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title,
                    color = PlumText,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                )
                StatusPill(
                    when {
                        enabled -> "enabled"
                        configured -> "configured"
                        else -> "off"
                    },
                    when {
                        enabled -> PlumGreen
                        configured -> PlumAccent
                        else -> PlumMuted
                    },
                )
            }

            details.forEach { line ->
                Text(
                    line,
                    color = PlumMuted,
                    fontSize = 12.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            warning?.takeIf { it.isNotBlank() }?.let {
                Text(it, color = PlumRed, fontSize = 11.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    when {
                        test.running -> "Testing…"
                        test.ok == true -> "Reachable"
                        test.ok == false -> test.message ?: "Failed"
                        else -> ""
                    },
                    color = when (test.ok) {
                        true -> PlumGreen
                        false -> PlumRed
                        else -> PlumMuted
                    },
                    fontSize = 12.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (test.running) {
                    CircularProgressIndicator(
                        color = PlumAccent,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(17.dp),
                    )
                }
                Text(
                    "Test",
                    color = PlumText,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        .background(if (test.running) PlumSubtleFill else PlumAccent.copy(alpha = .18f))
                        .clickable(enabled = !test.running, onClick = onTest)
                        .padding(horizontal = 15.dp, vertical = 9.dp),
                )
            }
        }
    }
}

/**
 * Edit form for the three integrations. Only non-empty fields are submitted, so
 * a stored secret survives a save that leaves its field blank; the explicit
 * "clear" toggles are the way to remove one.
 */
@Composable
private fun IntegrationEditor(
    state: IntegrationsUiState,
    viewModel: IntegrationsViewModel,
) {
    var comfyUrl by remember(state.comfyUi?.url) { mutableStateOf(state.comfyUi?.url.orEmpty()) }
    var comfyEnabled by remember(state.comfyUi?.enabled) {
        mutableStateOf(state.comfyUi?.enabled ?: false)
    }

    var discordWebhook by remember { mutableStateOf("") }
    var discordChannel by remember(state.discord?.channelId) {
        mutableStateOf(state.discord?.channelId.orEmpty())
    }
    var discordEnabled by remember(state.discord?.enabled) {
        mutableStateOf(state.discord?.enabled ?: false)
    }

    var haUrl by remember(state.homeAssistant?.baseUrl) {
        mutableStateOf(state.homeAssistant?.baseUrl.orEmpty())
    }
    var haToken by remember { mutableStateOf("") }
    var haEnabled by remember(state.homeAssistant?.enabled) {
        mutableStateOf(state.homeAssistant?.enabled ?: false)
    }

    GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
        Column(
            Modifier.fillMaxWidth().padding(15.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("Configure", color = PlumText, fontSize = 15.sp, fontWeight = FontWeight.Bold)

            state.savedNotice?.let { Text(it, color = PlumGreen, fontSize = 12.sp) }
            state.saveError?.let { Text(it, color = PlumRed, fontSize = 12.sp) }

            // ComfyUI
            Text("ComfyUI", color = PlumMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            OutlinedTextField(
                value = comfyUrl,
                onValueChange = { comfyUrl = it },
                label = { Text("Base URL") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            ToggleRow("Enabled", comfyEnabled) { comfyEnabled = it }
            SaveRow(state.isSaving) {
                viewModel.saveComfyUi(comfyUrl.trim().takeIf { it.isNotBlank() }, comfyEnabled)
            }

            // Discord
            Text("Discord", color = PlumMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            OutlinedTextField(
                value = discordWebhook,
                onValueChange = { discordWebhook = it },
                label = { Text("Webhook URL (leave blank to keep)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = discordChannel,
                onValueChange = { discordChannel = it.filter(Char::isDigit) },
                label = { Text("Channel ID") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            ToggleRow("Enabled", discordEnabled) { discordEnabled = it }
            SaveRow(state.isSaving) {
                viewModel.saveDiscord(
                    UpdateDiscordSettingsInput(
                        enabled = discordEnabled,
                        webhookUrl = discordWebhook.trim().takeIf { it.isNotBlank() },
                        channelId = discordChannel.trim().takeIf { it.isNotBlank() },
                    )
                )
                discordWebhook = ""
            }

            // Home Assistant
            Text("Home Assistant", color = PlumMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            OutlinedTextField(
                value = haUrl,
                onValueChange = { haUrl = it },
                label = { Text("Base URL") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = haToken,
                onValueChange = { haToken = it },
                label = { Text("Long-lived token (leave blank to keep)") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )
            ToggleRow("Enabled", haEnabled) { haEnabled = it }
            SaveRow(state.isSaving) {
                viewModel.saveHomeAssistant(
                    UpdateHomeAssistantSettingsInput(
                        enabled = haEnabled,
                        baseUrl = haUrl.trim().takeIf { it.isNotBlank() },
                        accessToken = haToken.trim().takeIf { it.isNotBlank() },
                    )
                )
                haToken = ""
            }
        }
    }
}

@Composable
private fun ToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = PlumText, fontSize = 13.sp, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun SaveRow(saving: Boolean, onSave: () -> Unit) {
    Text(
        if (saving) "Saving…" else "Save",
        color = if (saving) PlumMuted else PlumAccent,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clickable(enabled = !saving, onClick = onSave)
            .padding(vertical = 6.dp),
    )
}
