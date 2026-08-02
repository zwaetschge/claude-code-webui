package com.claudewebui.app.ui.screens.dashboard

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.Brightness4
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.Category
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionStatus
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumBottomBar
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.SectionHeading
import com.claudewebui.app.ui.components.common.providerColor
import com.claudewebui.app.ui.components.common.providerLabel
import com.claudewebui.app.ui.components.common.providerModel
import com.claudewebui.app.ui.components.dashboard.NewSessionDialog
import org.koin.compose.viewmodel.koinViewModel

@Composable
fun DashboardScreen(
    onNavigateToChat: (sessionId: String) -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateMain: (MainDestination) -> Unit = {},
    viewModel: DashboardViewModel = koinViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    var showNewSessionDialog by remember { mutableStateOf(false) }
    var selectedFilter by remember { mutableStateOf("All") }

    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            when (event) {
                is DashboardEvent.NavigateToChat -> onNavigateToChat(event.sessionId)
                DashboardEvent.ShowNewSessionDialog -> showNewSessionDialog = true
                DashboardEvent.NavigateToSettings -> onNavigateToSettings()
                else -> Unit
            }
        }
    }

    val visibleSessions = state.filteredSessions.filter { session ->
        when (selectedFilter) {
            "Running" -> session.status == SessionStatus.RUNNING
            "Starred" -> session.starred
            else -> true
        }
    }
    val runningCount = state.sessions.count { it.status == SessionStatus.RUNNING }
    val attentionCount = state.sessions.count { it.status == SessionStatus.ERROR }

    PlumBackdrop {
        Scaffold(
            containerColor = Color.Transparent,
            bottomBar = {
                PlumBottomBar(
                    selected = MainDestination.SESSIONS,
                    onNavigate = onNavigateMain,
                    badgeCount = attentionCount,
                )
            },
            floatingActionButton = {
                Box(
                    modifier = Modifier
                        .size(62.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(
                            Brush.linearGradient(
                                listOf(Color(0xFFC46DFF), Color(0xFF317CF4)),
                            ),
                        )
                        .clickable { showNewSessionDialog = true },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Default.Add, "New session", tint = Color.White, modifier = Modifier.size(32.dp))
                }
            },
        ) { padding ->
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                item {
                    SessionsHeader(
                        online = !state.isOffline,
                        onSettings = onNavigateToSettings,
                    )
                }
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        WorkspaceHero(
                            runningCount = runningCount,
                            sessions = state.sessions,
                            modifier = Modifier.weight(1.45f),
                        )
                        ApprovalHero(
                            count = attentionCount,
                            modifier = Modifier.weight(.95f),
                        )
                    }
                }
                item {
                    TextField(
                        value = state.searchQuery,
                        onValueChange = viewModel::setSearchQuery,
                        placeholder = { Text("Search sessions, folders or providers", color = PlumMuted) },
                        leadingIcon = { Icon(Icons.Outlined.Search, null, tint = PlumMuted) },
                        trailingIcon = {
                            Box(
                                Modifier
                                    .border(1.dp, PlumBorder, RoundedCornerShape(9.dp))
                                    .padding(horizontal = 8.dp, vertical = 5.dp),
                            ) {
                                Text("⌘ K", color = PlumMuted, fontSize = 11.sp)
                            }
                        },
                        singleLine = true,
                        shape = RoundedCornerShape(18.dp),
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = PlumSurfaceStrong,
                            unfocusedContainerColor = PlumSurfaceStrong,
                            focusedIndicatorColor = Color.Transparent,
                            unfocusedIndicatorColor = Color.Transparent,
                            cursorColor = PlumAccent,
                            focusedTextColor = PlumText,
                            unfocusedTextColor = PlumText,
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(1.dp, PlumBorder, RoundedCornerShape(18.dp)),
                    )
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        listOf("All", "Running", "Starred", "Recent").forEach { label ->
                            FilterPill(
                                label = if (label == "All") "All  ${state.sessions.size}" else label,
                                selected = selectedFilter == label,
                                onClick = { selectedFilter = label },
                            )
                        }
                    }
                }
                item {
                    SectionHeading(
                        title = "Recent sessions",
                        trailing = { Text("Updated now", color = PlumMuted, fontSize = 13.sp) },
                    )
                }
                if (state.isInitialLoading) {
                    item {
                        Box(Modifier.fillMaxWidth().height(160.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = PlumAccent)
                        }
                    }
                } else if (visibleSessions.isEmpty()) {
                    item {
                        GlassPanel(Modifier.fillMaxWidth()) {
                            Column(
                                Modifier.padding(28.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Icon(Icons.Outlined.ChatBubbleOutline, null, tint = PlumMuted, modifier = Modifier.size(32.dp))
                                Spacer(Modifier.height(10.dp))
                                Text("No sessions found", color = PlumText, fontWeight = FontWeight.SemiBold)
                                Text("Create one to start working.", color = PlumMuted, fontSize = 13.sp)
                            }
                        }
                    }
                } else {
                    items(visibleSessions, key = { it.id }) { session ->
                        PlumSessionCard(session = session, onClick = { onNavigateToChat(session.id) })
                    }
                }
                item { Spacer(Modifier.height(72.dp)) }
            }
        }
    }

    if (showNewSessionDialog) {
        NewSessionDialog(
            categories = state.categories,
            providers = state.availableProviders,
            onDismiss = { showNewSessionDialog = false },
            onCreate = { name, provider, directory ->
                showNewSessionDialog = false
                viewModel.createSession(name, directory, provider)
            },
        )
    }
}

@Composable
private fun SessionsHeader(online: Boolean, onSettings: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Brush.linearGradient(listOf(Color(0xFFBF67F5), Color(0xFF2E7AEF))))
                .border(1.dp, PlumAccent, RoundedCornerShape(16.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Check, null, tint = Color.White, modifier = Modifier.size(27.dp))
        }
        Column(Modifier.padding(start = 12.dp).weight(1f)) {
            Text("PLUM CODE", color = PlumMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            Text("Sessions", color = PlumText, fontSize = 31.sp, fontWeight = FontWeight.Bold)
        }
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(24.dp))
                .background(PlumSurfaceStrong)
                .border(1.dp, PlumBorder, RoundedCornerShape(24.dp))
                .padding(horizontal = 13.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(9.dp).background(if (online) PlumGreen else PlumRed, CircleShape))
            Spacer(Modifier.width(7.dp))
            Text(if (online) "Online" else "Offline", color = PlumText, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
        }
        Spacer(Modifier.width(8.dp))
        PlumIconButton(Icons.Outlined.Brightness4, "Settings", onSettings)
    }
}

@Composable
private fun WorkspaceHero(runningCount: Int, sessions: List<Session>, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .height(126.dp)
            .clip(RoundedCornerShape(22.dp))
            .background(Brush.linearGradient(listOf(Color(0xFFBB65EF), Color(0xFF2D7CE8))))
            .padding(18.dp),
    ) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.SpaceBetween) {
            Text("Live workspace", color = Color.White.copy(alpha = .74f), fontWeight = FontWeight.SemiBold)
            Row(verticalAlignment = Alignment.Bottom) {
                Text(runningCount.toString(), color = Color.White, fontSize = 40.sp, fontWeight = FontWeight.Bold)
                Text("  active sessions", color = Color.White.copy(alpha = .85f), modifier = Modifier.padding(bottom = 7.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row {
                    sessions.filter { it.status == SessionStatus.RUNNING }.take(4).forEachIndexed { index, session ->
                        Box(
                            Modifier
                                .padding(start = if (index == 0) 0.dp else 2.dp)
                                .size(20.dp)
                                .background(providerColor(session.cliProvider), CircleShape)
                                .border(2.dp, Color(0xFF5937A7), CircleShape),
                        )
                    }
                }
                Spacer(Modifier.width(6.dp))
                Text("Providers are working", color = Color.White.copy(alpha = .72f), fontSize = 11.sp, maxLines = 1)
            }
        }
    }
}

@Composable
private fun ApprovalHero(count: Int, modifier: Modifier = Modifier) {
    GlassPanel(modifier = modifier.height(126.dp), radius = 22.dp) {
        Column(
            Modifier.fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Box(
                Modifier.size(36.dp).background(Color(0x3DFFAA14), RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.WarningAmber, null, tint = if (count > 0) Color(0xFFFFC052) else PlumMuted)
            }
            Text(
                if (count == 1) "1 approval" else "$count approvals",
                color = PlumText,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
            )
            Text(
                if (count > 0) "A session needs your attention." else "Nothing is waiting.",
                color = PlumMuted,
                fontSize = 12.sp,
                maxLines = 2,
            )
        }
    }
}

@Composable
private fun FilterPill(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(24.dp))
            .background(if (selected) Color(0x2EB56BFF) else PlumSurfaceStrong)
            .border(1.dp, if (selected) PlumAccent else PlumBorder, RoundedCornerShape(24.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp),
    ) {
        Text(label, color = if (selected) PlumText else PlumMuted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun PlumSessionCard(session: Session, onClick: () -> Unit) {
    val accent = when (session.status) {
        SessionStatus.RUNNING -> PlumGreen
        SessionStatus.ERROR -> Color(0xFFFFB536)
        SessionStatus.STOPPED -> PlumBorder
    }
    GlassPanel(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        radius = 22.dp,
        borderColor = accent,
    ) {
        Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(11.dp).background(accent, CircleShape))
                Text(
                    session.name,
                    color = PlumText,
                    fontSize = 19.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 11.dp).weight(1f),
                )
                Box(
                    Modifier
                        .clip(RoundedCornerShape(11.dp))
                        .background(providerColor(session.cliProvider).copy(alpha = .16f))
                        .border(1.dp, providerColor(session.cliProvider), RoundedCornerShape(11.dp))
                        .padding(horizontal = 13.dp, vertical = 6.dp),
                ) {
                    Text(providerLabel(session.cliProvider), color = providerColor(session.cliProvider), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.FolderOpen, null, tint = PlumMuted, modifier = Modifier.size(17.dp))
                Text(
                    session.workingDirectory,
                    color = PlumMuted,
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
            session.lastMessage?.takeIf { it.isNotBlank() }?.let { message ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (session.status == SessionStatus.ERROR) Icons.Outlined.WarningAmber else Icons.Outlined.ChatBubbleOutline,
                        null,
                        tint = if (session.status == SessionStatus.ERROR) Color(0xFFFFC052) else PlumMuted,
                        modifier = Modifier.size(18.dp),
                    )
                    Text(
                        message,
                        color = if (session.status == SessionStatus.ERROR) Color(0xFFFFC96B) else PlumMuted,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    when (session.status) {
                        SessionStatus.RUNNING -> "now  •  working"
                        SessionStatus.ERROR -> "Needs attention"
                        SessionStatus.STOPPED -> "Idle"
                    },
                    color = PlumMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.weight(1f),
                )
                Box(
                    Modifier
                        .clip(RoundedCornerShape(14.dp))
                        .background(Color(0xFF232629))
                        .border(1.dp, PlumBorder, RoundedCornerShape(14.dp))
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                ) {
                    Text(providerModel(session.cliProvider), color = PlumMuted, fontSize = 11.sp)
                }
            }
        }
    }
}
