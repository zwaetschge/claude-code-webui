package com.claudewebui.app.ui.screens.analytics

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.DeveloperBoard
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.koin.compose.viewmodel.koinViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive

// ── Data Models ───────────────────────────────────────────────────────────────

enum class ContainerHealth { HEALTHY, UNHEALTHY, UNKNOWN }

data class ContainerInfo(
    val name: String,
    val health: ContainerHealth,
    val uptime: String = "",
    val version: String = ""
)

data class RebuildEntry(
    val timestamp: String,
    val success: Boolean,
    val message: String
)

data class WatchdogUiState(
    val isLoading: Boolean = false,
    val serverHealth: ContainerHealth = ContainerHealth.UNKNOWN,
    val serverUptime: String = "",
    val serverVersion: String = "",
    val activeSessions: List<Session> = emptyList(),
    val activeSessionCount: Int = 0,
    val containers: List<ContainerInfo> = emptyList(),
    val rebuildInProgress: Boolean = false,
    val lastRebuildStatus: String = "",
    val rebuildHistory: List<RebuildEntry> = emptyList(),
    val recentErrors: List<String> = emptyList(),
    val error: String? = null
)

// ── ViewModel ─────────────────────────────────────────────────────────────────

class WatchdogViewModel(
    private val api: ApiClient
) : ViewModel() {

    private val _uiState = MutableStateFlow(WatchdogUiState())
    val uiState: StateFlow<WatchdogUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)

            // Health check
            runCatching {
                val resp = api.health()
                val healthy = resp.status.value in 200..299
                _uiState.value = _uiState.value.copy(
                    serverHealth = if (healthy) ContainerHealth.HEALTHY else ContainerHealth.UNHEALTHY
                )
            }.onFailure {
                _uiState.value = _uiState.value.copy(serverHealth = ContainerHealth.UNHEALTHY)
            }

            // Sessions
            runCatching {
                val resp = api.getSessions()
                if (resp.success && resp.data != null) {
                    val active = resp.data.filter { it.status == SessionStatus.RUNNING }
                    _uiState.value = _uiState.value.copy(
                        activeSessions = active,
                        activeSessionCount = active.size
                    )
                }
            }

            // Rebuild status
            runCatching {
                val resp = api.rebuildStatus()
                if (resp.success && resp.data != null) {
                    val obj = resp.data as? JsonObject
                    _uiState.value = _uiState.value.copy(
                        rebuildInProgress = obj?.get("inProgress")?.jsonPrimitive?.booleanOrNull ?: false,
                        lastRebuildStatus = obj?.get("status")?.jsonPrimitive?.content ?: "",
                        serverVersion = obj?.get("version")?.jsonPrimitive?.content ?: "",
                        serverUptime = obj?.get("uptime")?.jsonPrimitive?.content ?: ""
                    )
                }
            }

            // Robot status
            runCatching {
                val resp = api.rebuildRobotStatus()
                if (resp.success && resp.data != null) {
                    val obj = resp.data as? JsonObject
                    val robotHealth = if (obj?.get("running")?.jsonPrimitive?.booleanOrNull == true)
                        ContainerHealth.HEALTHY else ContainerHealth.UNHEALTHY
                    _uiState.value = _uiState.value.copy(
                        containers = listOf(
                            ContainerInfo(
                                "claude-code-webui",
                                _uiState.value.serverHealth,
                                uptime = _uiState.value.serverUptime,
                                version = _uiState.value.serverVersion
                            ),
                            ContainerInfo(
                                "repair-bot",
                                robotHealth,
                                uptime = obj?.get("uptime")?.jsonPrimitive?.content ?: ""
                            )
                        )
                    )
                }
            }.onFailure {
                _uiState.value = _uiState.value.copy(
                    containers = listOf(
                        ContainerInfo(
                            "claude-code-webui",
                            _uiState.value.serverHealth,
                            uptime = _uiState.value.serverUptime
                        ),
                        ContainerInfo("repair-bot", ContainerHealth.UNKNOWN)
                    )
                )
            }

            // Last rebuild result
            runCatching {
                val resp = api.rebuildLastResult()
                if (resp.success && resp.data != null) {
                    val obj = resp.data as? JsonObject
                    val entry = RebuildEntry(
                        timestamp = obj?.get("timestamp")?.jsonPrimitive?.content ?: "",
                        success = obj?.get("success")?.jsonPrimitive?.booleanOrNull ?: false,
                        message = obj?.get("message")?.jsonPrimitive?.content ?: ""
                    )
                    if (entry.timestamp.isNotBlank()) {
                        _uiState.value = _uiState.value.copy(rebuildHistory = listOf(entry))
                    }
                }
            }

            _uiState.value = _uiState.value.copy(isLoading = false)
        }
    }

    fun triggerRebuild() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(rebuildInProgress = true, error = null)
            runCatching {
                val resp = api.triggerRebuild()
                if (resp.success) {
                    _uiState.value = _uiState.value.copy(
                        lastRebuildStatus = "Rebuild triggered – monitoring…"
                    )
                    // Poll for completion
                    repeat(30) {
                        delay(3000)
                        runCatching {
                            val status = api.rebuildStatus()
                            if (status.success && status.data != null) {
                                val obj = status.data as? JsonObject
                                val inProgress = obj?.get("inProgress")?.jsonPrimitive?.booleanOrNull ?: true
                                if (!inProgress) {
                                    _uiState.value = _uiState.value.copy(rebuildInProgress = false)
                                    refresh()
                                    return@repeat
                                }
                            }
                        }
                    }
                } else {
                    _uiState.value = _uiState.value.copy(
                        rebuildInProgress = false,
                        error = resp.error?.message ?: "Rebuild trigger failed"
                    )
                }
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(
                    rebuildInProgress = false,
                    error = e.message
                )
            }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}

// ── Screen ────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WatchdogScreen(
    viewModel: WatchdogViewModel = koinViewModel()
) {
    val state by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var showRebuildDialog by remember { mutableStateOf(false) }

    LaunchedEffect(state.error) {
        state.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    if (showRebuildDialog) {
        RebuildConfirmDialog(
            onConfirm = {
                showRebuildDialog = false
                viewModel.triggerRebuild()
            },
            onDismiss = { showRebuildDialog = false }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "System Monitor",
                        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)
                    )
                },
                actions = {
                    IconButton(onClick = { viewModel.refresh() }) {
                        if (state.isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(paddingValues),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {

            // ── Server health banner ─────────────────────────────────────
            item {
                ServerHealthCard(
                    health = state.serverHealth,
                    uptime = state.serverUptime,
                    version = state.serverVersion,
                    activeSessions = state.activeSessionCount
                )
            }

            // ── Container status ─────────────────────────────────────────
            if (state.containers.isNotEmpty()) {
                item {
                    WatchdogSectionCard(title = "Containers", icon = Icons.Default.Cloud) {
                        Column(
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.padding(top = 8.dp)
                        ) {
                            state.containers.forEach { container ->
                                ContainerRow(container)
                            }
                        }
                    }
                }
            }

            // ── Active sessions ──────────────────────────────────────────
            item {
                WatchdogSectionCard(
                    title = "Active Sessions (${state.activeSessionCount})",
                    icon = Icons.Default.Terminal
                ) {
                    if (state.activeSessions.isEmpty()) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 16.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                "No active sessions",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    } else {
                        Column(
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.padding(top = 8.dp)
                        ) {
                            state.activeSessions.take(5).forEach { session ->
                                ActiveSessionRow(session)
                            }
                            if (state.activeSessions.size > 5) {
                                Text(
                                    "+${state.activeSessions.size - 5} more",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(top = 4.dp)
                                )
                            }
                        }
                    }
                }
            }

            // ── Rebuild section ──────────────────────────────────────────
            item {
                WatchdogSectionCard(title = "Self-Rebuild", icon = Icons.Default.Build) {
                    Column(
                        modifier = Modifier.padding(top = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        // Status
                        if (state.rebuildInProgress) {
                            RebuildProgressBanner()
                        } else if (state.lastRebuildStatus.isNotBlank()) {
                            Text(
                                text = "Last status: ${state.lastRebuildStatus}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        // History
                        state.rebuildHistory.forEach { entry ->
                            RebuildHistoryRow(entry)
                        }

                        // Trigger button
                        Button(
                            onClick = { showRebuildDialog = true },
                            enabled = !state.rebuildInProgress,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary
                            )
                        ) {
                            Icon(
                                Icons.Default.Build,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(Modifier.width(8.dp))
                            Text("Trigger Rebuild")
                        }
                    }
                }
            }

            // ── Recent errors ────────────────────────────────────────────
            if (state.recentErrors.isNotEmpty()) {
                item {
                    WatchdogSectionCard(title = "Recent Errors", icon = Icons.Default.Warning) {
                        Column(
                            modifier = Modifier.padding(top = 8.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            state.recentErrors.take(5).forEach { err ->
                                ErrorLogRow(err)
                            }
                        }
                    }
                }
            }

            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

// ── Sub-components ────────────────────────────────────────────────────────────

@Composable
private fun ServerHealthCard(
    health: ContainerHealth,
    uptime: String,
    version: String,
    activeSessions: Int
) {
    val pulsate = rememberInfiniteTransition(label = "pulse")
    val pulseScale by pulsate.animateFloat(
        initialValue = 0.85f,
        targetValue = 1.0f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "pulseScale"
    )

    val bgColor = when (health) {
        ContainerHealth.HEALTHY  -> Color(0xFF22C55E)
        ContainerHealth.UNHEALTHY -> Color(0xFFEF4444)
        ContainerHealth.UNKNOWN  -> Color(0xFFF59E0B)
    }
    val animBg by animateColorAsState(bgColor, tween(500), label = "healthBg")

    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = animBg.copy(alpha = 0.12f)),
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Pulsing indicator
            Box(contentAlignment = Alignment.Center) {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .scale(if (health == ContainerHealth.HEALTHY) pulseScale else 1f)
                        .clip(CircleShape)
                        .background(animBg.copy(alpha = 0.2f))
                )
                Box(
                    modifier = Modifier
                        .size(28.dp)
                        .clip(CircleShape)
                        .background(animBg)
                )
                Icon(
                    imageVector = when (health) {
                        ContainerHealth.HEALTHY  -> Icons.Default.CheckCircle
                        ContainerHealth.UNHEALTHY -> Icons.Default.Error
                        ContainerHealth.UNKNOWN  -> Icons.Default.Warning
                    },
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(16.dp)
                )
            }

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = when (health) {
                        ContainerHealth.HEALTHY  -> "Server Online"
                        ContainerHealth.UNHEALTHY -> "Server Offline"
                        ContainerHealth.UNKNOWN  -> "Status Unknown"
                    },
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    color = animBg
                )
                if (uptime.isNotBlank()) {
                    Text(
                        "Uptime: $uptime",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                if (version.isNotBlank()) {
                    Text(
                        "v$version",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = activeSessions.toString(),
                    style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.ExtraBold),
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    "active",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun WatchdogSectionCard(
    title: String,
    icon: ImageVector,
    content: @Composable () -> Unit
) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainer
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp)
                )
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold)
                )
            }
            content()
        }
    }
}

@Composable
private fun ContainerRow(container: ContainerInfo) {
    val statusColor = when (container.health) {
        ContainerHealth.HEALTHY  -> Color(0xFF22C55E)
        ContainerHealth.UNHEALTHY -> Color(0xFFEF4444)
        ContainerHealth.UNKNOWN  -> Color(0xFFF59E0B)
    }
    val animColor by animateColorAsState(statusColor, tween(400), label = "containerColor")

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(animColor)
        )
        Icon(
            Icons.Default.DeveloperBoard,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(16.dp)
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                container.name,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium)
            )
            if (container.uptime.isNotBlank()) {
                Text(
                    "Up ${container.uptime}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
        Text(
            text = container.health.name.lowercase().replaceFirstChar { it.uppercase() },
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
            color = animColor
        )
    }
}

@Composable
private fun ActiveSessionRow(session: Session) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(Color(0xFF22C55E))
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                session.name,
                style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
                maxLines = 1
            )
            Text(
                session.workingDirectory,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                fontFamily = FontFamily.Monospace,
                fontSize = 10.sp
            )
        }
        Text(
            text = session.cliProvider.name.lowercase()
                .replaceFirstChar { it.uppercase() },
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary
        )
    }
}

@Composable
private fun RebuildProgressBanner() {
    val progress by rememberInfiniteTransition(label = "rebuild").animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1200), RepeatMode.Restart),
        label = "rebuildProgress"
    )

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.1f))
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
        Column(modifier = Modifier.weight(1f)) {
            Text(
                "Rebuild in progress…",
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium)
            )
            Spacer(Modifier.height(6.dp))
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

@Composable
private fun RebuildHistoryRow(entry: RebuildEntry) {
    val statusColor = if (entry.success) Color(0xFF22C55E) else Color(0xFFEF4444)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(statusColor.copy(alpha = 0.08f))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = if (entry.success) Icons.Default.CheckCircle else Icons.Default.Error,
            contentDescription = null,
            tint = statusColor,
            modifier = Modifier.size(16.dp)
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                if (entry.success) "Rebuild succeeded" else "Rebuild failed",
                style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
                color = statusColor
            )
            if (entry.message.isNotBlank()) {
                Text(
                    entry.message.take(80),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
        if (entry.timestamp.isNotBlank()) {
            Icon(
                Icons.Default.History,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(12.dp)
            )
            Text(
                entry.timestamp.take(10),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun ErrorLogRow(message: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(Color(0xFFEF4444).copy(alpha = 0.08f))
            .padding(horizontal = 10.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.Top
    ) {
        Icon(
            Icons.Default.Error,
            contentDescription = null,
            tint = Color(0xFFEF4444),
            modifier = Modifier.size(14.dp).padding(top = 1.dp)
        )
        Text(
            text = message,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface,
            fontFamily = FontFamily.Monospace,
            fontSize = 11.sp,
            lineHeight = 16.sp
        )
    }
}

@Composable
private fun RebuildConfirmDialog(
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(Icons.Default.Build, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        },
        title = {
            Text("Trigger Rebuild?", style = MaterialTheme.typography.titleMedium)
        },
        text = {
            Text(
                "This will rebuild and restart the WebUI container. " +
                "Active sessions will be terminated. Are you sure?",
                style = MaterialTheme.typography.bodyMedium
            )
        },
        confirmButton = {
            Button(
                onClick = onConfirm,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.error
                )
            ) {
                Text("Rebuild Now")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}
