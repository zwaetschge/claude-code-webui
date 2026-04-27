package com.claudewebui.app.ui.screens.ralph

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.*
import com.claudewebui.app.ui.components.ralph.RalphActivityLog
import com.claudewebui.app.ui.components.ralph.RalphConfigSheet
import com.claudewebui.app.ui.components.ralph.RalphPlanView
import com.claudewebui.app.ui.theme.SuccessGreen
import com.claudewebui.app.ui.theme.WarningAmber
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RalphScreen(
    sessionId: String,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: RalphViewModel = koinViewModel(parameters = { parametersOf(sessionId) })
    val uiState by viewModel.uiState.collectAsState()
    val configDraft by viewModel.configDraft.collectAsState()

    // Config sheet
    if (uiState.showConfigSheet) {
        RalphConfigSheet(
            draft = configDraft,
            onDraftChange = viewModel::updateConfigDraft,
            onStart = viewModel::start,
            onDismiss = viewModel::hideConfigSheet,
        )
    }

    // Intervene dialog
    if (uiState.showInterveneDialog) {
        RalphInterveneDialog(
            text = uiState.interveneText,
            onTextChange = viewModel::updateInterveneText,
            onConfirm = viewModel::intervene,
            onDismiss = viewModel::dismissInterveneDialog,
        )
    }

    // Error snackbar
    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            RalphTopBar(
                status = uiState.status,
                idea = uiState.idea,
                elapsedSeconds = uiState.elapsedSeconds,
                isRunning = uiState.status == RalphStatus.EXECUTING || uiState.status == RalphStatus.PLANNING,
                onBack = onNavigateBack,
            )
        },
        modifier = modifier,
    ) { innerPadding ->

        val isIdle = uiState.status == RalphStatus.IDLE

        if (isIdle) {
            RalphLaunchScreen(
                onConfigure = viewModel::showConfigSheet,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding),
            )
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding),
            ) {
                // Progress overview bar
                RalphProgressBar(
                    progress = uiState.progress,
                    status = uiState.status,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                )

                // Two-panel layout using tab-style switcher on phone
                var activeTab by remember { mutableIntStateOf(0) }

                TabRow(
                    selectedTabIndex = activeTab,
                    containerColor = MaterialTheme.colorScheme.surface,
                    contentColor = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Tab(
                        selected = activeTab == 0,
                        onClick = { activeTab = 0 },
                        text = {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Icon(Icons.Filled.AccountTree, contentDescription = null, modifier = Modifier.size(16.dp))
                                Text("Plan")
                                uiState.plan?.let {
                                    val running = it.tasks.count { t -> t.status == RalphTaskStatus.IN_PROGRESS }
                                    if (running > 0) {
                                        Box(
                                            modifier = Modifier
                                                .size(16.dp)
                                                .clip(CircleShape)
                                                .background(MaterialTheme.colorScheme.primary),
                                            contentAlignment = Alignment.Center,
                                        ) {
                                            Text(
                                                text = "$running",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.onPrimary,
                                            )
                                        }
                                    }
                                }
                            }
                        },
                    )
                    Tab(
                        selected = activeTab == 1,
                        onClick = { activeTab = 1 },
                        text = {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Icon(Icons.Filled.List, contentDescription = null, modifier = Modifier.size(16.dp))
                                Text("Activity")
                                if (uiState.activityLog.isNotEmpty()) {
                                    Surface(
                                        shape = CircleShape,
                                        color = MaterialTheme.colorScheme.secondaryContainer,
                                    ) {
                                        Text(
                                            text = "${uiState.activityLog.size}",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                                            modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp),
                                        )
                                    }
                                }
                            }
                        },
                    )
                }

                // Tab content
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                ) {
                    AnimatedContent(
                        targetState = activeTab,
                        transitionSpec = {
                            if (targetState > initialState) {
                                slideInHorizontally { w -> w } + fadeIn() togetherWith
                                    slideOutHorizontally { w -> -w } + fadeOut()
                            } else {
                                slideInHorizontally { w -> -w } + fadeIn() togetherWith
                                    slideOutHorizontally { w -> w } + fadeOut()
                            }
                        },
                        label = "tabContent",
                        modifier = Modifier.fillMaxSize(),
                    ) { tab ->
                        when (tab) {
                            0 -> PlanTab(
                                plan = uiState.plan,
                                progress = uiState.progress,
                                selectedTaskId = uiState.selectedTaskId,
                                onTaskTap = viewModel::selectTask,
                                modifier = Modifier.fillMaxSize(),
                            )

                            1 -> ActivityTab(
                                entries = uiState.activityLog,
                                activeFilter = uiState.logFilter,
                                onFilterChange = viewModel::setLogFilter,
                                modifier = Modifier.fillMaxSize(),
                            )
                        }
                    }
                }

                // Control bar
                RalphControlBar(
                    status = uiState.status,
                    onPause = viewModel::pause,
                    onResume = viewModel::resume,
                    onStop = viewModel::stop,
                    onIntervene = viewModel::showInterveneDialog,
                    onRestart = viewModel::showConfigSheet,
                )
            }
        }
    }
}

// ── Top Bar ────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RalphTopBar(
    status: RalphStatus,
    idea: String,
    elapsedSeconds: Long,
    isRunning: Boolean,
    onBack: () -> Unit,
) {
    val statusColor = when (status) {
        RalphStatus.EXECUTING -> MaterialTheme.colorScheme.primary
        RalphStatus.PLANNING -> WarningAmber
        RalphStatus.PAUSED -> MaterialTheme.colorScheme.tertiary
        RalphStatus.COMPLETED -> SuccessGreen
        RalphStatus.FAILED, RalphStatus.STOPPED -> MaterialTheme.colorScheme.error
        RalphStatus.IDLE -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    val infiniteTransition = rememberInfiniteTransition(label = "headerPulse")
    val pulseAlpha by infiniteTransition.animateFloat(
        initialValue = 0.6f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "dotAlpha",
    )

    TopAppBar(
        title = {
            Column {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(
                                statusColor.copy(alpha = if (isRunning) pulseAlpha else 1f),
                            ),
                    )
                    Text(
                        text = "Ralph — ${statusLabel(status)}",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
                if (isRunning && elapsedSeconds > 0) {
                    Text(
                        text = formatElapsed(elapsedSeconds),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
        navigationIcon = {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
    )
}

// ── Launch Screen ──────────────────────────────────────────────────────────────

@Composable
private fun RalphLaunchScreen(
    onConfigure: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = Icons.Filled.SmartToy,
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.8f),
        )
        Spacer(Modifier.height(20.dp))
        Text(
            text = "Ralph",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.ExtraBold,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = "Autonomous AI Agent",
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = "Give Ralph a goal and let it work autonomously — planning tasks, executing them iteratively, and self-correcting until the objective is achieved.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        Spacer(Modifier.height(32.dp))
        Button(
            onClick = onConfigure,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = RoundedCornerShape(14.dp),
        ) {
            Icon(Icons.Filled.PlayArrow, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text("Configure & Launch", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        }
    }
}

// ── Progress Bar ───────────────────────────────────────────────────────────────

@Composable
private fun RalphProgressBar(
    progress: RalphProgress?,
    status: RalphStatus,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        ),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (progress != null) {
                LinearProgressIndicator(
                    progress = { (progress.percentComplete / 100.0).toFloat() },
                    modifier = Modifier
                        .weight(1f)
                        .height(6.dp)
                        .clip(RoundedCornerShape(3.dp)),
                    color = when (status) {
                        RalphStatus.COMPLETED -> SuccessGreen
                        RalphStatus.FAILED -> MaterialTheme.colorScheme.error
                        else -> MaterialTheme.colorScheme.primary
                    },
                )
                Text(
                    text = "${progress.completedTasks} / ${progress.totalTasks}",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = "${progress.percentComplete.toInt()}%",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                LinearProgressIndicator(
                    modifier = Modifier
                        .weight(1f)
                        .height(6.dp)
                        .clip(RoundedCornerShape(3.dp)),
                )
                Text(
                    text = "Working…",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

// ── Plan Tab ───────────────────────────────────────────────────────────────────

@Composable
private fun PlanTab(
    plan: RalphPlan?,
    progress: RalphProgress?,
    selectedTaskId: String?,
    onTaskTap: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (plan == null) {
        Box(
            modifier = modifier.padding(32.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                CircularProgressIndicator()
                Text(
                    text = "Ralph is planning…",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    } else {
        RalphPlanView(
            plan = plan,
            currentTaskIndex = progress?.currentTaskIndex ?: 0,
            selectedTaskId = selectedTaskId,
            onTaskTap = { id ->
                onTaskTap(if (selectedTaskId == id) null else id)
            },
            modifier = modifier
                .padding(horizontal = 16.dp, vertical = 12.dp)
                .verticalScroll(rememberScrollState()),
        )
    }
}

// ── Activity Tab ───────────────────────────────────────────────────────────────

@Composable
private fun ActivityTab(
    entries: List<com.claudewebui.app.ui.screens.ralph.RalphLogEntry>,
    activeFilter: com.claudewebui.app.ui.screens.ralph.RalphActionType?,
    onFilterChange: (com.claudewebui.app.ui.screens.ralph.RalphActionType?) -> Unit,
    modifier: Modifier = Modifier,
) {
    RalphActivityLog(
        entries = entries,
        activeFilter = activeFilter,
        onFilterChange = onFilterChange,
        modifier = modifier.padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

// ── Control Bar ────────────────────────────────────────────────────────────────

@Composable
private fun RalphControlBar(
    status: RalphStatus,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onStop: () -> Unit,
    onIntervene: () -> Unit,
    onRestart: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shadowElevation = 8.dp,
        color = MaterialTheme.colorScheme.surface,
    ) {
        Row(
            modifier = Modifier
                .navigationBarsPadding()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            when (status) {
                RalphStatus.EXECUTING, RalphStatus.PLANNING -> {
                    // Pause
                    OutlinedButton(
                        onClick = onPause,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Icon(Icons.Filled.Pause, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Pause")
                    }

                    // Intervene
                    Button(
                        onClick = onIntervene,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.tertiary,
                        ),
                    ) {
                        Icon(Icons.Filled.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Intervene")
                    }

                    // Stop
                    OutlinedButton(
                        onClick = onStop,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = MaterialTheme.colorScheme.error,
                        ),
                        border = androidx.compose.foundation.BorderStroke(
                            1.dp,
                            MaterialTheme.colorScheme.error.copy(alpha = 0.5f),
                        ),
                    ) {
                        Icon(Icons.Filled.Stop, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Stop")
                    }
                }

                RalphStatus.PAUSED -> {
                    // Resume
                    Button(
                        onClick = onResume,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Resume")
                    }

                    // Intervene
                    OutlinedButton(
                        onClick = onIntervene,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Icon(Icons.Filled.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Intervene")
                    }

                    // Stop
                    OutlinedButton(
                        onClick = onStop,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.5f)),
                    ) {
                        Icon(Icons.Filled.Stop, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Stop")
                    }
                }

                RalphStatus.COMPLETED, RalphStatus.FAILED, RalphStatus.STOPPED -> {
                    Button(
                        onClick = onRestart,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Icon(Icons.Filled.Refresh, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("New Run", fontWeight = FontWeight.Bold)
                    }
                }

                else -> Unit
            }
        }
    }
}

// ── Intervene Dialog ───────────────────────────────────────────────────────────

@Composable
private fun RalphInterveneDialog(
    text: String,
    onTextChange: (String) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(Icons.Filled.Edit, contentDescription = null)
        },
        title = { Text("Intervene", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "Send a message to Ralph while it's running. Ralph will incorporate your guidance into its next step.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = text,
                    onValueChange = onTextChange,
                    placeholder = { Text("Type your instruction…") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                    maxLines = 5,
                    shape = RoundedCornerShape(12.dp),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = onConfirm,
                enabled = text.isNotBlank(),
            ) {
                Text("Send")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

private fun statusLabel(status: RalphStatus) = when (status) {
    RalphStatus.IDLE -> "Idle"
    RalphStatus.PLANNING -> "Planning"
    RalphStatus.EXECUTING -> "Executing"
    RalphStatus.PAUSED -> "Paused"
    RalphStatus.COMPLETED -> "Completed"
    RalphStatus.FAILED -> "Failed"
    RalphStatus.STOPPED -> "Stopped"
}

private fun formatElapsed(seconds: Long): String {
    val h = seconds / 3600
    val m = (seconds % 3600) / 60
    val s = seconds % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}
