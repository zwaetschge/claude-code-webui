package com.claudewebui.app

import android.app.Application
import com.claudewebui.app.core.security.TokenStore
import com.claudewebui.app.di.appModule
import com.claudewebui.app.di.databaseModule
import com.claudewebui.app.di.networkModule
import com.claudewebui.app.di.viewModelModule
import org.koin.android.ext.koin.androidContext
import org.koin.android.ext.koin.androidLogger
import org.koin.core.context.startKoin
import org.koin.core.logger.Level

class ClaudeWebUIApp : Application() {
    override fun onCreate() {
        super.onCreate()

        // Initialize secure token storage before anything else
        TokenStore.init(this)

        startKoin {
            androidLogger(Level.ERROR)
            androidContext(this@ClaudeWebUIApp)
            modules(appModule, networkModule, databaseModule, viewModelModule)
        }
    }
}
