package com.claudewebui.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import com.claudewebui.app.navigation.AppNavigation
import com.claudewebui.app.ui.theme.AppThemeStore
import com.claudewebui.app.ui.theme.ClaudeWebUITheme
import com.claudewebui.app.ui.theme.LocalPlumPalette
import com.claudewebui.app.ui.theme.paletteFor

class MainActivity : ComponentActivity() {

    private var incomingDeepLink by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        // Enable edge-to-edge display before setContent
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        AppThemeStore.initialize(this)
        incomingDeepLink = intent?.data?.toString()

        setContent {
            // The stored preference decides the palette; SYSTEM defers to the
            // device setting. Reading the flow here means a change in Settings
            // repaints the whole app, including the system bars.
            val themeOption by AppThemeStore.theme.collectAsState()
            val systemInDark = isSystemInDarkTheme()
            val palette = paletteFor(themeOption, systemInDark)
            val darkTheme = !palette.isLight

            // Update system bar styles to match the current theme
            DisposableEffect(darkTheme) {
                enableEdgeToEdge(
                    statusBarStyle = if (darkTheme) {
                        SystemBarStyle.dark(Color.Transparent.toArgb())
                    } else {
                        SystemBarStyle.light(
                            Color.Transparent.toArgb(),
                            Color.Black.toArgb()
                        )
                    },
                    navigationBarStyle = if (darkTheme) {
                        SystemBarStyle.dark(Color.Transparent.toArgb())
                    } else {
                        SystemBarStyle.light(
                            Color.Transparent.toArgb(),
                            Color.Black.toArgb()
                        )
                    }
                )
                onDispose {}
            }

            CompositionLocalProvider(LocalPlumPalette provides palette) {
                ClaudeWebUITheme(darkTheme = darkTheme) {
                    Surface(
                        modifier = Modifier.fillMaxSize(),
                        color = palette.background
                    ) {
                        // Pass deep link intent to the navigation host
                        AppNavigation(
                            deepLinkUri = incomingDeepLink
                        )
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        incomingDeepLink = intent.data?.toString()
    }
}
