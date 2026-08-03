package com.claudewebui.app.ui.screens.chat

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.*
import com.claudewebui.app.BuildConfig
import com.claudewebui.app.ui.components.chat.*
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBackground
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.providerColor
import com.claudewebui.app.ui.components.common.providerLabel
import com.claudewebui.app.ui.theme.ClaudeWebUITheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf
import java.text.DecimalFormat

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    sessionId: String,
    onNavigateBack: () -> Unit,
    onNavigateToFiles: (String) -> Unit = {},
    onNavigateToGit: (String) -> Unit = {},
    onNavigateToCheckpoints: (String) -> Unit = {},
    onNavigateToNotes: (String) -> Unit = {},
    onNavigateToMemory: (String) -> Unit = {},
    onNavigateToDevTools: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val viewModel: ChatViewModel = koinViewModel(parameters = { parametersOf(sessionId) })
    val uiState by viewModel.uiState.collectAsState()
    var showSessionSettings by remember { mutableStateOf(false) }
    val messages by viewModel.messages.collectAsState()
    val session by viewModel.session.collectAsState()
    val isDesignPreview = BuildConfig.DEBUG && sessionId == "preview"
    val displaySession = session ?: if (isDesignPreview) previewSession() else null
    val displayUiState = if (isDesignPreview) previewChatState() else uiState

    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()
    val pullRefreshState = rememberPullToRefreshState()
    val context = LocalContext.current

    val pickFilesLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris: List<Uri> ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        coroutineScope.launch {
            val attachments = withContext(Dispatchers.IO) {
                uris.mapNotNull { uri -> readAttachmentFromUri(context, uri) }
            }
            if (attachments.isNotEmpty()) {
                viewModel.addAttachments(attachments)
            }
            val failed = uris.size - attachments.size
            if (failed > 0) {
                viewModel.reportAttachmentFailure(failed, uris.size)
            }
        }
    }

    // Show FAB when scrolled up more than 2 items from bottom
    val showScrollToBottom by remember {
        derivedStateOf {
            val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            val total = listState.layoutInfo.totalItemsCount
            total > 0 && lastVisible < total - 2
        }
    }

    // Auto-scroll to bottom when new messages/streaming arrive
    val messageCount = messages.size
    val streamingText = displayUiState.streamingText
    LaunchedEffect(messageCount, streamingText) {
        if (!showScrollToBottom && messageCount > 0) {
            listState.animateScrollToItem(messageCount - 1)
        }
    }

    // Build display items: messages + streaming + thinking
    val displayItems = if (isDesignPreview) previewDisplayItems() else buildDisplayItems(messages, displayUiState)

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = PlumBackground,
        topBar = {
            ChatTopBar(
                session = displaySession,
                uiState = displayUiState,
                onNavigateBack = onNavigateBack,
                onEditTitle = { viewModel.setEditingTitle(true) },
                onTitleSaved = { viewModel.updateTitle(it) },
                onNavigateToFiles = { onNavigateToFiles(displaySession?.workingDirectory ?: "") },
                onNavigateToGit = { onNavigateToGit(displaySession?.workingDirectory ?: "") },
                onNavigateToCheckpoints = { onNavigateToCheckpoints(sessionId) },
                onToggleUsage = { viewModel.toggleUsageBanner() },
                onOpenSessionSettings = {
                    viewModel.loadAvailableModels()
                    showSessionSettings = true
                },
                onNavigateToNotes = { onNavigateToNotes(sessionId) },
                // Memory files hang off the working directory, not the session.
                onNavigateToMemory = {
                    onNavigateToMemory(displaySession?.workingDirectory ?: "")
                },
                onNavigateToDevTools = {
                    onNavigateToDevTools(displaySession?.workingDirectory ?: "")
                },
                isEditingTitle = uiState.isEditingTitle,
            )
        },
        bottomBar = {
            Column {
                // Usage stats banner
                AnimatedVisibility(
                    visible = displayUiState.showUsageBanner && displayUiState.usageData != null,
                    enter = expandVertically(expandFrom = Alignment.Bottom),
                    exit = shrinkVertically(shrinkTowards = Alignment.Bottom),
                ) {
                    displayUiState.usageData?.let { usage ->
                        UsageBanner(usage = usage)
                    }
                }

                // Thinking/tool indicator sits just above input
                ThinkingIndicator(
                    isThinking = displayUiState.isThinking,
                    toolName = displayUiState.currentToolName,
                    thinkingStartTime = displayUiState.thinkingStartTime,
                )

                ChatInput(
                    text = uiState.draftText,
                    onTextChange = { viewModel.onInputChange(it) },
                    onSend = { viewModel.sendMessage(it) },
                    onAttachFile = { pickFilesLauncher.launch(arrayOf("*/*")) },
                    isWorking = uiState.isWorking,
                    onInterrupt = { viewModel.interrupt() },
                    attachments = uiState.pendingAttachments,
                    onRemoveAttachment = { viewModel.removeAttachment(it) },
                )
            }
        },
        contentWindowInsets = WindowInsets.ime.union(WindowInsets.navigationBars),
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            PullToRefreshBox(
                isRefreshing = uiState.isLoadingHistory,
                onRefresh = { viewModel.loadHistory() },
                state = pullRefreshState,
                modifier = Modifier.fillMaxSize(),
            ) {
                if (displayItems.isEmpty() && !displayUiState.isLoadingHistory) {
                    EmptyChat(modifier = Modifier.fillMaxSize())
                } else {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(vertical = 8.dp),
                    ) {
                        itemsIndexed(
                            items = displayItems,
                            key = { _, item -> item.key },
                        ) { index, item ->
                            when (item) {
                                is DisplayItem.MessageItem -> {
                                    val groupInfo = computeGroupInfo(displayItems, index)
                                    MessageBubble(
                                        message = item.message,
                                        groupInfo = groupInfo,
                                        modifier = Modifier.animateItem(
                                            fadeInSpec = tween(200),
                                            placementSpec = spring(stiffness = Spring.StiffnessMediumLow),
                                        ),
                                        isStreaming = false,
                                    )
                                }
                                is DisplayItem.StreamingItem -> {
                                    StreamingBubble(
                                        text = item.text,
                                        modifier = Modifier.animateItem(),
                                    )
                                }
                                is DisplayItem.ToolItem -> {
                                    ToolExecutionCard(
                                        tool = item.tool,
                                        modifier = Modifier
                                            .padding(horizontal = 16.dp, vertical = 4.dp)
                                            .animateItem(),
                                        initiallyExpanded = item.tool.status == ToolStatus.STARTED,
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // Scroll to bottom FAB
            AnimatedVisibility(
                visible = showScrollToBottom,
                enter = scaleIn() + fadeIn(),
                exit = scaleOut() + fadeOut(),
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(16.dp),
            ) {
                FloatingActionButton(
                    onClick = {
                        coroutineScope.launch {
                            if (displayItems.isNotEmpty()) {
                                listState.animateScrollToItem(displayItems.size - 1)
                            }
                        }
                    },
                    modifier = Modifier.size(40.dp),
                    containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                    contentColor = MaterialTheme.colorScheme.onSurface,
                ) {
                    Icon(
                        imageVector = Icons.Filled.KeyboardArrowDown,
                        contentDescription = "Scroll to bottom",
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            // Session-setting result: provider, model and reasoning only bind on
            // the next process start, so the outcome is stated rather than implied.
            displayUiState.settingsNotice?.let { notice ->
                Snackbar(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(16.dp),
                    action = {
                        TextButton(onClick = { viewModel.clearSettingsNotice() }) {
                            Text("OK")
                        }
                    },
                ) {
                    Text(notice)
                }
            }

            // Error snackbar
            displayUiState.error?.let { error ->
                Snackbar(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(16.dp),
                    action = {
                        TextButton(onClick = { viewModel.dismissError() }) {
                            Text("Dismiss")
                        }
                    },
                ) {
                    Text(error)
                }
            }
        }
    }

    if (showSessionSettings) {
        displaySession?.let { session ->
            SessionSettingsSheet(
                session = session,
                mode = uiState.sessionMode,
                availableModels = uiState.availableModels,
                isApplying = uiState.isApplyingSettings,
                allowedDirectories = uiState.allowedDirectories,
                directoriesLoading = uiState.directoriesLoading,
                onProviderChange = viewModel::switchProvider,
                onModelChange = viewModel::setModel,
                onReasoningChange = viewModel::setReasoning,
                onModeChange = viewModel::setMode,
                onAddAllowedDirectory = viewModel::addAllowedDirectory,
                onRemoveAllowedDirectory = viewModel::removeAllowedDirectory,
                onDismiss = { showSessionSettings = false },
            )
        }
    }
}

// ── Top Bar ───────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatTopBar(
    session: Session?,
    uiState: ChatUiState,
    onNavigateBack: () -> Unit,
    onEditTitle: () -> Unit,
    onTitleSaved: (String) -> Unit,
    onNavigateToFiles: () -> Unit,
    onNavigateToGit: () -> Unit,
    onNavigateToCheckpoints: () -> Unit,
    onToggleUsage: () -> Unit,
    onOpenSessionSettings: () -> Unit,
    onNavigateToNotes: () -> Unit,
    onNavigateToMemory: () -> Unit,
    onNavigateToDevTools: () -> Unit,
    isEditingTitle: Boolean,
) {
    var editTitleText by remember(session?.name) { mutableStateOf(session?.name ?: "") }
    val focusRequester = remember { FocusRequester() }
    var showMenu by remember { mutableStateOf(false) }

    LaunchedEffect(isEditingTitle) {
        if (isEditingTitle) {
            focusRequester.requestFocus()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(PlumBackground)
            .statusBarsPadding()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onNavigateBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = PlumText)
            }
            Box(Modifier.weight(1f)) {
            if (isEditingTitle) {
                OutlinedTextField(
                    value = editTitleText,
                    onValueChange = { editTitleText = it },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .focusRequester(focusRequester),
                    textStyle = MaterialTheme.typography.titleMedium.copy(color = PlumText),
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Sentences,
                        imeAction = ImeAction.Done,
                    ),
                    keyboardActions = KeyboardActions(
                        onDone = { onTitleSaved(editTitleText) }
                    ),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PlumAccent,
                        unfocusedBorderColor = PlumBorder,
                    ),
                )
            } else {
                Column(
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                    modifier = Modifier.clickableNoRipple(onEditTitle),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = session?.name ?: "Loading…",
                            style = MaterialTheme.typography.titleLarge,
                            color = PlumText,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }

                    // Connection / status indicator
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        val statusColor = when {
                            !uiState.isConnected -> Color(0xFFFF575F)
                            uiState.isWorking -> ClaudeWebUITheme.extendedColors.warning
                            else -> PlumGreen
                        }
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .clip(CircleShape)
                                .background(statusColor)
                        )
                        Text(
                            text = when {
                                !uiState.isConnected -> "Disconnected"
                                uiState.isWorking -> "Working…"
                                else -> session?.status?.name?.lowercase()?.replaceFirstChar { it.uppercase() } ?: "Ready"
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = PlumMuted,
                            fontSize = 11.sp,
                        )
                    }
                }
            }
            }
            session?.cliProvider?.let { ProviderBadge(it) }
            Box {
                IconButton(onClick = { showMenu = true }) {
                    Icon(Icons.Filled.MoreVert, "More options", tint = PlumText)
                }
                DropdownMenu(
                    expanded = showMenu,
                    onDismissRequest = { showMenu = false },
                ) {
                    DropdownMenuItem(
                        text = { Text("Session settings") },
                        leadingIcon = { Icon(Icons.Outlined.Tune, contentDescription = null) },
                        onClick = { showMenu = false; onOpenSessionSettings() },
                    )
                    HorizontalDivider()
                    DropdownMenuItem(
                        text = { Text("Notes") },
                        leadingIcon = { Icon(Icons.Outlined.StickyNote2, contentDescription = null) },
                        onClick = { showMenu = false; onNavigateToNotes() },
                    )
                    DropdownMenuItem(
                        text = { Text("Memory") },
                        leadingIcon = { Icon(Icons.Outlined.Psychology, contentDescription = null) },
                        onClick = { showMenu = false; onNavigateToMemory() },
                    )
                    DropdownMenuItem(
                        text = { Text("Dev tools") },
                        leadingIcon = { Icon(Icons.Outlined.Dns, contentDescription = null) },
                        onClick = { showMenu = false; onNavigateToDevTools() },
                    )
                    DropdownMenuItem(
                        text = { Text("Checkpoints") },
                        leadingIcon = { Icon(Icons.Outlined.Bookmark, contentDescription = null) },
                        onClick = { showMenu = false; onNavigateToCheckpoints() },
                    )
                    DropdownMenuItem(
                        text = { Text("Git") },
                        leadingIcon = { Icon(Icons.Outlined.MergeType, contentDescription = null) },
                        onClick = { showMenu = false; onNavigateToGit() },
                    )
                    DropdownMenuItem(
                        text = { Text("Files") },
                        leadingIcon = { Icon(Icons.Outlined.FolderOpen, contentDescription = null) },
                        onClick = { showMenu = false; onNavigateToFiles() },
                    )
                    HorizontalDivider()
                    DropdownMenuItem(
                        text = { Text("Usage stats") },
                        leadingIcon = { Icon(Icons.Outlined.BarChart, contentDescription = null) },
                        onClick = { showMenu = false; onToggleUsage() },
                    )
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(PlumSurfaceStrong)
                .border(1.dp, PlumBorder, RoundedCornerShape(18.dp))
                .padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            ChatTab("Chat", Icons.Outlined.ChatBubbleOutline, true, Modifier.weight(1f), {})
            ChatTab("Files", Icons.Outlined.FolderOpen, false, Modifier.weight(1f), onNavigateToFiles)
            ChatTab("Git", Icons.Outlined.MergeType, false, Modifier.weight(1f), onNavigateToGit)
            ChatTab("Checks", Icons.Outlined.Security, false, Modifier.weight(1f), onNavigateToCheckpoints)
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(13.dp))
                .background(Color(0xC2191C1F))
                .border(1.dp, PlumBorder, RoundedCornerShape(13.dp))
                .clickable(onClick = onToggleUsage)
                .padding(horizontal = 12.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text("✦  ${session?.let { com.claudewebui.app.ui.components.common.providerModel(it.cliProvider) } ?: "model"}", color = PlumMuted, fontSize = 11.sp)
            val usage = uiState.usageData
            Text("Context  ${usage?.contextUsedPercent?.toInt()?.let { "$it%" } ?: "—"}", color = PlumMuted, fontSize = 11.sp)
            Text("Tokens  ${usage?.totalTokens?.let { DecimalFormat("#,##0").format(it) } ?: "—"}", color = Color(0xFF64B5FF), fontSize = 11.sp)
            Text("Cost  ${usage?.let { DecimalFormat("$0.00").format(it.totalCostUsd) } ?: "—"}", color = PlumGreen, fontSize = 11.sp)
        }
    }
}

@Composable
private fun ChatTab(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    selected: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) Color(0xFF8044C5) else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(vertical = 9.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = if (selected) Color.White else PlumMuted, modifier = Modifier.size(18.dp))
        Text("  $label", color = if (selected) Color.White else PlumMuted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

// ── Provider Badge ────────────────────────────────────────────────────────────

@Composable
private fun ProviderBadge(provider: CLIProvider) {
    val label = providerLabel(provider)
    val color = providerColor(provider)
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = color.copy(alpha = 0.15f),
        border = androidx.compose.foundation.BorderStroke(1.dp, color),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = color,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

// ── Usage Banner ──────────────────────────────────────────────────────────────

@Composable
private fun UsageBanner(usage: UsageData) {
    val df = remember { DecimalFormat("#,##0") }
    val costDf = remember { DecimalFormat("$0.0000") }

    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            // Context window progress
            if (usage.contextWindow > 0) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Context",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = "${usage.contextUsedPercent.toInt()}% used",
                        style = MaterialTheme.typography.labelSmall,
                        color = when {
                            usage.contextUsedPercent >= 90 -> MaterialTheme.colorScheme.error
                            usage.contextUsedPercent >= 70 -> ClaudeWebUITheme.extendedColors.warning
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                }
                LinearProgressIndicator(
                    progress = { (usage.contextUsedPercent / 100.0).toFloat().coerceIn(0f, 1f) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp)),
                    color = when {
                        usage.contextUsedPercent >= 90 -> MaterialTheme.colorScheme.error
                        usage.contextUsedPercent >= 70 -> ClaudeWebUITheme.extendedColors.warning
                        else -> MaterialTheme.colorScheme.primary
                    },
                )
            }

            // Token row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                UsageStat(label = "In", value = df.format(usage.inputTokens) + " tk")
                UsageStat(label = "Out", value = df.format(usage.outputTokens) + " tk")
                if (usage.cacheReadTokens > 0) {
                    UsageStat(label = "Cache", value = df.format(usage.cacheReadTokens) + " tk")
                }
                Spacer(modifier = Modifier.weight(1f))
                UsageStat(label = "Cost", value = costDf.format(usage.totalCostUsd))
            }
        }
    }
}

@Composable
private fun UsageStat(label: String, value: String) {
    Column {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 10.sp,
        )
        Text(
            text = value,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurface,
            fontWeight = FontWeight.Medium,
        )
    }
}

// ── Streaming Bubble ──────────────────────────────────────────────────────────

@Composable
private fun StreamingBubble(
    text: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 48.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // Avatar
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primaryContainer,
            modifier = Modifier.size(28.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(text = "✦", fontSize = 12.sp, color = MaterialTheme.colorScheme.primary)
            }
        }

        Surface(
            shape = RoundedCornerShape(topStart = 4.dp, topEnd = 16.dp, bottomEnd = 16.dp, bottomStart = 16.dp),
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            modifier = Modifier.weight(1f),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                if (text.isNotEmpty()) {
                    MarkdownContent(
                        text = text,
                        modifier = Modifier.weight(1f, fill = false),
                        isStreaming = true,
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                }
                StreamingCursorInline()
            }
        }
    }
}

@Composable
private fun StreamingCursorInline() {
    val infiniteTransition = rememberInfiniteTransition(label = "cursor")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(500, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "alpha",
    )
    Box(
        modifier = Modifier
            .size(width = 2.dp, height = 16.dp)
            .background(
                color = MaterialTheme.colorScheme.primary.copy(alpha = alpha),
                shape = RoundedCornerShape(1.dp),
            )
    )
}

// ── Empty State ───────────────────────────────────────────────────────────────

@Composable
private fun EmptyChat(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "✦",
                fontSize = 40.sp,
                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.3f),
            )
            Text(
                text = "Start a conversation",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = "Type a message below",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            )
        }
    }
}

// ── Display Item Model ────────────────────────────────────────────────────────

private sealed class DisplayItem {
    abstract val key: String

    data class MessageItem(val message: Message) : DisplayItem() {
        override val key = "msg_${message.id}"
    }
    data class StreamingItem(val text: String) : DisplayItem() {
        override val key = "streaming"
    }
    data class ToolItem(val tool: ToolExecution) : DisplayItem() {
        override val key = "tool_${tool.toolId}"
    }
}

private fun previewSession() = Session(
    id = "preview",
    userId = "preview",
    name = "Frontend Refactor",
    workingDirectory = "/workspace/plum-code-webui",
    status = SessionStatus.RUNNING,
    cliProvider = CLIProvider.CODEX,
    createdAt = "2026-08-01T13:33:00Z",
    updatedAt = "2026-08-01T13:36:00Z",
)

private fun previewChatState() = ChatUiState(
    isLoadingSession = false,
    isConnected = true,
    usageData = UsageData(
        sessionId = "preview",
        inputTokens = 154_200,
        outputTokens = 29_800,
        totalTokens = 184_000,
        contextWindow = 296_000,
        contextUsedPercent = 62.0,
        totalCostUsd = 2.84,
        model = "gpt-5.5",
    ),
)

private fun previewDisplayItems(): List<DisplayItem> = listOf(
    DisplayItem.MessageItem(
        Message(
            id = "preview-plan",
            sessionId = "preview",
            role = MessageRole.ASSISTANT,
            content = "Here's my plan to simplify the provider selector while maintaining flexibility:\n\n• Create a unified provider config\n• Replace scattered usage with ProviderRegistry\n• Update settings UI to render from registry\n• Migrate existing references and clean up",
            createdAt = "2026-08-01T13:33:00Z",
        )
    ),
    DisplayItem.MessageItem(
        Message(
            id = "preview-user",
            sessionId = "preview",
            role = MessageRole.USER,
            content = "Great! Please simplify the provider selector in Settings and use a compact chip style instead of full rows.",
            createdAt = "2026-08-01T13:35:00Z",
        )
    ),
    DisplayItem.ToolItem(
        ToolExecution(
            toolId = "preview-read",
            toolName = "read_file",
            status = ToolStatus.COMPLETED,
            result = "Read src/ui/settings/ProviderSection.kt",
            timestamp = 1L,
            completedAt = 2L,
        )
    ),
    DisplayItem.ToolItem(
        ToolExecution(
            toolId = "preview-edit",
            toolName = "edit_file",
            status = ToolStatus.STARTED,
            result = "Editing src/ui/settings/ProviderSection.kt",
            timestamp = 3L,
        )
    ),
    DisplayItem.MessageItem(
        Message(
            id = "preview-result",
            sessionId = "preview",
            role = MessageRole.ASSISTANT,
            content = "Provider selector is now simplified to compact chips. Two files updated and tests are ready to run.",
            createdAt = "2026-08-01T13:36:00Z",
        )
    ),
)

private fun buildDisplayItems(messages: List<Message>, uiState: ChatUiState): List<DisplayItem> {
    val items = mutableListOf<DisplayItem>()

    messages.forEach { msg ->
        items.add(DisplayItem.MessageItem(msg))
    }

    // Active tools inline
    uiState.activeTools.values
        .sortedBy { it.timestamp }
        .forEach { tool ->
            items.add(DisplayItem.ToolItem(tool))
        }

    // Streaming text
    val streaming = uiState.streamingState
    if (streaming is StreamingState.Streaming && streaming.partialText.isNotEmpty()) {
        items.add(DisplayItem.StreamingItem(streaming.partialText))
    }

    return items
}

// ── Group Info ────────────────────────────────────────────────────────────────

private fun computeGroupInfo(items: List<DisplayItem>, index: Int): MessageGroupInfo {
    val current = items[index] as? DisplayItem.MessageItem ?: return MessageGroupInfo()
    val prev = items.getOrNull(index - 1) as? DisplayItem.MessageItem
    val next = items.getOrNull(index + 1) as? DisplayItem.MessageItem

    return MessageGroupInfo(
        isFirst = prev == null || prev.message.role != current.message.role,
        isLast = next == null || next.message.role != current.message.role,
    )
}

// ── Clickable helper ──────────────────────────────────────────────────────────

@Composable
private fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier {
    val interactionSource = remember { MutableInteractionSource() }
    return this.clickable(
        interactionSource = interactionSource,
        indication = null,
        onClick = onClick,
    )
}

// ── Attachment URI reader ─────────────────────────────────────────────────────

private const val MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024 // 50 MB — matches backend multer limit

private fun readAttachmentFromUri(context: Context, uri: Uri): FileAttachmentData? = runCatching {
    val resolver = context.contentResolver
    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    if (bytes.size > MAX_ATTACHMENT_SIZE) return null
    val mimeType = resolver.getType(uri) ?: "application/octet-stream"
    val filename = queryDisplayName(resolver, uri) ?: "attachment"
    FileAttachmentData(
        data = Base64.encodeToString(bytes, Base64.NO_WRAP),
        mimeType = mimeType,
        filename = filename,
    )
}.getOrNull()

private fun queryDisplayName(resolver: ContentResolver, uri: Uri): String? = runCatching {
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (idx >= 0) cursor.getString(idx) else null
        } else null
    }
}.getOrNull()
