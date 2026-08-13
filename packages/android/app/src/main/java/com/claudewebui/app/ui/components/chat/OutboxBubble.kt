package com.claudewebui.app.ui.components.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.local.entity.OutboxEntity
import com.claudewebui.app.data.local.entity.OutboxStatus
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumMuted

@Composable
fun OutboxBubble(
    item: OutboxEntity,
    onRetry: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val status = item.deliveryStatus
    val statusLabel = when (status) {
        OutboxStatus.SENDING -> if (item.attachments.isNotEmpty()) {
            "Uploading ${(item.progress.coerceIn(0f, 1f) * 100).toInt()} percent"
        } else "Waiting for server confirmation"
        OutboxStatus.ACCEPTED -> when (item.disposition) {
            "queued" -> "Queued"
            else -> "Accepted"
        }
        OutboxStatus.FAILED -> item.error ?: "Delivery failed"
    }
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 3.dp),
        contentAlignment = Alignment.CenterEnd,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 520.dp)
                .background(PlumAccent.copy(alpha = .14f), RoundedCornerShape(18.dp))
                .padding(horizontal = 14.dp, vertical = 10.dp)
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = "Outgoing message. $statusLabel"
                },
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (item.content.isNotBlank()) {
                Text(item.content, style = MaterialTheme.typography.bodyMedium)
            }
            item.attachments.forEach { attachment ->
                Text(
                    text = "Attachment: ${attachment.filename}",
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = PlumMuted,
                )
            }
            if (status == OutboxStatus.SENDING && item.attachments.isNotEmpty()) {
                LinearProgressIndicator(
                    progress = { item.progress.coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(
                    imageVector = when (status) {
                        OutboxStatus.SENDING -> Icons.Outlined.CloudUpload
                        OutboxStatus.ACCEPTED -> Icons.Outlined.CheckCircle
                        OutboxStatus.FAILED -> Icons.Outlined.ErrorOutline
                    },
                    contentDescription = null,
                    tint = if (status == OutboxStatus.FAILED) {
                        MaterialTheme.colorScheme.error
                    } else PlumMuted,
                )
                Text(
                    text = statusLabel,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Medium,
                    color = if (status == OutboxStatus.FAILED) {
                        MaterialTheme.colorScheme.error
                    } else PlumMuted,
                    fontSize = 11.sp,
                    modifier = Modifier.weight(1f),
                )
                when {
                    status == OutboxStatus.FAILED && item.retryable -> TextButton(onClick = onRetry) {
                        Icon(Icons.Outlined.Refresh, contentDescription = null)
                        Text("Retry")
                    }
                    status == OutboxStatus.SENDING -> TextButton(onClick = onCancel) {
                        Text("Cancel")
                    }
                }
            }
        }
    }
}
