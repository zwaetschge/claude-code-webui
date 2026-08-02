package com.claudewebui.app.ui.screens.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.Category
import com.claudewebui.app.data.model.CLIProvider
import com.claudewebui.app.data.model.CreateCategoryInput
import com.claudewebui.app.data.model.CreateSessionInput
import com.claudewebui.app.data.model.Session
import com.claudewebui.app.data.model.UpdateCategoryInput
import com.claudewebui.app.data.model.UpdateSessionInput
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class DashboardViewModel(
    private val apiClient: ApiClient,
) : ViewModel() {

    // ── State ─────────────────────────────────────────────────────────────────

    private val _uiState = MutableStateFlow(DashboardUiState(isLoading = true))
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()

    private val _events = Channel<DashboardEvent>(Channel.BUFFERED)
    val events = _events.receiveAsFlow()

    // Raw (unfiltered) session cache — search/filter/sort operate on this.
    private val _allSessions = MutableStateFlow<List<Session>>(emptyList())

    private var searchJob: Job? = null

    // ── Init ──────────────────────────────────────────────────────────────────

    init {
        loadData()
    }

    // ── Data Loading ──────────────────────────────────────────────────────────

    fun loadData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            loadSessions()
            loadCategories()
            loadCLIProviders()
            _uiState.update { it.copy(isLoading = false) }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true) }
            loadSessions()
            loadCategories()
            loadCLIProviders()
            _uiState.update { it.copy(isRefreshing = false) }
        }
    }

    private suspend fun loadSessions() {
        runCatching { apiClient.getSessions() }
            .onSuccess { response ->
                val sessions = response.data ?: emptyList()
                _allSessions.value = sessions
                _uiState.update { state ->
                    state.copy(
                        sessions = sessions,
                        filteredSessions = applyFilters(
                            sessions = sessions,
                            query = state.searchQuery,
                            categoryId = state.selectedCategoryId,
                            sortOrder = state.sortOrder,
                        ),
                        isOffline = false,
                    )
                }
            }
            .onFailure { error ->
                val isNetwork = error is java.net.UnknownHostException ||
                        error is java.net.SocketTimeoutException ||
                        error is java.io.IOException
                _uiState.update { state ->
                    state.copy(
                        isOffline = isNetwork,
                        error = if (!isNetwork) error.message else null,
                    )
                }
            }
    }

    private suspend fun loadCategories() {
        runCatching { apiClient.getCategories() }
            .onSuccess { response ->
                _uiState.update { it.copy(categories = response.data ?: emptyList()) }
            }
            .onFailure { /* categories are non-critical */ }
    }

    private suspend fun loadCLIProviders() {
        runCatching { apiClient.getCLIProviders() }
            .onSuccess { response ->
                val providers = response.data
                    .orEmpty()
                    .filter { it.enabled }
                    .mapNotNull { CLIProvider.fromId(it.id) }
                if (providers.isNotEmpty()) {
                    _uiState.update { it.copy(availableProviders = providers) }
                }
            }
            .onFailure { /* retain the complete local fallback registry */ }
    }

    // ── Filtering & Sorting ───────────────────────────────────────────────────

    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(200)
            applyCurrentFilters()
        }
    }

    fun toggleSearch() {
        _uiState.update { state ->
            val expanded = !state.isSearchExpanded
            if (!expanded) {
                val filtered = applyFilters(
                    sessions = _allSessions.value,
                    query = "",
                    categoryId = state.selectedCategoryId,
                    sortOrder = state.sortOrder,
                )
                state.copy(isSearchExpanded = expanded, searchQuery = "", filteredSessions = filtered)
            } else {
                state.copy(isSearchExpanded = expanded)
            }
        }
    }

    fun filterByCategory(categoryId: String?) {
        _uiState.update { state ->
            val filtered = applyFilters(
                sessions = _allSessions.value,
                query = state.searchQuery,
                categoryId = categoryId,
                sortOrder = state.sortOrder,
            )
            state.copy(selectedCategoryId = categoryId, filteredSessions = filtered)
        }
    }

    fun updateSort(order: SortOrder) {
        _uiState.update { state ->
            val filtered = applyFilters(
                sessions = _allSessions.value,
                query = state.searchQuery,
                categoryId = state.selectedCategoryId,
                sortOrder = order,
            )
            state.copy(sortOrder = order, filteredSessions = filtered)
        }
    }

    private fun applyCurrentFilters() {
        val state = _uiState.value
        val filtered = applyFilters(
            sessions = _allSessions.value,
            query = state.searchQuery,
            categoryId = state.selectedCategoryId,
            sortOrder = state.sortOrder,
        )
        _uiState.update { it.copy(filteredSessions = filtered) }
    }

    private fun applyFilters(
        sessions: List<Session>,
        query: String,
        categoryId: String?,
        sortOrder: SortOrder,
    ): List<Session> {
        var result = sessions

        if (categoryId != null) {
            result = result.filter { it.category == categoryId }
        }

        if (query.isNotBlank()) {
            val lower = query.lowercase()
            result = result.filter { session ->
                session.name.lowercase().contains(lower) ||
                        session.lastMessage?.lowercase()?.contains(lower) == true
            }
        }

        result = when (sortOrder) {
            SortOrder.RECENT   -> result.sortedByDescending { it.updatedAt }
            SortOrder.NAME     -> result.sortedBy { it.name.lowercase() }
            SortOrder.STATUS   -> result.sortedWith(
                compareByDescending<Session> {
                    it.status == com.claudewebui.app.data.model.SessionStatus.RUNNING
                }.thenByDescending { it.updatedAt }
            )
            SortOrder.PROVIDER -> result.sortedWith(
                compareBy<Session> { it.cliProvider.name }
                    .thenByDescending { it.updatedAt }
            )
        }

        return result
    }

    // ── Session CRUD ──────────────────────────────────────────────────────────

    fun createSession(
        name: String,
        workingDirectory: String?,
        provider: CLIProvider,
    ) {
        viewModelScope.launch {
            runCatching {
                apiClient.createSession(
                    CreateSessionInput(
                        name = name.ifBlank { "Session ${System.currentTimeMillis() % 10000}" },
                        workingDirectory = workingDirectory,
                        cliProvider = provider,
                    )
                )
            }.onSuccess { response ->
                response.data?.let { session ->
                    val updated = listOf(session) + _allSessions.value
                    _allSessions.value = updated
                    _uiState.update { state ->
                        state.copy(
                            sessions = updated,
                            filteredSessions = applyFilters(
                                sessions = updated,
                                query = state.searchQuery,
                                categoryId = state.selectedCategoryId,
                                sortOrder = state.sortOrder,
                            )
                        )
                    }
                    _events.send(DashboardEvent.SessionCreated(session))
                    _events.send(DashboardEvent.NavigateToChat(session.id))
                }
            }.onFailure { error ->
                _events.send(DashboardEvent.ShowError("Failed to create session: ${error.message}"))
            }
        }
    }

    fun deleteSession(id: String) {
        viewModelScope.launch {
            runCatching { apiClient.deleteSession(id) }
                .onSuccess {
                    val updated = _allSessions.value.filter { it.id != id }
                    _allSessions.value = updated
                    _uiState.update { state ->
                        state.copy(
                            sessions = updated,
                            filteredSessions = applyFilters(
                                sessions = updated,
                                query = state.searchQuery,
                                categoryId = state.selectedCategoryId,
                                sortOrder = state.sortOrder,
                            )
                        )
                    }
                    _events.send(DashboardEvent.SessionDeleted(id))
                }
                .onFailure { error ->
                    _events.send(DashboardEvent.ShowError("Failed to delete: ${error.message}"))
                }
        }
    }

    fun renameSession(id: String, newName: String) {
        viewModelScope.launch {
            runCatching { apiClient.updateSession(id, UpdateSessionInput(name = newName)) }
                .onSuccess { response ->
                    response.data?.let { updated ->
                        val newList = _allSessions.value.map { if (it.id == id) updated else it }
                        _allSessions.value = newList
                        applyCurrentFilters()
                        _uiState.update { it.copy(sessions = newList) }
                    }
                }
                .onFailure { error ->
                    _events.send(DashboardEvent.ShowError("Failed to rename: ${error.message}"))
                }
        }
    }

    fun moveSessionToCategory(sessionId: String, categoryId: String?) {
        viewModelScope.launch {
            runCatching { apiClient.updateSessionCategory(sessionId, categoryId) }
                .onSuccess { response ->
                    response.data?.let { updated ->
                        val newList = _allSessions.value.map { if (it.id == sessionId) updated else it }
                        _allSessions.value = newList
                        applyCurrentFilters()
                        _uiState.update { it.copy(sessions = newList) }
                    }
                }
                .onFailure { error ->
                    _events.send(DashboardEvent.ShowError("Failed to move: ${error.message}"))
                }
        }
    }

    // ── Category CRUD ─────────────────────────────────────────────────────────

    fun createCategory(name: String, color: String) {
        viewModelScope.launch {
            runCatching { apiClient.createCategory(CreateCategoryInput(name = name, color = color)) }
                .onSuccess { response ->
                    response.data?.let { cat ->
                        _uiState.update { it.copy(categories = it.categories + cat) }
                    }
                }
                .onFailure { error ->
                    _events.send(DashboardEvent.ShowError("Failed to create category: ${error.message}"))
                }
        }
    }

    fun updateCategory(id: String, name: String, color: String) {
        viewModelScope.launch {
            runCatching {
                apiClient.updateCategory(id, UpdateCategoryInput(name = name, color = color))
            }.onSuccess { response ->
                response.data?.let { updated ->
                    _uiState.update { state ->
                        state.copy(categories = state.categories.map { if (it.id == id) updated else it })
                    }
                }
            }.onFailure { error ->
                _events.send(DashboardEvent.ShowError("Failed to update category: ${error.message}"))
            }
        }
    }

    fun deleteCategory(id: String) {
        viewModelScope.launch {
            runCatching { apiClient.deleteCategory(id) }
                .onSuccess {
                    _uiState.update { state ->
                        val newCats = state.categories.filter { it.id != id }
                        val newSelected = if (state.selectedCategoryId == id) null else state.selectedCategoryId
                        state.copy(categories = newCats, selectedCategoryId = newSelected)
                    }
                    applyCurrentFilters()
                }
                .onFailure { error ->
                    _events.send(DashboardEvent.ShowError("Failed to delete category: ${error.message}"))
                }
        }
    }

    fun reorderCategories(categories: List<Category>) {
        _uiState.update { it.copy(categories = categories) }
        viewModelScope.launch {
            categories.forEachIndexed { index, cat ->
                runCatching {
                    apiClient.updateCategory(cat.id, UpdateCategoryInput(sortOrder = index))
                }
            }
        }
    }

    // ── Navigation helpers ────────────────────────────────────────────────────

    fun onSessionTapped(sessionId: String) {
        viewModelScope.launch { _events.send(DashboardEvent.NavigateToChat(sessionId)) }
    }

    fun onNewSessionFabTapped() {
        viewModelScope.launch { _events.send(DashboardEvent.ShowNewSessionDialog) }
    }

    fun onCategoryManagerTapped() {
        viewModelScope.launch { _events.send(DashboardEvent.ShowCategoryManager) }
    }

    fun onSettingsTapped() {
        viewModelScope.launch { _events.send(DashboardEvent.NavigateToSettings) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    /** Called by the Socket.IO listener when a session event arrives. */
    fun onSocketSessionEvent() {
        viewModelScope.launch { loadSessions() }
    }
}
