package com.claudewebui.app.ui.screens.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ExitToApp
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Brightness4
import androidx.compose.material.icons.outlined.Cached
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.CloudQueue
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Hub
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.SettingsEthernet
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.CLIProviderConfig
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumBlue
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumNavScaffold
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.StatusPill
import com.claudewebui.app.ui.theme.AppThemeOption
import com.claudewebui.app.ui.components.common.providerColor

@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    onNavigateToProviders: () -> Unit,
    onNavigateToCliProvider: (String) -> Unit = {},
    onNavigateToMcp: () -> Unit,
    onNavigateToCliTools: () -> Unit,
    onNavigateToAgents: () -> Unit,
    onNavigateToPermissions: () -> Unit,
    onNavigateToIntegrations: () -> Unit,
    onNavigateToOperations: () -> Unit,
    onLoggedOut: () -> Unit,
    onNavigateMain: (MainDestination) -> Unit = {},
) {
    val state by viewModel.uiState.collectAsState()
    var showLogoutDialog by remember { mutableStateOf(false) }
    var showThemePicker by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { viewModel.ensureLoaded() }

    PlumBackdrop {
        PlumNavScaffold(MainDestination.SETTINGS, onNavigateMain) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    PlumScreenHeader(
                        title = "Settings",
                        subtitle = "Connection, providers and app preferences",
                        actions = {
                            PlumIconButton(Icons.Outlined.Refresh, "Refresh", viewModel::loadSettings)
                            PlumIconButton(Icons.Outlined.HelpOutline, "Help", {})
                        },
                    )
                }
                item {
                    GlassPanel(Modifier.fillMaxWidth(), radius = 19.dp) {
                        Column(Modifier.padding(16.dp)) {
                            Text("Server Status", color = PlumText, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                            Row(Modifier.padding(top = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(10.dp).background(PlumGreen, CircleShape))
                                Column(Modifier.weight(1f).padding(horizontal = 11.dp)) {
                                    Text("Connected to plum-code-webui", color = PlumText, fontWeight = FontWeight.Bold)
                                    Text(state.serverUrl.ifBlank { "Server configured" }, color = PlumMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                StatusPill("Healthy", PlumGreen)
                            }
                            Box(Modifier.fillMaxWidth().padding(vertical = 13.dp).height(1.dp).background(PlumBorder))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.Sync, null, tint = PlumMuted, modifier = Modifier.size(18.dp))
                                Text("  Last sync: just now", color = PlumMuted, fontSize = 12.sp)
                            }
                        }
                    }
                }
                item {
                    GlassPanel(Modifier.fillMaxWidth(), radius = 19.dp) {
                        Column(Modifier.padding(horizontal = 14.dp, vertical = 13.dp)) {
                            Text("Providers", color = PlumText, fontSize = 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 5.dp))
                            CLIProvider.active.forEachIndexed { index, provider ->
                                ProviderRow(
                                    provider = provider,
                                    config = state.cliProviders.firstOrNull {
                                        it.id.equals(provider.name, ignoreCase = true)
                                    },
                                    // The row is about this CLI harness, so it
                                    // opens that harness — not the unrelated
                                    // database-provider list.
                                    onClick = { onNavigateToCliProvider(provider.name.lowercase()) },
                                )
                                if (index < CLIProvider.active.lastIndex) Box(Modifier.fillMaxWidth().height(1.dp).background(PlumBorder))
                            }
                        }
                    }
                }
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        SettingsGroup("Security", Modifier.weight(1f)) {
                            CompactSettingRow(Icons.Outlined.Fingerprint, "Biometric lock", "Use fingerprint", PlumAccent) {
                                PlumSwitch(state.biometricEnabled) { viewModel.setBiometricEnabled(it) }
                            }
                            CompactSettingRow(Icons.Outlined.Security, "Encrypted tokens", "Stored securely", PlumAccent) {
                                PlumSwitch(true, null)
                            }
                            CompactSettingRow(Icons.Outlined.Lock, "Permissions", "Per session", PlumAccent, onNavigateToPermissions)
                        }
                        SettingsGroup("Appearance", Modifier.weight(1f)) {
                            CompactSettingRow(
                                Icons.Outlined.Brightness4,
                                "Theme",
                                state.theme.label,
                                PlumMuted,
                                onClick = { showThemePicker = true },
                            )
                            CompactSettingRow(
                                Icons.Outlined.AutoAwesome,
                                "Background effects",
                                if (state.theme == AppThemeOption.EINK) "Off (E-Ink)" else "Subtle glow",
                                PlumMuted,
                            )
                        }
                    }
                }
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        SettingsGroup("Notifications & Sync", Modifier.weight(1f)) {
                            CompactSettingRow(Icons.Outlined.Notifications, "Push notifications", "Receive app updates", PlumAccent) {
                                PlumSwitch(state.notificationsEnabled) { viewModel.setNotificationsEnabled(it) }
                            }
                            CompactSettingRow(Icons.Outlined.Sync, "Background sync", "Keep data up to date", PlumAccent) {
                                PlumSwitch(true, null)
                            }
                            CompactSettingRow(Icons.Outlined.CloudQueue, "Offline cache", state.cacheSize, PlumAccent) {
                                Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = PlumMuted)
                            }
                        }
                        SettingsGroup("Advanced", Modifier.weight(1f)) {
                            CompactSettingRow(Icons.Outlined.SettingsEthernet, "MCP Servers", "${state.mcpServers.size} configured", PlumMuted, onNavigateToMcp)
                            CompactSettingRow(
                                Icons.Outlined.SmartToy,
                                "Agents & Skills",
                                "${state.configAgents.size + state.agents.size} agents · ${state.configSkills.size} skills",
                                PlumMuted,
                                onNavigateToAgents,
                            )
                            CompactSettingRow(Icons.Outlined.Terminal, "CLI Tools", "${state.cliTools.size} tools", PlumMuted, onNavigateToCliTools)
                            CompactSettingRow(
                                Icons.Outlined.Hub,
                                "Integrations",
                                "ComfyUI · Discord · Home Assistant",
                                PlumMuted,
                                onNavigateToIntegrations,
                            )
                            CompactSettingRow(
                                Icons.Outlined.AdminPanelSettings,
                                "Operations",
                                "Containers, watchdogs, audit",
                                PlumMuted,
                                onNavigateToOperations,
                            )
                        }
                    }
                }
                item {
                    GlassPanel(
                        modifier = Modifier.fillMaxWidth().clickable { showLogoutDialog = true },
                        radius = 18.dp,
                        borderColor = PlumRed.copy(alpha = .45f),
                    ) {
                        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.AutoMirrored.Outlined.ExitToApp, null, tint = PlumRed, modifier = Modifier.size(27.dp))
                            Column(Modifier.weight(1f).padding(start = 13.dp)) {
                                Text("Log out", color = PlumRed, fontWeight = FontWeight.Bold)
                                Text("Sign out of your Plum Code account", color = PlumMuted, fontSize = 12.sp)
                            }
                            Icon(Icons.Outlined.ChevronRight, null, tint = PlumMuted)
                        }
                    }
                }
                item { Spacer(Modifier.height(5.dp)) }
            }
        }
    }

    if (showThemePicker) {
        AlertDialog(
            onDismissRequest = { showThemePicker = false },
            containerColor = PlumSurfaceStrong,
            title = { Text("Theme", color = PlumText) },
            text = {
                Column {
                    AppThemeOption.entries.forEach { option ->
                        val selected = option == state.theme
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .clickable {
                                    viewModel.updateTheme(option)
                                    showThemePicker = false
                                }
                                .padding(vertical = 11.dp, horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                Modifier
                                    .size(15.dp)
                                    .clip(CircleShape)
                                    .background(if (selected) PlumAccent else Color.Transparent)
                                    .border(1.dp, if (selected) PlumAccent else PlumBorder, CircleShape)
                            )
                            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                                Text(option.label, color = PlumText, fontWeight = FontWeight.Medium)
                                Text(option.description, color = PlumMuted, fontSize = 11.sp)
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showThemePicker = false }) { Text("Close", color = PlumAccent) }
            },
        )
    }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text("Log out?") },
            text = { Text("You can sign in to Plum Code again at any time.") },
            confirmButton = {
                TextButton(onClick = {
                    showLogoutDialog = false
                    viewModel.logout(onLoggedOut)
                }) { Text("Log out", color = PlumRed) }
            },
            dismissButton = { TextButton(onClick = { showLogoutDialog = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun ProviderRow(provider: CLIProvider, config: CLIProviderConfig?, onClick: () -> Unit) {
    val connected = config?.available ?: (provider == CLIProvider.CODEX || provider == CLIProvider.OPENCODE)
    val enabled = config?.enabled ?: true
    val status = when {
        !enabled -> "Disabled"
        connected -> "Connected"
        else -> "Needs login"
    }
    val statusColor = when {
        !enabled -> PlumMuted
        connected -> PlumGreen
        else -> PlumAmber
    }
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(9.dp).background(providerColor(provider), CircleShape))
        Column(Modifier.weight(1f).padding(horizontal = 11.dp)) {
            Text(
                provider.displayName,
                color = PlumText,
                fontWeight = FontWeight.Medium,
            )
            Text("${provider.name.lowercase()}@plum.code", color = PlumMuted, fontSize = 11.sp)
        }
        StatusPill(status, statusColor)
        Icon(Icons.Outlined.ChevronRight, null, tint = PlumMuted, modifier = Modifier.padding(start = 7.dp))
    }
}

@Composable
private fun SettingsGroup(title: String, modifier: Modifier, content: @Composable () -> Unit) {
    GlassPanel(modifier, radius = 18.dp) {
        Column(Modifier.fillMaxWidth().padding(12.dp)) {
            Text(title, color = PlumText, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 5.dp))
            content()
        }
    }
}

@Composable
private fun CompactSettingRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    tint: Color,
    onClick: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(19.dp))
        Column(Modifier.weight(1f).padding(start = 6.dp)) {
            Text(title, color = PlumText, fontSize = 10.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle.isNotBlank()) Text(subtitle, color = PlumMuted, fontSize = 8.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        trailing?.invoke() ?: if (onClick != null) Icon(Icons.Outlined.ChevronRight, null, tint = PlumMuted, modifier = Modifier.size(17.dp)) else Unit
    }
}

@Composable
private fun PlumSwitch(checked: Boolean, onCheckedChange: ((Boolean) -> Unit)?) {
    Box(
        modifier = Modifier
            .size(width = 38.dp, height = 22.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (checked) PlumAccent else Color(0xFF3A3D40))
            .border(1.dp, if (checked) PlumAccent else PlumBorder, RoundedCornerShape(12.dp))
            .then(
                if (onCheckedChange != null) Modifier.clickable { onCheckedChange(!checked) }
                else Modifier
            )
            .padding(2.dp),
        contentAlignment = if (checked) Alignment.CenterEnd else Alignment.CenterStart,
    ) {
        Box(Modifier.size(17.dp).background(Color.White, CircleShape))
    }
}
