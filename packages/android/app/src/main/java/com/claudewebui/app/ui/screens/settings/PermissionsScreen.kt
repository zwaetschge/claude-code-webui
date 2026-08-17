package com.claudewebui.app.ui.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumText

/**
 * Permission policy is session-scoped on the server. The former screen edited
 * an in-memory rule list that no harness consumed, so this page now documents
 * the real controls instead of presenting non-functional switches.
 */
@Composable
fun PermissionsScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
) {
    PlumBackdrop {
        Scaffold(containerColor = Color.Transparent) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    PlumScreenHeader(
                        title = "Permissions",
                        subtitle = "Controls the active harness, per session",
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
                    PermissionFact(
                        icon = { Icon(Icons.Outlined.Security, null, tint = PlumAccent) },
                        title = "Execution mode",
                        body = "Open a chat, then Session settings. Plan, Auto, Manual and Danger are sent to the running provider immediately and persisted by the server.",
                    )
                }
                item {
                    PermissionFact(
                        icon = { Icon(Icons.Outlined.FolderOpen, null, tint = PlumAccent) },
                        title = "Allowed directories",
                        body = "Additional server paths are managed in the same Session settings sheet. The backend validates that each directory exists before granting access.",
                    )
                }
                item {
                    Text(
                        "Tool-specific global rules are not a Plum WebUI server concept. The app no longer stores local rules that cannot be enforced.",
                        color = PlumMuted,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(8.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun PermissionFact(
    icon: @Composable () -> Unit,
    title: String,
    body: String,
) {
    GlassPanel(Modifier.fillMaxWidth(), radius = 18.dp) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            icon()
            Text(title, color = PlumText, fontWeight = FontWeight.Bold)
            Text(body, color = PlumMuted, fontSize = 12.sp)
        }
    }
}
