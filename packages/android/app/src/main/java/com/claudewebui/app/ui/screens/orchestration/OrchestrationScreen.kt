package com.claudewebui.app.ui.screens.orchestration

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.lazy.grid.*
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.*
import com.claudewebui.app.ui.components.orchestration.OrchestrationConfigSheet
import com.claudewebui.app.ui.components.orchestration.WorkerCard
import com.claudewebui.app.ui.components.orchestration.mapCLIToCliProvider
import com.claudewebui.app.ui.theme.ProviderThemes
import com.claudewebui.app.ui.theme.SuccessGreen
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrchestrationScreen(
    sessionId: String,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val viewModel: OrchestrationViewModel =
        koinViewModel(parameters = { parametersOf(sessionId) })
    val uiState by viewModel.uiState.collectAsState()
    val configDraft by viewModel.configDraft.collectAsState()
    val elapsedSeconds by viewModel.elapsedSeconds.collectAsState()

    val screenWidthDp = LocalConfiguration.current.screenWidthDp
    val workerColumns = if (screenWidthDp >= 600) 3 else 2

    // Worker detail bottom sheet
    if (uiState.selectedWorkerDetail != null) {
        WorkerDetailSheet(
            detail = uiState.selectedWorkerDetail!!,
            onDismiss = viewModel::dismissWorkerDetail,
            onInterrupt = { viewModel.interruptWorker(uiState.selectedWorkerDetail!!.worker.id) },
        )
    }

    // Config sheet
    if (uiState.showConfigSheet) {
        OrchestrationConfigSheet(
            draft = configDraft,
            onDraftChange = viewModel::updateConfigDraft,
            onStart = viewModel::startOrchestration,
            onDismiss = viewModel::hideConfigSheet,
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
            OrchestrationTopBar(
                isRunning = uiState.isRunning,
                phase = uiState.currentPhase,
                elapsedSeconds = elapsedSeconds,
                onBack = onNavigateBack,
                onStop = viewModel::stop,
                onStart = viewModel::showConfigSheet,
            )
        },
        modifier = modifier,
    ) { innerPadding ->
        if (!uiState.isRunning && uiState.currentPhase == OrchestrationPhase.IDLE) {
            // Empty / launch state
            OrchestrationLaunchScreen(
                onConfigure = viewModel::showConfigSheet,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding),
            )
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(workerColumns),
                contentPadding = PaddingValues(
                    start = 16.dp,
                    end = 16.dp,
                    top = innerPadding.calculateTopPadding() + 12.dp,
                    bottom = innerPadding.calculateBottomPadding() + 24.dp,
                ),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                // Phase timeline - spans all columns
                item(span = { GridItemSpan(workerColumns) }) {
                    PhaseTimeline(
                        currentPhase = uiState.currentPhase,
                        phaseMessage = uiState.phaseMessage,
                    )
                }

                // Master coordinator card - spans all columns
                item(span = { GridItemSpan(workerColumns) }) {
                    MasterCoordinatorCard(
                        config = uiState.config,
                        phase = uiState.currentPhase,
                        phaseMessage = uiState.phaseMessage,
                        taskCount = uiState.tasks.size,
                        completedCount = uiState.tasks.count {
                            it.status == OrchestrationTaskStatus.COMPLETED
                        },
                    )
                }

                // Worker cards
                if (uiState.workers.isNotEmpty()) {
                    item(span = { GridItemSpan(workerColumns) }) {
                        Text(
                            text = "Workers",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 4.dp),
                        )
                    }

                    items(
                        items = uiState.workers,
                        key = { it.id },
                    ) { worker ->
                        val progress = viewModel.getWorkerProgress(worker.id)
                        WorkerCard(
                            worker = worker,
                            progress = progress,
                            onTap = { viewModel.showWorkerDetail(worker) },
                            modifier = Modifier.animateItem(),
                        )
                    }
                }

                // Completed results panel
                if (uiState.currentPhase == OrchestrationPhase.COMPLETED ||
                    uiState.currentPhase == OrchestrationPhase.ERROR
                ) {
                    item(span = { GridItemSpan(workerColumns) }) {
                        ResultsPanel(
                            tasks = uiState.tasks,
                            phase = uiState.currentPhase,
                        )
                    }
                }
            }
        }
    }
}

// ── Top Bar ────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OrchestrationTopBar(
    isRunning: Boolean,
    phase: OrchestrationPhase,
    elapsedSeconds: Long,
    onBack: () -> Unit,
    onStop: () -> Unit,
    onStart: () -> Unit,
) {
    TopAppBar(
        title = {
            Column {
                Text(
                    text = "Orchestration",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                if (isRunning) {
                    Text(
                        text = formatElapsed(elapsedSeconds),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        },
        navigationIcon = {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
            }
        },
        actions = {
            if (isRunning) {
                OutlinedButton(
                    onClick = onStop,
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.error,
                    ),
                    border = androidx.compose.foundation.BorderStroke(
                        1.dp,
                        MaterialTheme.colorScheme.error.copy(alpha = 0.5f),
                    ),
                    modifier = Modifier.padding(end = 12.dp),
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
                ) {
                    Icon(Icons.Filled.Stop, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Stop", style = MaterialTheme.typography.labelMedium)
                }
            } else if (phase != OrchestrationPhase.IDLE) {
                // Re-run button after completion
                IconButton(onClick = onStart) {
                    Icon(Icons.Filled.Refresh, contentDescription = "New orchestration")
                }
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
    )
}

// ── Launch Screen ──────────────────────────────────────────────────────────────

@Composable
private fun OrchestrationLaunchScreen(
    onConfigure: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = Icons.Filled.Groups,
            contentDescription = null,
            modifier = Modifier.size(72.dp),
            tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.7f),
        )
        Spacer(Modifier.height(20.dp))
        Text(
            text = "Multi-AI Orchestration",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = "Coordinate multiple AI workers to tackle complex tasks in parallel. Each worker specializes and the master coordinator synthesizes the results.",
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
            Text("Configure & Start", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        }
    }
}

// ── Phase Timeline ─────────────────────────────────────────────────────────────

private val PHASES = listOf(
    OrchestrationPhase.ANALYZING,
    OrchestrationPhase.DELEGATING,
    OrchestrationPhase.EXECUTING,
    OrchestrationPhase.SYNTHESIZING,
    OrchestrationPhase.COMPLETED,
)

@Composable
private fun PhaseTimeline(
    currentPhase: OrchestrationPhase,
    phaseMessage: String?,
    modifier: Modifier = Modifier,
) {
    val currentIndex = PHASES.indexOf(currentPhase).coerceAtLeast(0)

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        ),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = phaseMessage ?: phaseLabel(currentPhase),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface,
            )

            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                PHASES.forEachIndexed { index, phase ->
                    val isDone = index < currentIndex
                    val isActive = index == currentIndex
                    val color = when {
                        isDone -> SuccessGreen
                        isActive -> MaterialTheme.colorScheme.primary
                        else -> MaterialTheme.colorScheme.outline.copy(alpha = 0.3f)
                    }

                    // Dot
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(color),
                    )

                    // Connector line (between dots)
                    if (index < PHASES.lastIndex) {
                        HorizontalDivider(
                            modifier = Modifier.weight(1f),
                            color = if (isDone) SuccessGreen.copy(alpha = 0.5f)
                            else MaterialTheme.colorScheme.outline.copy(alpha = 0.2f),
                            thickness = 1.5.dp,
                        )
                    }
                }
            }

            // Phase labels
            Row(
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                PHASES.forEachIndexed { index, phase ->
                    val isActive = index == currentIndex
                    val isDone = index < currentIndex
                    Text(
                        text = phaseShortLabel(phase),
                        style = MaterialTheme.typography.labelSmall,
                        fontSize = 10.sp,
                        color = when {
                            isDone -> SuccessGreen
                            isActive -> MaterialTheme.colorScheme.primary
                            else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
                        },
                        fontWeight = if (isActive) FontWeight.Bold else FontWeight.Normal,
                    )
                }
            }
        }
    }
}

// ── Master Coordinator Card ───────────────────────────────────────────────────

@Composable
private fun MasterCoordinatorCard(
    config: OrchestrationConfig,
    phase: OrchestrationPhase,
    phaseMessage: String?,
    taskCount: Int,
    completedCount: Int,
    modifier: Modifier = Modifier,
) {
    val isDark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val masterProvider = mapCLIToCliProvider(config.master)
    val theme = ProviderThemes.get(masterProvider)
    val providerColor = if (isDark) theme.colorDark else theme.color

    val infiniteTransition = rememberInfiniteTransition(label = "masterPulse")
    val pulseAlpha by infiniteTransition.animateFloat(
        initialValue = 0.6f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1200, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "alpha",
    )

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        ),
        border = androidx.compose.foundation.BorderStroke(
            2.dp,
            if (phase == OrchestrationPhase.EXECUTING) providerColor.copy(alpha = pulseAlpha)
            else providerColor.copy(alpha = 0.4f),
        ),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.Top,
        ) {
            // Master icon
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(
                        if (isDark) theme.containerColorDark else theme.containerColor,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = theme.icon,
                    contentDescription = null,
                    tint = if (isDark) theme.onContainerColorDark else theme.onContainerColor,
                    modifier = Modifier.size(22.dp),
                )
            }

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = "Master: ${theme.displayName}",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                    )
                    Surface(
                        shape = RoundedCornerShape(4.dp),
                        color = providerColor.copy(alpha = 0.12f),
                    ) {
                        Text(
                            text = "Coordinator",
                            style = MaterialTheme.typography.labelSmall,
                            color = providerColor,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                }

                Text(
                    text = phaseMessage ?: phaseLabel(phase),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )

                if (taskCount > 0) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        LinearProgressIndicator(
                            progress = { completedCount.toFloat() / taskCount },
                            modifier = Modifier
                                .width(100.dp)
                                .height(4.dp)
                                .clip(RoundedCornerShape(2.dp)),
                            color = providerColor,
                        )
                        Text(
                            text = "$completedCount / $taskCount tasks",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

// ── Results Panel ──────────────────────────────────────────────────────────────

@Composable
private fun ResultsPanel(
    tasks: List<OrchestrationTask>,
    phase: OrchestrationPhase,
    modifier: Modifier = Modifier,
) {
    val isSuccess = phase == OrchestrationPhase.COMPLETED
    val completedTasks = tasks.filter { it.status == OrchestrationTaskStatus.COMPLETED }
    val failedTasks = tasks.filter { it.status == OrchestrationTaskStatus.FAILED }

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isSuccess)
                SuccessGreen.copy(alpha = 0.08f)
            else
                MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f),
        ),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    imageVector = if (isSuccess) Icons.Filled.CheckCircle else Icons.Filled.Error,
                    contentDescription = null,
                    tint = if (isSuccess) SuccessGreen else MaterialTheme.colorScheme.error,
                )
                Text(
                    text = if (isSuccess) "Orchestration Complete" else "Orchestration Failed",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = if (isSuccess) SuccessGreen else MaterialTheme.colorScheme.error,
                )
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                StatBadge(label = "Completed", value = "${completedTasks.size}", color = SuccessGreen)
                StatBadge(
                    label = "Failed",
                    value = "${failedTasks.size}",
                    color = if (failedTasks.isEmpty()) MaterialTheme.colorScheme.onSurfaceVariant
                    else MaterialTheme.colorScheme.error,
                )
                StatBadge(label = "Total", value = "${tasks.size}", color = MaterialTheme.colorScheme.primary)
            }

            // Completed tasks snippets
            completedTasks.take(3).forEach { task ->
                if (task.result != null) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            text = task.description.take(60),
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            text = task.result.take(120) + if (task.result.length > 120) "…" else "",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StatBadge(label: String, value: String, color: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text = value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = color)
        Text(text = label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ── Worker Detail Sheet ────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WorkerDetailSheet(
    detail: WorkerDetailState,
    onDismiss: () -> Unit,
    onInterrupt: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        modifier = modifier,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = "Worker ${detail.worker.id.takeLast(6)} Output",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                if (detail.worker.status == WorkerStatus.BUSY) {
                    TextButton(
                        onClick = onInterrupt,
                        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    ) {
                        Text("Interrupt")
                    }
                }
            }

            HorizontalDivider()

            // Tasks for this worker
            if (detail.tasks.isNotEmpty()) {
                Text(
                    text = "Tasks (${detail.tasks.size})",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                detail.tasks.forEach { task ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            imageVector = when (task.status) {
                                OrchestrationTaskStatus.COMPLETED -> Icons.Filled.CheckCircle
                                OrchestrationTaskStatus.FAILED -> Icons.Filled.Cancel
                                OrchestrationTaskStatus.RUNNING -> Icons.Filled.PlayCircle
                                else -> Icons.Filled.RadioButtonUnchecked
                            },
                            contentDescription = null,
                            tint = when (task.status) {
                                OrchestrationTaskStatus.COMPLETED -> SuccessGreen
                                OrchestrationTaskStatus.FAILED -> MaterialTheme.colorScheme.error
                                OrchestrationTaskStatus.RUNNING -> MaterialTheme.colorScheme.primary
                                else -> MaterialTheme.colorScheme.outline
                            },
                            modifier = Modifier.size(16.dp),
                        )
                        Text(
                            text = task.description,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }

                HorizontalDivider()
            }

            // Output text
            Text(
                text = "Output",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            val scrollState = rememberScrollState()
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(280.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainerLow)
                    .padding(12.dp),
            ) {
                Text(
                    text = detail.output.ifBlank { "No output yet." },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.verticalScroll(scrollState),
                )
            }
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

private fun phaseLabel(phase: OrchestrationPhase) = when (phase) {
    OrchestrationPhase.IDLE -> "Waiting to start…"
    OrchestrationPhase.ANALYZING -> "Analyzing task…"
    OrchestrationPhase.DELEGATING -> "Delegating to workers…"
    OrchestrationPhase.EXECUTING -> "Workers executing tasks…"
    OrchestrationPhase.SYNTHESIZING -> "Synthesizing results…"
    OrchestrationPhase.COMPLETED -> "Orchestration complete"
    OrchestrationPhase.ERROR -> "Orchestration failed"
}

private fun phaseShortLabel(phase: OrchestrationPhase) = when (phase) {
    OrchestrationPhase.ANALYZING -> "Analyze"
    OrchestrationPhase.DELEGATING -> "Delegate"
    OrchestrationPhase.EXECUTING -> "Execute"
    OrchestrationPhase.SYNTHESIZING -> "Synthesize"
    OrchestrationPhase.COMPLETED -> "Done"
    else -> ""
}

private fun formatElapsed(seconds: Long): String {
    val h = seconds / 3600
    val m = (seconds % 3600) / 60
    val s = seconds % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}
