package com.claudewebui.app.di

import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.core.network.SocketManager
import org.koin.dsl.module

val networkModule = module {

    /**
     * Single HTTP client instance shared across all repositories.
     * ApiClient reads the server URL from TokenStore internally.
     */
    single { ApiClient() }

    /**
     * Single WebSocket manager for real-time session streaming.
     * SocketManager reads the server URL from TokenStore internally.
     */
    single { SocketManager() }
}
