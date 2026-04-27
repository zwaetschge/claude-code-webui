package com.claudewebui.app.ui.screens.dashboard

import com.claudewebui.app.data.model.Category
import com.claudewebui.app.data.model.Session

// ── Sort Order ────────────────────────────────────────────────────────────────

enum class SortOrder(val label: String) {
    RECENT("Recent"),
    NAME("Name"),
    STATUS("Status"),
    PROVIDER("Provider"),
}

// ── UI State ──────────────────────────────────────────────────────────────────

data class DashboardUiState(
    val sessions: List<Session> = emptyList(),
    val filteredSessions: List<Session> = emptyList(),
    val categories: List<Category> = emptyList(),
    val selectedCategoryId: String? = null,   // null = "All"
    val searchQuery: String = "",
    val sortOrder: SortOrder = SortOrder.RECENT,
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: String? = null,
    val isOffline: Boolean = false,
    val isSearchExpanded: Boolean = false,
) {
    /** True when initial load is in progress (no data yet). */
    val isInitialLoading: Boolean
        get() = isLoading && sessions.isEmpty()
}

// ── One-shot Events ───────────────────────────────────────────────────────────

sealed class DashboardEvent {
    data class NavigateToChat(val sessionId: String) : DashboardEvent()
    data class ShowError(val message: String) : DashboardEvent()
    data class SessionCreated(val session: Session) : DashboardEvent()
    data class SessionDeleted(val sessionId: String) : DashboardEvent()
    object ShowNewSessionDialog : DashboardEvent()
    object ShowCategoryManager : DashboardEvent()
    object NavigateToSettings : DashboardEvent()
}
