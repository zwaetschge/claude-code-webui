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
                        Text(
                            "Credentials are configured in the web UI — the server only " +
                                "reports whether a token is present, never its value.",
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
