package com.claudewebui.app.ui.screens.dashboard

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Sort
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.claudewebui.app.data.model.Category
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.SessionStatus
import com.claudewebui.app.ui.components.common.PullToRefreshContainer
import com.claudewebui.app.ui.components.dashboard.CategoryManager
import com.claudewebui.app.ui.components.dashboard.NewSessionDialog
import com.claudewebui.app.ui.components.dashboard.SessionCard
import com.claudewebui.app.ui.components.dashboard.SessionCardSkeleton
import com.claudewebui.app.ui.theme.ClaudeWebUITheme
import com.claudewebui.app.ui.theme.SuccessGreen
import kotlinx.coroutines.launch
import org.koin.compose.viewmodel.koinViewModel

// ── DashboardScreen ───────────────────────────────────────────────────────────

@Composable
fun DashboardScreen(
    onNavigateToChat: (sessionId: String) -> Unit,
    onNavigateToSettings: () -> Unit,
    viewModel: DashboardViewModel = koinViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    var showNewSessionDialog by remember { mutableStateOf(false) }
    var showCategoryManager by remember { mutableStateOf(false) }
    var renameTarget by remember { mutableStateOf<Session?>(null) }
    var moveCategoryTarget by remember { mutableStateOf<Session?>(null) }

    // Consume one-shot events
    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            when (event) {
                is DashboardEvent.NavigateToChat -> onNavigateToChat(event.sessionId)
                is DashboardEvent.ShowError -> scope.launch {
                    snackbarHostState.showSnackbar(event.message)
                }
                is DashboardEvent.ShowNewSessionDialog -> showNewSessionDialog = true
                is DashboardEvent.ShowCategoryManager -> showCategoryManager = true
                is DashboardEvent.NavigateToSettings -> onNavigateToSettings()
                is DashboardEvent.SessionCreated, is DashboardEvent.SessionDeleted -> { /* handled in VM */ }
            }
        }
    }

    val listState = rememberLazyListState()
    val isFabExpanded by remember {
        derivedStateOf { listState.firstVisibleItemIndex == 0 }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            DashboardTopBar(
                isOffline = uiState.isOffline,
                isSearchExpanded = uiState.isSearchExpanded,
                searchQuery = uiState.searchQuery,
                sortOrder = uiState.sortOrder,
                onSearchToggle = { viewModel.toggleSearch() },
                onSearchQueryChange = { viewModel.setSearchQuery(it) },
                onSortSelected = { viewModel.updateSort(it) },
                onSettingsTapped = { viewModel.onSettingsTapped() },
                onCategoryManagerTapped = { viewModel.onCategoryManagerTapped() },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                text = { Text("New Session") },
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                onClick = { viewModel.onNewSessionFabTapped() },
                expanded = isFabExpanded,
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { innerPadding ->

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {

            // ── Category filter chips ─────────────────────────────────────────
            CategoryChipsRow(
                categories = uiState.categories,
                selectedId = uiState.selectedCategoryId,
                onSelect = { viewModel.filterByCategory(it) },
            )

            // ── Offline banner ────────────────────────────────────────────────
            AnimatedVisibility(
                visible = uiState.isOffline,
                enter = slideInVertically() + fadeIn(),
                exit = slideOutVertically() + fadeOut(),
            ) {
                OfflineBanner()
            }

            // ── Main content ──────────────────────────────────────────────────
            PullToRefreshContainer(
                isRefreshing = uiState.isRefreshing,
                onRefresh = { viewModel.refresh() },
                modifier = Modifier.fillMaxSize(),
            ) {
                when {
                    uiState.isInitialLoading -> SkeletonList()

                    uiState.filteredSessions.isEmpty() -> EmptyState(
                        isSearchActive = uiState.searchQuery.isNotBlank() ||
                                uiState.selectedCategoryId != null,
                        onClearFilters = {
                            viewModel.setSearchQuery("")
                            viewModel.filterByCategory(null)
                        },
                        onNewSession = { viewModel.onNewSessionFabTapped() },
                    )

                    else -> SessionList(
                        sessions = uiState.filteredSessions,
                        categories = uiState.categories,
                        listState = listState,
                        onSessionClick = { viewModel.onSessionTapped(it) },
                        onDelete = { viewModel.deleteSession(it) },
                        onArchive = { /* archive via category */ },
                        onRename = { session -> renameTarget = session },
                        onDuplicate = { session ->
                            viewModel.createSession(
                                name = "${session.name} (copy)",
                                workingDirectory = session.workingDirectory,
                                provider = session.cliProvider,
                            )
                        },
                        onMoveToCategory = { session -> moveCategoryTarget = session },
                    )
                }
            }
        }
    }

    // ── Dialogs / Bottom Sheets ───────────────────────────────────────────────

    if (showNewSessionDialog) {
        NewSessionDialog(
            categories = uiState.categories,
            onDismiss = { showNewSessionDialog = false },
            onCreate = { name, provider, workingDirectory ->
                viewModel.createSession(name, workingDirectory, provider)
            },
        )
    }

    if (showCategoryManager) {
        CategoryManager(
            categories = uiState.categories,
            onDismiss = { showCategoryManager = false },
            onCreate = { name, color -> viewModel.createCategory(name, color) },
            onUpdate = { id, name, color -> viewModel.updateCategory(id, name, color) },
            onDelete = { viewModel.deleteCategory(it) },
            onReorder = { viewModel.reorderCategories(it) },
        )
    }

    renameTarget?.let { session ->
        RenameDialog(
            current = session.name,
            onConfirm = { newName ->
                viewModel.renameSession(session.id, newName)
                renameTarget = null
            },
            onDismiss = { renameTarget = null },
        )
    }

    moveCategoryTarget?.let { session ->
        MoveToCategoryDialog(
            categories = uiState.categories,
            currentCategoryId = session.category,
            onConfirm = { categoryId ->
                viewModel.moveSessionToCategory(session.id, categoryId)
                moveCategoryTarget = null
            },
            onDismiss = { moveCategoryTarget = null },
        )
    }
}

// ── Top App Bar ───────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DashboardTopBar(
    isOffline: Boolean,
    isSearchExpanded: Boolean,
    searchQuery: String,
    sortOrder: SortOrder,
    onSearchToggle: () -> Unit,
    onSearchQueryChange: (String) -> Unit,
    onSortSelected: (SortOrder) -> Unit,
    onSettingsTapped: () -> Unit,
    onCategoryManagerTapped: () -> Unit,
) {
    var sortMenuExpanded by remember { mutableStateOf(false) }
    var overflowMenuExpanded by remember { mutableStateOf(false) }
    val searchFocus = remember { FocusRequester() }

    LaunchedEffect(isSearchExpanded) {
        if (isSearchExpanded) {
            kotlinx.coroutines.delay(100)
            searchFocus.requestFocus()
        }
    }

    TopAppBar(
        title = {
            AnimatedContent(
                targetState = isSearchExpanded,
                transitionSpec = {
                    fadeIn(tween(200)) togetherWith fadeOut(tween(150))
                },
                label = "topBarTitle",
            ) { searching ->
                if (searching) {
                    OutlinedTextField(
                        value = searchQuery,
                        onValueChange = onSearchQueryChange,
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(searchFocus),
                        placeholder = {
                            Text(
                                "Search sessions…",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        },
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = MaterialTheme.colorScheme.primary,
                            unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
                        ),
                    )
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "Plum Code",
                            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        ConnectionDot(isOnline = !isOffline)
                    }
                }
            }
        },
        actions = {
            // Search toggle
            IconButton(onClick = onSearchToggle) {
                Icon(
                    imageVector = if (isSearchExpanded) Icons.Default.Close else Icons.Default.Search,
                    contentDescription = if (isSearchExpanded) "Close search" else "Search",
                )
            }

            // Sort
            IconButton(onClick = { sortMenuExpanded = true }) {
                Icon(Icons.Default.Sort, contentDescription = "Sort")
            }
            DropdownMenu(
                expanded = sortMenuExpanded,
                onDismissRequest = { sortMenuExpanded = false },
            ) {
                SortOrder.entries.forEach { order ->
                    DropdownMenuItem(
                        text = { Text(order.label) },
                        leadingIcon = {
                            if (order == sortOrder) {
                                Icon(
                                    Icons.Default.Check,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp),
                                    tint = MaterialTheme.colorScheme.primary,
                                )
                            }
                        },
                        onClick = {
                            onSortSelected(order)
                            sortMenuExpanded = false
                        },
                    )
                }
            }

            // Overflow menu
            IconButton(onClick = { overflowMenuExpanded = true }) {
                Icon(Icons.Default.MoreVert, contentDescription = "More")
            }
            DropdownMenu(
                expanded = overflowMenuExpanded,
                onDismissRequest = { overflowMenuExpanded = false },
            ) {
                DropdownMenuItem(
                    text = { Text("Categories") },
                    onClick = { overflowMenuExpanded = false; onCategoryManagerTapped() },
                )
                DropdownMenuItem(
                    text = { Text("Settings") },
                    leadingIcon = { Icon(Icons.Default.Settings, contentDescription = null) },
                    onClick = { overflowMenuExpanded = false; onSettingsTapped() },
                )
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.background,
            titleContentColor = MaterialTheme.colorScheme.onBackground,
            actionIconContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        ),
    )
}

// ── Connection Dot ────────────────────────────────────────────────────────────

@Composable
private fun ConnectionDot(isOnline: Boolean) {
    val dotColor by animateColorAsState(
        targetValue = if (isOnline) SuccessGreen else MaterialTheme.colorScheme.error,
        animationSpec = tween(600),
        label = "connectionDot",
    )
    Box(
        modifier = Modifier
            .size(8.dp)
            .clip(RoundedCornerShape(50))
            .background(dotColor),
    )
}

// ── Category Chips Row ────────────────────────────────────────────────────────

@Composable
private fun CategoryChipsRow(
    categories: List<Category>,
    selectedId: String?,
    onSelect: (String?) -> Unit,
) {
    if (categories.isEmpty()) return

    LazyRow(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            FilterChip(
                selected = selectedId == null,
                onClick = { onSelect(null) },
                label = { Text("All") },
                leadingIcon = if (selectedId == null) {
                    { Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp)) }
                } else null,
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                    selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    selectedLeadingIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
                ),
            )
        }
        items(categories, key = { it.id }) { cat ->
            FilterChip(
                selected = selectedId == cat.id,
                onClick = { onSelect(if (selectedId == cat.id) null else cat.id) },
                label = { Text(cat.name) },
                leadingIcon = if (selectedId == cat.id) {
                    { Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp)) }
                } else null,
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                    selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    selectedLeadingIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
                ),
            )
        }
    }
}

// ── Session List ──────────────────────────────────────────────────────────────

@Composable
private fun SessionList(
    sessions: List<Session>,
    categories: List<Category>,
    listState: androidx.compose.foundation.lazy.LazyListState,
    onSessionClick: (String) -> Unit,
    onDelete: (String) -> Unit,
    onArchive: (String) -> Unit,
    onRename: (Session) -> Unit,
    onDuplicate: (Session) -> Unit,
    onMoveToCategory: (Session) -> Unit,
) {
    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = 8.dp,
            bottom = 96.dp, // FAB clearance
        ),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        itemsIndexed(
            items = sessions,
            key = { _, session -> session.id },
        ) { index, session ->
            val delay = (index * 40).coerceAtMost(300)
            AnimatedVisibility(
                visible = true,
                enter = slideInVertically(
                    animationSpec = spring(
                        dampingRatio = Spring.DampingRatioMediumBouncy,
                        stiffness = Spring.StiffnessMediumLow,
                    ),
                    initialOffsetY = { it / 3 },
                ) + fadeIn(tween(delayMillis = delay)),
            ) {
                SessionCard(
                    session = session,
                    onClick = { onSessionClick(session.id) },
                    onDelete = { onDelete(session.id) },
                    onArchive = { onArchive(session.id) },
                    onRename = { onRename(session) },
                    onDuplicate = { onDuplicate(session) },
                    onMoveToCategory = { onMoveToCategory(session) },
                )
            }
        }
    }
}

// ── Skeleton List ─────────────────────────────────────────────────────────────

@Composable
private fun SkeletonList() {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        items(6) {
            SessionCardSkeleton()
        }
    }
}

// ── Empty State ───────────────────────────────────────────────────────────────

@Composable
private fun EmptyState(
    isSearchActive: Boolean,
    onClearFilters: () -> Unit,
    onNewSession: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = if (isSearchActive) "No results" else "No sessions yet",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = if (isSearchActive)
                    "Try a different search or clear your filters."
                else
                    "Create your first session to get started.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(4.dp))
            if (isSearchActive) {
                androidx.compose.material3.OutlinedButton(onClick = onClearFilters) {
                    Text("Clear filters")
                }
            } else {
                androidx.compose.material3.Button(
                    onClick = onNewSession,
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("New Session")
                }
            }
        }
    }
}

// ── Offline Banner ────────────────────────────────────────────────────────────

@Composable
private fun OfflineBanner() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.errorContainer)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            imageVector = Icons.Default.WifiOff,
            contentDescription = null,
            modifier = Modifier.size(16.dp),
            tint = MaterialTheme.colorScheme.onErrorContainer,
        )
        Text(
            text = "Offline — showing cached sessions",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onErrorContainer,
        )
    }
}

// ── Rename Dialog ─────────────────────────────────────────────────────────────

@Composable
private fun RenameDialog(
    current: String,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var text by remember { mutableStateOf(current) }
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(100)
        focusRequester.requestFocus()
    }

    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Rename session") },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester),
                singleLine = true,
                shape = RoundedCornerShape(10.dp),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                    imeAction = androidx.compose.ui.text.input.ImeAction.Done,
                ),
                keyboardActions = androidx.compose.foundation.text.KeyboardActions(
                    onDone = { if (text.isNotBlank()) onConfirm(text.trim()) }
                ),
            )
        },
        confirmButton = {
            androidx.compose.material3.TextButton(
                onClick = { if (text.isNotBlank()) onConfirm(text.trim()) },
                enabled = text.isNotBlank(),
            ) {
                Text("Rename")
            }
        },
        dismissButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

// ── Move to Category Dialog ───────────────────────────────────────────────────

@Composable
private fun MoveToCategoryDialog(
    categories: List<Category>,
    currentCategoryId: String?,
    onConfirm: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    var selectedId by remember { mutableStateOf(currentCategoryId) }

    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Move to category") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                // "None" option
                CategoryDialogRow(
                    name = "No category",
                    colorHex = null,
                    isSelected = selectedId == null,
                    onClick = { selectedId = null },
                )
                categories.forEach { cat ->
                    CategoryDialogRow(
                        name = cat.name,
                        colorHex = cat.color,
                        isSelected = selectedId == cat.id,
                        onClick = { selectedId = cat.id },
                    )
                }
            }
        },
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = { onConfirm(selectedId) }) {
                Text("Move")
            }
        },
        dismissButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

@Composable
private fun CategoryDialogRow(
    name: String,
    colorHex: String?,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (colorHex != null) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(RoundedCornerShape(50))
                    .background(com.claudewebui.app.ui.components.dashboard.parseHexColor(colorHex)),
            )
        } else {
            Spacer(Modifier.size(10.dp))
        }
        Text(
            text = name,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        if (isSelected) {
            Icon(
                Icons.Default.Check,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

// ── Preview ───────────────────────────────────────────────────────────────────

@Preview(showBackground = true, showSystemUi = true, backgroundColor = 0xFFF0EFEA)
@Composable
private fun DashboardScreenPreview() {
    ClaudeWebUITheme {
        // Static preview using local state (no ViewModel)
        DashboardScreenContent(
            state = DashboardUiState(
                filteredSessions = listOf(
                    Session(
                        id = "1", userId = "u", name = "Build Dashboard",
                        workingDirectory = "/home", status = SessionStatus.RUNNING,
                        lastMessage = "Working on the SessionCard…",
                        cliProvider = CLIProvider.CLAUDE,
                        createdAt = "2024-01-15T10:00:00Z",
                        updatedAt = "2024-01-15T10:05:00Z",
                    ),
                    Session(
                        id = "2", userId = "u", name = "API Tests",
                        workingDirectory = "/home/api", status = SessionStatus.STOPPED,
                        lastMessage = "All 47 tests passing.",
                        cliProvider = CLIProvider.CODEX,
                        createdAt = "2024-01-14T08:00:00Z",
                        updatedAt = "2024-01-14T09:30:00Z",
                    ),
                ),
                categories = listOf(
                    Category("1", "u", "Work", "#6366f1", "folder", 0, ""),
                ),
            ),
        )
    }
}

// Stateless content composable for preview and testing
@Composable
private fun DashboardScreenContent(state: DashboardUiState) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        floatingActionButton = {
            ExtendedFloatingActionButton(
                text = { Text("New Session") },
                icon = { Icon(Icons.Default.Add, null) },
                onClick = {},
                expanded = true,
            )
        },
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            CategoryChipsRow(
                categories = state.categories,
                selectedId = null,
                onSelect = {},
            )
            LazyColumn(
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(state.filteredSessions, key = { it.id }) { session ->
                    SessionCard(
                        session = session,
                        onClick = {}, onDelete = {}, onArchive = {},
                        onRename = {}, onDuplicate = {}, onMoveToCategory = {},
                    )
                }
            }
        }
    }
}
