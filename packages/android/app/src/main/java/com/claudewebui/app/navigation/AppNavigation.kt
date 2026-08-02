package com.claudewebui.app.navigation

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.navigation
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.navigation.navDeepLink
import com.claudewebui.app.BuildConfig
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.ui.screens.analytics.AnalyticsScreen
import com.claudewebui.app.ui.screens.activity.ActivityScreen
import com.claudewebui.app.ui.screens.auth.LoginScreen
import com.claudewebui.app.ui.screens.auth.ServerSetupScreen
import com.claudewebui.app.ui.screens.chat.ChatScreen
import com.claudewebui.app.ui.screens.chat.CheckpointScreen
import com.claudewebui.app.ui.screens.chat.CheckpointViewModel
import com.claudewebui.app.ui.screens.chat.GitScreen
import com.claudewebui.app.ui.screens.chat.GitViewModel
import com.claudewebui.app.ui.screens.chat.UsageScreen
import com.claudewebui.app.ui.screens.chat.UsageViewModel
import com.claudewebui.app.ui.screens.dashboard.DashboardScreen
import com.claudewebui.app.ui.screens.filemanager.FileManagerScreen
import com.claudewebui.app.ui.screens.library.LibraryScreen
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.screens.settings.AgentsScreen
import com.claudewebui.app.ui.screens.settings.CliToolsScreen
import com.claudewebui.app.ui.screens.settings.McpSettingsScreen
import com.claudewebui.app.ui.screens.settings.PermissionsScreen
import com.claudewebui.app.ui.screens.settings.ProviderSettingsScreen
import com.claudewebui.app.ui.screens.settings.SettingsScreen
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf

// Transition duration in ms
private const val TRANSITION_DURATION = 300

private fun enterSlide(): AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
    slideInHorizontally(
        initialOffsetX = { fullWidth -> fullWidth },
        animationSpec = tween(TRANSITION_DURATION)
    ) + fadeIn(animationSpec = tween(TRANSITION_DURATION))
}

private fun exitSlide(): AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
    slideOutHorizontally(
        targetOffsetX = { fullWidth -> -fullWidth / 3 },
        animationSpec = tween(TRANSITION_DURATION)
    ) + fadeOut(animationSpec = tween(TRANSITION_DURATION))
}

private fun popEnterSlide(): AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
    slideInHorizontally(
        initialOffsetX = { fullWidth -> -fullWidth / 3 },
        animationSpec = tween(TRANSITION_DURATION)
    ) + fadeIn(animationSpec = tween(TRANSITION_DURATION))
}

private fun popExitSlide(): AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
    slideOutHorizontally(
        targetOffsetX = { fullWidth -> fullWidth },
        animationSpec = tween(TRANSITION_DURATION)
    ) + fadeOut(animationSpec = tween(TRANSITION_DURATION))
}

@Composable
fun AppNavigation(
    navController: NavHostController = rememberNavController(),
    deepLinkUri: String? = null
) {
    val startDestination = remember {
        val isDesignPreview = BuildConfig.DEBUG && deepLinkUri == "claudewebui://preview"
        val isChatPreview = BuildConfig.DEBUG && deepLinkUri == "claudewebui://preview-chat"
        when {
            isChatPreview -> Routes.Chat.createRoute("preview")
            TokenStore.isLoggedIn || isDesignPreview -> Routes.Dashboard.route
            else -> Routes.Login.route
        }
    }

    NavHost(
        navController = navController,
        startDestination = startDestination,
        enterTransition = enterSlide(),
        exitTransition = exitSlide(),
        popEnterTransition = popEnterSlide(),
        popExitTransition = popExitSlide()
    ) {

        // ---- Auth ----

        composable(route = Routes.Login.route) {
            val viewModel = koinViewModel<com.claudewebui.app.ui.screens.auth.LoginViewModel>()
            LoginScreen(
                viewModel = viewModel,
                onAuthenticated = { _ ->
                    navController.navigate(Routes.Dashboard.route) {
                        popUpTo(Routes.Login.route) { inclusive = true }
                    }
                },
                onNavigateToServerSetup = {
                    navController.navigate(Routes.ServerSetup.route)
                },
                authCallbackUri = deepLinkUri?.takeIf {
                    it.startsWith("claudewebui://auth/callback")
                },
            )
        }

        composable(route = Routes.ServerSetup.route) {
            val viewModel = koinViewModel<com.claudewebui.app.ui.screens.auth.LoginViewModel>()
            ServerSetupScreen(
                viewModel = viewModel,
                onServerConnected = {
                    navController.navigate(Routes.Login.route) {
                        popUpTo(Routes.ServerSetup.route) { inclusive = true }
                    }
                }
            )
        }

        // ---- Dashboard ----

        composable(route = Routes.Dashboard.route) {
            DashboardScreen(
                onNavigateToChat = { sessionId ->
                    navController.navigate(Routes.Chat.createRoute(sessionId))
                },
                onNavigateToSettings = {
                    navController.navigate(SETTINGS_GRAPH)
                },
                onNavigateMain = { navController.navigateMain(it) },
            )
        }

        composable(route = Routes.Activity.route) {
            ActivityScreen(
                onNavigateMain = { navController.navigateMain(it) },
                onOpenSession = { sessionId ->
                    navController.navigate(Routes.Chat.createRoute(sessionId))
                },
            )
        }

        composable(route = Routes.Library.route) {
            LibraryScreen(onNavigateMain = { navController.navigateMain(it) })
        }

        // ---- Chat ----

        composable(
            route = Routes.Chat.ROUTE,
            arguments = listOf(
                navArgument(Routes.Chat.ARG_SESSION_ID) { type = NavType.StringType }
            ),
            deepLinks = listOf(
                navDeepLink { uriPattern = "claudewebui://session/{sessionId}" }
            )
        ) { backStackEntry ->
            val sessionId = backStackEntry.arguments?.getString(Routes.Chat.ARG_SESSION_ID)
                ?: return@composable
            ChatScreen(
                sessionId = sessionId,
                onNavigateBack = { navController.popBackStack() },
                onNavigateToFiles = { sid ->
                    navController.navigate(Routes.FileManager.createRoute(sid))
                },
                onNavigateToGit = { sid ->
                    navController.navigate(Routes.GitManager.createRoute(sid))
                },
                onNavigateToCheckpoints = { sid ->
                    navController.navigate(Routes.CheckpointManager.createRoute(sid))
                },
            )
        }

        // ---- Settings (nested navigation graph) ----

        navigation(
            startDestination = Routes.Settings.route,
            route = SETTINGS_GRAPH
        ) {
            composable(route = Routes.Settings.route) {
                val viewModel =
                    koinViewModel<com.claudewebui.app.ui.screens.settings.SettingsViewModel>()
                SettingsScreen(
                    viewModel = viewModel,
                    onNavigateToProviders = { navController.navigate(Routes.SettingsProviders.route) },
                    onNavigateToMcp = { navController.navigate(Routes.SettingsMcp.route) },
                    onNavigateToCliTools = { navController.navigate(Routes.SettingsCliTools.route) },
                    onNavigateToAgents = { navController.navigate(Routes.SettingsAgents.route) },
                    onNavigateToPermissions = { navController.navigate(Routes.SettingsPermissions.route) },
                    onLoggedOut = {
                        navController.navigate(Routes.Login.route) {
                            popUpTo(0) { inclusive = true }
                        }
                    },
                    onNavigateMain = { navController.navigateMain(it) },
                )
            }

            composable(route = Routes.SettingsProviders.route) {
                val viewModel =
                    koinViewModel<com.claudewebui.app.ui.screens.settings.SettingsViewModel>()
                ProviderSettingsScreen(
                    viewModel = viewModel,
                    onNavigateBack = { navController.popBackStack() }
                )
            }

            composable(route = Routes.SettingsMcp.route) {
                val viewModel =
                    koinViewModel<com.claudewebui.app.ui.screens.settings.SettingsViewModel>()
                McpSettingsScreen(
                    viewModel = viewModel,
                    onNavigateBack = { navController.popBackStack() }
                )
            }

            composable(route = Routes.SettingsCliTools.route) {
                val viewModel =
                    koinViewModel<com.claudewebui.app.ui.screens.settings.SettingsViewModel>()
                CliToolsScreen(
                    viewModel = viewModel,
                    onNavigateBack = { navController.popBackStack() }
                )
            }

            composable(route = Routes.SettingsAgents.route) {
                val viewModel =
                    koinViewModel<com.claudewebui.app.ui.screens.settings.SettingsViewModel>()
                AgentsScreen(
                    viewModel = viewModel,
                    onNavigateBack = { navController.popBackStack() }
                )
            }

            composable(route = Routes.SettingsPermissions.route) {
                val viewModel =
                    koinViewModel<com.claudewebui.app.ui.screens.settings.SettingsViewModel>()
                PermissionsScreen(
                    viewModel = viewModel,
                    onNavigateBack = { navController.popBackStack() }
                )
            }
        }

        // ---- File Manager ----

        composable(
            route = Routes.FileManager.ROUTE,
            arguments = listOf(
                navArgument(Routes.FileManager.ARG_SESSION_ID) { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val sessionId = backStackEntry.arguments?.getString(Routes.FileManager.ARG_SESSION_ID)
                ?: return@composable
            FileManagerScreen(
                sessionId = sessionId,
                workingDirectory = "",
                onNavigateBack = { navController.popBackStack() },
                onOpenFile = { fileInfo ->
                    navController.navigate(
                        Routes.FileViewer.createRoute(sessionId, fileInfo.name)
                    )
                },
                onSendToChat = { /* handled in chat via deep linking */ }
            )
        }

        // ---- File Viewer ----

        composable(
            route = Routes.FileViewer.ROUTE,
            arguments = listOf(
                navArgument(Routes.FileViewer.ARG_SESSION_ID) { type = NavType.StringType },
                navArgument(Routes.FileViewer.ARG_FILE_PATH) { type = NavType.StringType }
            )
        ) { backStackEntry ->
            // FileViewerScreen is driven by data from FileManagerScreen's ViewModel.
            // Navigation here preserves the back stack but defers rendering to FileManager's
            // internal dialog/overlay.  Simply pop back to FileManager.
            navController.popBackStack()
        }

        // ---- Analytics ----

        composable(route = Routes.Analytics.route) {
            AnalyticsScreen(onNavigateMain = { navController.navigateMain(it) })
        }

        // ---- Checkpoint Manager ----

        composable(
            route = Routes.CheckpointManager.ROUTE,
            arguments = listOf(
                navArgument(Routes.CheckpointManager.ARG_SESSION_ID) { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val sessionId =
                backStackEntry.arguments?.getString(Routes.CheckpointManager.ARG_SESSION_ID)
                    ?: return@composable
            val viewModel = koinViewModel<CheckpointViewModel>(
                parameters = { parametersOf(sessionId) }
            )
            val uiState by viewModel.uiState.collectAsState()
            CheckpointScreen(
                sessionId = sessionId,
                checkpoints = uiState.checkpoints,
                isLoading = uiState.isLoading,
                onNavigateBack = { navController.popBackStack() },
                onCreateCheckpoint = { name, description ->
                    viewModel.createCheckpoint(name, description)
                },
                onRestoreCheckpoint = { checkpoint -> viewModel.restoreCheckpoint(checkpoint) },
                onDeleteCheckpoint = { checkpoint -> viewModel.deleteCheckpoint(checkpoint) }
            )
        }

        // ---- Git Manager ----

        composable(
            route = Routes.GitManager.ROUTE,
            arguments = listOf(
                navArgument(Routes.GitManager.ARG_SESSION_ID) { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val sessionId = backStackEntry.arguments?.getString(Routes.GitManager.ARG_SESSION_ID)
                ?: return@composable
            val viewModel = koinViewModel<GitViewModel>(
                parameters = { parametersOf(sessionId) }
            )
            val uiState by viewModel.uiState.collectAsState()
            GitScreen(
                workingDirectory = uiState.workingDirectory,
                gitStatus = uiState.gitStatus,
                commits = uiState.commits,
                diffs = uiState.diffs,
                branches = uiState.branches,
                isLoading = uiState.isLoading,
                isCommitting = uiState.isCommitting,
                isPushing = uiState.isPushing,
                onNavigateBack = { navController.popBackStack() },
                onStageAll = { viewModel.stageAll() },
                onCommit = { message -> viewModel.commit(message) },
                onPush = { viewModel.push() },
                onSwitchBranch = { branch -> viewModel.switchBranch(branch) },
                onRefresh = { viewModel.refreshGitStatus() }
            )
        }

        // ---- Usage ----

        composable(
            route = Routes.Usage.ROUTE,
            arguments = listOf(
                navArgument(Routes.Usage.ARG_SESSION_ID) { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val sessionId = backStackEntry.arguments?.getString(Routes.Usage.ARG_SESSION_ID)
                ?: return@composable
            val viewModel = koinViewModel<UsageViewModel>(
                parameters = { parametersOf(sessionId) }
            )
            val uiState by viewModel.uiState.collectAsState()
            UsageScreen(
                sessionId = sessionId,
                usageData = uiState.usageData,
                usageHistory = uiState.usageHistory,
                isLoading = uiState.isLoading,
                onNavigateBack = { navController.popBackStack() },
                onRefresh = { viewModel.refreshUsage() }
            )
        }
    }
}

private fun NavHostController.navigateMain(destination: MainDestination) {
    val route = when (destination) {
        MainDestination.SESSIONS -> Routes.Dashboard.route
        MainDestination.ACTIVITY -> Routes.Activity.route
        MainDestination.ANALYTICS -> Routes.Analytics.route
        MainDestination.LIBRARY -> Routes.Library.route
        MainDestination.SETTINGS -> SETTINGS_GRAPH
    }
    navigate(route) {
        launchSingleTop = true
        restoreState = true
        popUpTo(Routes.Dashboard.route) { saveState = true }
    }
}
