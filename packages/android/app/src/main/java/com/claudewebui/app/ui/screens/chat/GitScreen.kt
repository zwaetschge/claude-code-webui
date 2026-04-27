package com.claudewebui.app.ui.screens.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.MergeType
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.GitBranch
import com.claudewebui.app.data.model.GitCommit
import com.claudewebui.app.data.model.GitFileDiff
import com.claudewebui.app.data.model.GitStatus

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GitScreen(
    workingDirectory: String,
    gitStatus: GitStatus?,
    commits: List<GitCommit>,
    diffs: List<GitFileDiff>,
    branches: List<GitBranch>,
    isLoading: Boolean,
    isCommitting: Boolean,
    isPushing: Boolean,
    onNavigateBack: () -> Unit,
    onStageAll: () -> Unit,
    onCommit: (message: String) -> Unit,
    onPush: () -> Unit,
    onSwitchBranch: (branch: String) -> Unit,
    onRefresh: () -> Unit
) {
    var selectedTab by remember { mutableIntStateOf(0) }
    val tabs = listOf("Status", "Log", "Branches")
    var showCommitDialog by remember { mutableStateOf(false) }
    var selectedCommit by remember { mutableStateOf<GitCommit?>(null) }
    var expandedDiff by remember { mutableStateOf<GitFileDiff?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Git")
                        gitStatus?.let { status ->
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    Icons.AutoMirrored.Filled.MergeType,
                                    contentDescription = null,
                                    modifier = Modifier.size(12.dp),
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(
                                    status.branch,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Surface(
                                    color = if (status.isClean)
                                        Color(0xFF4CAF50).copy(alpha = 0.2f)
                                    else
                                        MaterialTheme.colorScheme.errorContainer,
                                    shape = RoundedCornerShape(4.dp)
                                ) {
                                    Text(
                                        if (status.isClean) "clean" else "dirty",
                                        modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = if (status.isClean)
                                            Color(0xFF4CAF50)
                                        else
                                            MaterialTheme.colorScheme.onErrorContainer
                                    )
                                }
                            }
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = onRefresh) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                },
                windowInsets = TopAppBarDefaults.windowInsets
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Tab row
            TabRow(selectedTabIndex = selectedTab) {
                tabs.forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = { Text(title) }
                    )
                }
            }

            when {
                isLoading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) { CircularProgressIndicator() }
                else -> when (selectedTab) {
                    0 -> GitStatusTab(
                        status = gitStatus,
                        diffs = diffs,
                        expandedDiff = expandedDiff,
                        onExpandDiff = { diff -> expandedDiff = if (expandedDiff == diff) null else diff },
                        onStageAll = onStageAll,
                        onCommit = { showCommitDialog = true },
                        onPush = onPush,
                        isCommitting = isCommitting,
                        isPushing = isPushing
                    )
                    1 -> GitLogTab(
                        commits = commits,
                        onCommitClick = { selectedCommit = it }
                    )
                    2 -> GitBranchesTab(
                        branches = branches,
                        onSwitchBranch = onSwitchBranch
                    )
                }
            }
        }
    }

    // Commit dialog
    if (showCommitDialog) {
        CommitDialog(
            stagedCount = gitStatus?.staged?.size ?: 0,
            onDismiss = { showCommitDialog = false },
            onCommit = { message ->
                onCommit(message)
                showCommitDialog = false
            }
        )
    }

    // Commit detail dialog
    selectedCommit?.let { commit ->
        CommitDetailDialog(
            commit = commit,
            onDismiss = { selectedCommit = null }
        )
    }
}

@Composable
private fun GitStatusTab(
    status: GitStatus?,
    diffs: List<GitFileDiff>,
    expandedDiff: GitFileDiff?,
    onExpandDiff: (GitFileDiff) -> Unit,
    onStageAll: () -> Unit,
    onCommit: () -> Unit,
    onPush: () -> Unit,
    isCommitting: Boolean,
    isPushing: Boolean
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Quick actions
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = onStageAll,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Stage All")
                }
                FilledTonalButton(
                    onClick = onCommit,
                    modifier = Modifier.weight(1f),
                    enabled = !isCommitting && (status?.staged?.isNotEmpty() == true)
                ) {
                    if (isCommitting) {
                        CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                    }
                    Spacer(Modifier.width(4.dp))
                    Text("Commit")
                }
                FilledTonalButton(
                    onClick = onPush,
                    modifier = Modifier.weight(1f),
                    enabled = !isPushing
                ) {
                    if (isPushing) {
                        CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.Upload, contentDescription = null, modifier = Modifier.size(16.dp))
                    }
                    Spacer(Modifier.width(4.dp))
                    Text("Push")
                }
            }
        }

        if (status == null) {
            item {
                Text(
                    "Not a git repository",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            return@LazyColumn
        }

        // Staged files
        if (status.staged.isNotEmpty()) {
            item {
                FileSectionHeader(
                    title = "Staged (${status.staged.size})",
                    color = Color(0xFF4CAF50)
                )
            }
            items(diffs.filter { it.staged }) { diff ->
                DiffFileItem(
                    diff = diff,
                    isExpanded = expandedDiff == diff,
                    onClick = { onExpandDiff(diff) }
                )
            }
            items(status.staged.filter { staged -> diffs.none { it.file == staged && it.staged } }) { file ->
                SimpleFileItem(file = file, status = "staged", color = Color(0xFF4CAF50))
            }
        }

        // Unstaged files
        if (status.unstaged.isNotEmpty()) {
            item {
                FileSectionHeader(
                    title = "Modified (${status.unstaged.size})",
                    color = MaterialTheme.colorScheme.secondary
                )
            }
            items(diffs.filter { !it.staged }) { diff ->
                DiffFileItem(
                    diff = diff,
                    isExpanded = expandedDiff == diff,
                    onClick = { onExpandDiff(diff) }
                )
            }
            items(status.unstaged.filter { u -> diffs.none { it.file == u && !it.staged } }) { file ->
                SimpleFileItem(file = file, status = "modified", color = MaterialTheme.colorScheme.secondary)
            }
        }

        // Untracked files
        if (status.untracked.isNotEmpty()) {
            item {
                FileSectionHeader(
                    title = "Untracked (${status.untracked.size})",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            items(status.untracked) { file ->
                SimpleFileItem(file = file, status = "untracked", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        // Clean state
        if (status.isClean) {
            item {
                Surface(
                    color = Color(0xFF4CAF50).copy(alpha = 0.1f),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.CheckCircle,
                            contentDescription = null,
                            tint = Color(0xFF4CAF50)
                        )
                        Text(
                            "Working tree clean",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color(0xFF4CAF50)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun FileSectionHeader(title: String, color: Color) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(color)
        )
        Text(
            text = title,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
            color = color
        )
    }
}

@Composable
private fun DiffFileItem(
    diff: GitFileDiff,
    isExpanded: Boolean,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.Code,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = diff.file.substringAfterLast('/'),
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "+${diff.additions}",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color(0xFF4CAF50),
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = "-${diff.deletions}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error,
                    fontWeight = FontWeight.SemiBold
                )
                Icon(
                    if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp)
                )
            }
            if (isExpanded && diff.diff.isNotBlank()) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
                DiffContent(
                    diff = diff.diff,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFF0D1117))
                        .padding(8.dp)
                )
            }
        }
    }
}

@Composable
private fun DiffContent(diff: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        diff.lines().take(100).forEach { line ->
            val color = when {
                line.startsWith("+") && !line.startsWith("+++") -> Color(0xFF4CAF50).copy(alpha = 0.8f)
                line.startsWith("-") && !line.startsWith("---") -> Color(0xFFF44336).copy(alpha = 0.8f)
                line.startsWith("@@") -> Color(0xFF2196F3).copy(alpha = 0.8f)
                else -> Color(0xFFCDD6F4).copy(alpha = 0.7f)
            }
            Text(
                text = line.take(120),
                style = MaterialTheme.typography.bodySmall.copy(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    color = color
                )
            )
        }
    }
}

@Composable
private fun SimpleFileItem(file: String, status: String, color: Color) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Surface(
            color = color.copy(alpha = 0.15f),
            shape = RoundedCornerShape(3.dp)
        ) {
            Text(
                text = status.first().uppercaseChar().toString(),
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp),
                style = MaterialTheme.typography.labelSmall,
                color = color,
                fontWeight = FontWeight.Bold
            )
        }
        Text(
            text = file.substringAfterLast('/'),
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            text = file.substringBeforeLast('/', "").ifBlank { "." },
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
private fun GitLogTab(
    commits: List<GitCommit>,
    onCommitClick: (GitCommit) -> Unit
) {
    if (commits.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("No commits found", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(commits) { commit ->
            CommitItem(commit = commit, onClick = { onCommitClick(commit) })
        }
    }
}

@Composable
private fun CommitItem(commit: GitCommit, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.Top
        ) {
            // Hash badge
            Surface(
                color = MaterialTheme.colorScheme.primaryContainer,
                shape = RoundedCornerShape(6.dp)
            ) {
                Text(
                    text = commit.shortHash,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp),
                    style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = commit.message,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Medium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(2.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = commit.author,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = "•",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = commit.date.take(10),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                modifier = Modifier.size(14.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
            )
        }
    }
}

@Composable
private fun GitBranchesTab(
    branches: List<GitBranch>,
    onSwitchBranch: (String) -> Unit
) {
    if (branches.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("No branches found", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }

    val (local, remote) = branches.partition { !it.isRemote }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        if (local.isNotEmpty()) {
            item {
                Text(
                    "Local Branches",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            items(local) { branch ->
                BranchItem(branch = branch, onSwitch = { onSwitchBranch(branch.name) })
            }
        }
        if (remote.isNotEmpty()) {
            item {
                Spacer(Modifier.height(8.dp))
                Text(
                    "Remote Branches",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.secondary
                )
            }
            items(remote) { branch ->
                BranchItem(branch = branch, onSwitch = { onSwitchBranch(branch.name) })
            }
        }
    }
}

@Composable
private fun BranchItem(branch: GitBranch, onSwitch: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = if (branch.isCurrent)
            MaterialTheme.colorScheme.primaryContainer
        else
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                if (branch.isCurrent) Icons.AutoMirrored.Filled.MergeType else Icons.Default.AccountTree,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = if (branch.isCurrent)
                    MaterialTheme.colorScheme.onPrimaryContainer
                else
                    MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = branch.name,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = if (branch.isCurrent) FontWeight.SemiBold else FontWeight.Normal,
                modifier = Modifier.weight(1f),
                color = if (branch.isCurrent)
                    MaterialTheme.colorScheme.onPrimaryContainer
                else
                    MaterialTheme.colorScheme.onSurface
            )
            if (branch.isCurrent) {
                Surface(
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.2f),
                    shape = RoundedCornerShape(4.dp)
                ) {
                    Text(
                        "current",
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            } else if (!branch.isRemote) {
                TextButton(
                    onClick = onSwitch,
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp)
                ) {
                    Text("Switch", style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

@Composable
private fun CommitDialog(
    stagedCount: Int,
    onDismiss: () -> Unit,
    onCommit: (message: String) -> Unit
) {
    var message by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.Check, contentDescription = null) },
        title = { Text("Commit Changes") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "$stagedCount staged file(s)",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                OutlinedTextField(
                    value = message,
                    onValueChange = { message = it },
                    label = { Text("Commit message") },
                    placeholder = { Text("Describe your changes...") },
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 4
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onCommit(message.trim()) },
                enabled = message.isNotBlank()
            ) {
                Text("Commit")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

@Composable
private fun CommitDetailDialog(
    commit: GitCommit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Column {
                Text(commit.message, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(4.dp))
                Text(
                    commit.hash,
                    style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Default.Person, contentDescription = null, modifier = Modifier.size(14.dp))
                    Text(commit.author, style = MaterialTheme.typography.bodySmall)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Default.Schedule, contentDescription = null, modifier = Modifier.size(14.dp))
                    Text(commit.date, style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Close") }
        }
    )
}
