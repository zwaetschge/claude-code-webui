package com.claudewebui.app.ui.components.common

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

private val OfflineBannerBackground = Color(0xFFB71C1C)
private val OfflineBannerText = Color.White

/**
 * An animated banner that slides in from the top when the app is offline.
 * Auto-dismisses when [isOffline] returns to false.
 *
 * @param isOffline whether the app currently has no server connection
 * @param onRetry called when the user taps "Retry"
 * @param pendingCount number of queued messages; shown in the label if > 0
 */
@Composable
fun ConnectivityBanner(
    isOffline: Boolean,
    onRetry: () -> Unit,
    pendingCount: Int = 0,
    modifier: Modifier = Modifier
) {
    AnimatedVisibility(
        visible = isOffline,
        enter = expandVertically(
            animationSpec = tween(durationMillis = 280),
            expandFrom = androidx.compose.ui.Alignment.Top
        ),
        exit = shrinkVertically(
            animationSpec = tween(durationMillis = 250),
            shrinkTowards = androidx.compose.ui.Alignment.Top
        ),
        modifier = modifier
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(OfflineBannerBackground)
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.CloudOff,
                    contentDescription = null,
                    tint = OfflineBannerText,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = if (pendingCount > 0) {
                        "No connection · $pendingCount message(s) queued"
                    } else {
                        "No connection"
                    },
                    color = OfflineBannerText,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium
                )
            }
            TextButton(onClick = onRetry) {
                Icon(
                    imageVector = Icons.Default.Refresh,
                    contentDescription = "Retry",
                    tint = OfflineBannerText,
                    modifier = Modifier.size(16.dp)
                )
                Spacer(Modifier.width(4.dp))
                Text(
                    "Retry",
                    color = OfflineBannerText,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }
    }
}
