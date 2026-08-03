package com.claudewebui.app.ui.screens.activity

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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.FilterAlt
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PauseCircle
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
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
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionStatus
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumBlue
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumNavScaffold
import com.claudewebui.app.ui.theme.LocalPlumPalette
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.SectionHeading
import com.claudewebui.app.ui.components.common.Sparkline
import com.claudewebui.app.ui.components.common.StatusPill
import com.claudewebui.app.ui.components.common.providerColor
import com.claudewebui.app.ui.components.common.providerModel
import com.claudewebui.app.ui.screens.dashboard.DashboardViewModel
import org.koin.compose.viewmodel.koinViewModel

private enum class ActivityFilter(val label: String) {
    ALL("All"), AGENTS("Agents"), TOOLS("Tools"), PERMISSIONS("Permissions"), ERRORS("Errors")
}

@Composable
fun ActivityScreen(
    onNavigateMain: (MainDestination) -> Unit,
    onOpenSession: (String) -> Unit,
    viewModel: DashboardViewModel = koinViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    var filter by remember { mutableStateOf(ActivityFilter.ALL) }
    val sessions = when (filter) {
        ActivityFilter.ERRORS -> state.sessions.filter { it.status == SessionStatus.ERROR }
        else -> state.sessions
    }
    val running = state.sessions.count { it.status == SessionStatus.RUNNING }
    val waiting = state.sessions.count { it.status == SessionStatus.STOPPED }
    val errors = state.sessions.count { it.status == SessionStatus.ERROR }

    PlumBackdrop {
        PlumNavScaffold(
            selected = MainDestination.ACTIVITY,
            onNavigate = onNavigateMain,
            badgeCount = errors,
        ) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(bottom = 18.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                item {
                    PlumScreenHeader(
                        title = "Activity",
                        subtitle = "Realtime overview of agents, tools and events",
                        live = true,
                        actions = {
                            PlumIconButton(Icons.Outlined.FilterAlt, "Filter", {})
                            PlumIconButton(Icons.Outlined.Search, "Search", {})
                        },
                    )
                }
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 14.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        ActivityMetric("Running", running, Icons.Outlined.PlayCircle, PlumGreen, Modifier.weight(1f))
                        ActivityMetric("Waiting", waiting, Icons.Outlined.PauseCircle, PlumAmber, Modifier.weight(1f))
                        ActivityMetric("Tools", 0, Icons.Outlined.Build, PlumBlue, Modifier.weight(1f))
                        ActivityMetric("Permissions", 0, Icons.Outlined.Security, PlumAccent, Modifier.weight(1f))
                        ActivityMetric("Errors", errors, Icons.Outlined.ErrorOutline, PlumRed, Modifier.weight(1f))
                    }
                }
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        ActivityFilter.entries.forEach { option ->
                            Box(
                                Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(if (filter == option) LocalPlumPalette.current.selectionTint else Color.Transparent)
                                    .border(1.dp, if (filter == option) PlumAccent else PlumBorder, RoundedCornerShape(12.dp))
                                    .clickable { filter = option }
                                    .padding(vertical = 10.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    option.label,
                                    color = if (filter == option) PlumText else PlumMuted,
                                    fontSize = 10.sp,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                }
                item {
                    SectionHeading(
                        title = "Live Activity",
                        modifier = Modifier.padding(horizontal = 16.dp),
                        trailing = {
                            Text("Clear completed", color = PlumAccent, fontSize = 13.sp)
                        },
                    )
                }
                item {
                    GlassPanel(Modifier.fillMaxWidth().padding(horizontal = 14.dp), radius = 18.dp) {
                        if (sessions.isEmpty()) {
                            Column(
                                Modifier.fillMaxWidth().padding(34.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Icon(Icons.Outlined.CheckCircle, null, tint = PlumMuted, modifier = Modifier.size(30.dp))
                                Spacer(Modifier.height(8.dp))
                                Text("No matching activity", color = PlumText, fontWeight = FontWeight.SemiBold)
                                Text("New live events will appear here.", color = PlumMuted, fontSize = 12.sp)
                            }
                        } else {
                            Column {
                                sessions.forEachIndexed { index, session ->
                                    ActivityRow(session = session, onClick = { onOpenSession(session.id) })
                                    if (index < sessions.lastIndex) {
                                        Box(Modifier.fillMaxWidth().padding(horizontal = 14.dp).height(1.dp).background(PlumBorder))
                                    }
                                }
                            }
                        }
                    }
                }
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 18.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(8.dp).background(PlumGreen, CircleShape))
                        Text("  Connected to plum-code-webui", color = PlumMuted, fontSize = 12.sp, modifier = Modifier.weight(1f))
                        Text("Last update: just now", color = PlumMuted, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun ActivityMetric(
    label: String,
    value: Int,
    icon: ImageVector,
    color: Color,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier.height(112.dp), radius = 16.dp) {
        Column(
            Modifier.fillMaxSize().padding(horizontal = 7.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Box(Modifier.size(31.dp).background(color.copy(alpha = .16f), CircleShape), contentAlignment = Alignment.Center) {
                Icon(icon, null, tint = color, modifier = Modifier.size(18.dp))
            }
            Text(value.toString(), color = color, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Text(label, color = PlumMuted, fontSize = 9.sp, maxLines = 1)
            Sparkline(color, listOf(1f, 1f, 2f, 1f, 3f, 2f, value.toFloat().coerceAtLeast(1f)), Modifier.fillMaxWidth().height(11.dp))
        }
    }
}

@Composable
private fun ActivityRow(session: Session, onClick: () -> Unit) {
    val color = when (session.status) {
        SessionStatus.RUNNING -> PlumGreen
        SessionStatus.STOPPED -> PlumMuted
        SessionStatus.ERROR -> PlumRed
    }
    val label = when (session.status) {
        SessionStatus.RUNNING -> "Running"
        SessionStatus.STOPPED -> "Completed"
        SessionStatus.ERROR -> "Error"
    }
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(15.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier.size(42.dp).background(providerColor(session.cliProvider).copy(alpha = .16f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.PlayCircle, null, tint = providerColor(session.cliProvider), modifier = Modifier.size(23.dp))
        }
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(session.name, color = PlumText, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                session.lastMessage ?: "Session ready",
                color = PlumMuted,
                fontSize = 13.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text("${providerModel(session.cliProvider)}  •  ${session.workingDirectory.substringAfterLast('/')}", color = PlumMuted, fontSize = 11.sp)
        }
        Column(horizontalAlignment = Alignment.End) {
            StatusPill(label, color)
            Spacer(Modifier.height(7.dp))
            Icon(Icons.Outlined.MoreVert, "More", tint = PlumMuted, modifier = Modifier.size(20.dp))
        }
    }
}
