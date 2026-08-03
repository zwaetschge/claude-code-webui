package com.claudewebui.app.ui.screens.operations

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.AdminUser
import com.claudewebui.app.data.model.AuditLogEntry
import com.claudewebui.app.data.model.DockerContainer
import com.claudewebui.app.data.model.Watchdog
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
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
import com.claudewebui.app.ui.components.common.metricColumns

/**
 * Containers, watchdogs, users and the audit log in one operations view.
 */
@Composable
fun OperationsScreen(
    viewModel: OperationsViewModel,
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
                        title = "Operations",
                        subtitle = state.dockerStatus?.let { status ->
                            if (status.available) {
                                "Docker ${status.serverVersion ?: "connected"}"
                            } else {
                                status.error ?: "Docker unavailable"
                            }
                        } ?: "Containers, watchdogs and access",
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

                state.stats?.let { stats ->
                    item {
                        val metrics = listOf(
                            "Users" to stats.userCount.toString(),
                            "Sessions" to stats.sessionCount.toString(),
                            "Running" to stats.runningSessionCount.toString(),
                            "Audit" to stats.auditCount.toString(),
                        )
                        val perRow = metricColumns()
                        Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                            metrics.chunked(perRow).forEach { rowMetrics ->
                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                                ) {
                                    rowMetrics.forEach { (label, value) ->
                                        GlassPanel(Modifier.weight(1f), radius = 15.dp) {
                                            Column(Modifier.padding(13.dp)) {
                                                Text(
                                                    value,
                                                    color = PlumText,
                                                    fontSize = 21.sp,
                                                    fontWeight = FontWeight.Bold,
                                                )
                                                Text(label, color = PlumMuted, fontSize = 11.sp)
                                            }
                                        }
                                    }
                                    // Keep a short final row aligned with the
                                    // one above instead of stretching its cells.
                                    repeat(perRow - rowMetrics.size) {
                                        Box(Modifier.weight(1f))
                                    }
                                }
                            }
                        }
                    }
                }

                item {
                    Row(
                        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        TabChip("Containers", state.tab == OperationsTab.CONTAINERS) {
                            viewModel.selectTab(OperationsTab.CONTAINERS)
                        }
                        TabChip("Watchdogs", state.tab == OperationsTab.WATCHDOGS) {
                            viewModel.selectTab(OperationsTab.WATCHDOGS)
                        }
                        TabChip("Users", state.tab == OperationsTab.USERS) {
                            viewModel.selectTab(OperationsTab.USERS)
                        }
                        TabChip("Audit", state.tab == OperationsTab.AUDIT) {
                            viewModel.selectTab(OperationsTab.AUDIT)
                        }
                    }
                }

                if (state.isLoading) {
                    item {
                        Box(
                            Modifier.fillMaxWidth().height(120.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(color = PlumAccent, strokeWidth = 2.5.dp)
                        }
                    }
                } else {
                    when (state.tab) {
                        OperationsTab.CONTAINERS -> {
                            if (state.containers.isEmpty()) {
                                item { EmptyCard("No containers visible") }
                            }
                            items(state.containers, key = { it.id }) { ContainerRow(it) }
                        }

                        OperationsTab.WATCHDOGS -> {
                            if (state.watchdogs.isEmpty()) {
                                item {
                                    EmptyCard(
                                        if (state.adminDenied) {
                                            "Admin access required"
                                        } else {
                                            "No watchdogs configured"
                                        },
                                    )
                                }
                            }
                            items(state.watchdogs, key = { it.id }) { WatchdogRow(it) }
                        }

                        OperationsTab.USERS -> {
                            if (state.users.isEmpty()) {
                                item {
                                    EmptyCard(
                                        if (state.adminDenied) {
                                            "Admin access required"
                                        } else {
                                            "No users"
                                        },
                                    )
                                }
                            }
                            items(state.users, key = { it.id }) { UserRow(it) }
                        }

                        OperationsTab.AUDIT -> {
                            if (state.audit.isEmpty()) {
                                item {
                                    EmptyCard(
                                        if (state.adminDenied) {
                                            "Admin access required"
                                        } else {
                                            "No audit entries"
                                        },
                                    )
                                }
                            }
                            items(state.audit, key = { it.id }) { AuditRow(it) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TabChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Text(
        label,
        color = if (selected) PlumText else PlumMuted,
        fontSize = 12.sp,
        fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
        maxLines = 1,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(if (selected) PlumAccent.copy(alpha = .18f) else PlumSubtleFill)
            .clickable(onClick = onClick)
            .padding(horizontal = 15.dp, vertical = 9.dp),
    )
}

@Composable
private fun EmptyCard(message: String) {
    GlassPanel(Modifier.fillMaxWidth(), radius = 16.dp) {
        Box(Modifier.fillMaxWidth().padding(26.dp), contentAlignment = Alignment.Center) {
            Text(message, color = PlumMuted, fontSize = 12.sp)
        }
    }
}

@Composable
private fun ContainerRow(container: DockerContainer) {
    GlassPanel(Modifier.fillMaxWidth(), radius = 16.dp) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    container.name,
                    color = PlumText,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                StatusPill(
                    container.state,
                    if (container.isRunning) PlumGreen else PlumMuted,
                )
            }
            Text(
                container.image,
                color = PlumMuted,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                buildString {
                    append(container.status)
                    val ports = container.ports.joinToString(", ") { it.raw }
                    if (ports.isNotBlank()) append(" · ").append(ports)
                },
                color = PlumMuted,
                fontSize = 11.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun WatchdogRow(watchdog: Watchdog) {
    GlassPanel(Modifier.fillMaxWidth(), radius = 16.dp) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    watchdog.containerName.ifBlank { watchdog.containerId.take(12) },
                    color = PlumText,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                StatusPill(
                    if (watchdog.enabled) "enabled" else "paused",
                    if (watchdog.enabled) PlumGreen else PlumMuted,
                )
            }
            Text(
                "${watchdog.autonomyLevel} · ${watchdog.sessionProvider}",
                color = PlumMuted,
                fontSize = 11.sp,
            )
            watchdog.lastIncidentAt?.let {
                Text("Last incident ${it.take(19)}", color = PlumAmber, fontSize = 11.sp)
            }
        }
    }
}

@Composable
private fun UserRow(user: AdminUser) {
    GlassPanel(Modifier.fillMaxWidth(), radius = 16.dp) {
        Row(
            Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    user.name?.takeIf { it.isNotBlank() } ?: user.email,
                    color = PlumText,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "${user.email} · ${user.sessionCount} sessions",
                    color = PlumMuted,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            StatusPill(
                user.role,
                if (user.role == "admin") PlumAccent else PlumMuted,
            )
            if (user.status != "active") {
                StatusPill(user.status, PlumRed)
            }
        }
    }
}

@Composable
private fun AuditRow(entry: AuditLogEntry) {
    GlassPanel(Modifier.fillMaxWidth(), radius = 14.dp) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                entry.action,
                color = PlumText,
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                buildString {
                    append(entry.createdAt.take(19).replace('T', ' '))
                    entry.actorEmail?.let { append(" · ").append(it) }
                    entry.ip?.let { append(" · ").append(it) }
                },
                color = PlumMuted,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
