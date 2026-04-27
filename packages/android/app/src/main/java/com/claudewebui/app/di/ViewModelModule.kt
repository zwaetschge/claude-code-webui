package com.claudewebui.app.di

import com.claudewebui.app.data.repository.AuthRepository
import com.claudewebui.app.data.repository.MessageRepository
import com.claudewebui.app.data.repository.SessionRepository
import com.claudewebui.app.data.repository.SettingsRepository
import com.claudewebui.app.ui.screens.analytics.AnalyticsViewModel
import com.claudewebui.app.ui.screens.analytics.WatchdogViewModel
import com.claudewebui.app.ui.screens.auth.LoginViewModel
import com.claudewebui.app.ui.screens.chat.ChatViewModel
import com.claudewebui.app.ui.screens.chat.CheckpointViewModel
import com.claudewebui.app.ui.screens.chat.GitViewModel
import com.claudewebui.app.ui.screens.chat.UsageViewModel
import com.claudewebui.app.ui.screens.dashboard.DashboardViewModel
import com.claudewebui.app.ui.screens.filemanager.FileManagerViewModel
import com.claudewebui.app.ui.screens.orchestration.OrchestrationViewModel
import com.claudewebui.app.ui.screens.ralph.RalphViewModel
import com.claudewebui.app.ui.screens.settings.SettingsViewModel
import org.koin.android.ext.koin.androidContext
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module

val viewModelModule = module {

    // --- Repositories ---

    single { AuthRepository(get(), get()) }

    single { SessionRepository(get(), get()) }

    single { MessageRepository(get(), get(), get()) }

    single { SettingsRepository(get()) }

    // --- ViewModels ---

    // LoginViewModel(apiClient, context)
    viewModel { LoginViewModel(get(), androidContext()) }

    // DashboardViewModel(apiClient)
    viewModel { DashboardViewModel(get()) }

    // ChatViewModel(sessionId, messageRepository, sessionRepository, socketManager)
    viewModel { (sessionId: String) -> ChatViewModel(sessionId, get(), get(), get()) }

    // SettingsViewModel(settingsRepository, authRepository, context)
    viewModel { SettingsViewModel(get(), get(), androidContext()) }

    // FileManagerViewModel(sessionId, initialPath) — uses KoinComponent internally for ApiClient
    viewModel { (sessionId: String, initialPath: String) ->
        FileManagerViewModel(sessionId, initialPath)
    }

    // AnalyticsViewModel(apiClient)
    viewModel { AnalyticsViewModel(get()) }

    // WatchdogViewModel(apiClient)
    viewModel { WatchdogViewModel(get()) }

    // OrchestrationViewModel(sessionId, socketManager, sessionRepository)
    viewModel { (sessionId: String) -> OrchestrationViewModel(sessionId, get(), get()) }

    // RalphViewModel(sessionId, socketManager, sessionRepository)
    viewModel { (sessionId: String) -> RalphViewModel(sessionId, get(), get()) }

    // CheckpointViewModel(sessionId, apiClient)
    viewModel { (sessionId: String) -> CheckpointViewModel(sessionId, get()) }

    // GitViewModel(sessionId, apiClient, sessionRepository)
    viewModel { (sessionId: String) -> GitViewModel(sessionId, get(), get()) }

    // UsageViewModel(sessionId, apiClient)
    viewModel { (sessionId: String) -> UsageViewModel(sessionId, get()) }
}
