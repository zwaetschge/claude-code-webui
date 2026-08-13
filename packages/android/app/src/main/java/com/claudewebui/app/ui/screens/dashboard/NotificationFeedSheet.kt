package com.claudewebui.app.ui.screens.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.AppNotification
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumAmber
import com.claudewebui.app.ui.components.common.PlumBorderSoft
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumText

/**
 * Durable feed of what happened while the app was closed. Approvals are
 * answerable in place: the agent is blocked while it waits, so making the user
 * open the session first costs time exactly when it matters.
 */
@Composable
fun NotificationFeedContent(
    notifications: List<AppNotification>,
    unreadCount: Int,
    onOpenSession: (String) -> Unit,
    onMarkAllRead: () -> Unit,
    onClearAll: () -> Unit,
    onRespond: (AppNotification, Boolean) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Notifications", color = PlumText, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            if (unreadCount > 0) {
                Spacer(Modifier.size(8.dp))
                Box(
                    Modifier
                        .clip(RoundedCornerShape(9.dp))
                        .background(PlumAccent.copy(alpha = .18f))
                        .padding(horizontal = 8.dp, vertical = 2.dp),
                ) {
                    Text("$unreadCount new", color = PlumAccent, fontSize = 11.sp)
                }
            }
            Spacer(Modifier.weight(1f))
            SheetAction("Mark read", onMarkAllRead)
            Spacer(Modifier.size(10.dp))
            SheetAction("Clear", onClearAll)
        }

        if (notifications.isEmpty()) {
            Text(
                "Nothing yet. Replies, approvals and budget alerts land here.",
                color = PlumMuted,
                fontSize = 13.sp,
            )
            return@Column
        }

        LazyColumn(
            modifier = Modifier.fillMaxWidth().heightIn(max = 460.dp),
            contentPadding = PaddingValues(bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(notifications, key = { it.id }) { item ->
                NotificationRow(item, onOpenSession, onRespond)
            }
        }
    }
}

@Composable
private fun NotificationRow(
    item: AppNotification,
    onOpenSession: (String) -> Unit,
    onRespond: (AppNotification, Boolean) -> Unit,
) {
    val unread = item.readAt == null
    val accent = when (item.kind) {
        "approval", "question", "usage_alert" -> PlumAmber
        "error" -> PlumRed
        "goal" -> PlumGreen
        else -> PlumText
    }
    val canAnswer = item.kind == "approval" &&
        unread &&
        item.data?.requestId != null &&
        item.sessionId != null

    GlassPanel(Modifier.fillMaxWidth(), radius = 15.dp) {
        Column(
            Modifier
                .fillMaxWidth()
                .clickable(enabled = item.sessionId != null) {
                    item.sessionId?.let(onOpenSession)
                }
                .padding(13.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (unread) {
                    Box(Modifier.size(6.dp).clip(CircleShape).background(accent))
                    Spacer(Modifier.size(7.dp))
                }
                Text(
                    item.title,
                    color = accent,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(relativeTime(item.createdAt), color = PlumMuted, fontSize = 10.sp)
            }
            item.body?.takeIf { it.isNotBlank() }?.let {
                Text(
                    it,
                    color = PlumMuted,
                    fontSize = 12.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (canAnswer) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AnswerButton("Allow", PlumGreen, Modifier.weight(1f)) { onRespond(item, true) }
                    AnswerButton("Deny", PlumRed, Modifier.weight(1f)) { onRespond(item, false) }
                }
            }
        }
    }
}

@Composable
private fun AnswerButton(
    label: String,
    tint: Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(9.dp))
            .background(tint.copy(alpha = .14f))
            .border(1.dp, tint.copy(alpha = .35f), RoundedCornerShape(9.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 7.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = tint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun SheetAction(label: String, onClick: () -> Unit) {
    Text(
        label,
        color = PlumAccent,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.clickable(onClick = onClick),
    )
}

/** Bell with an unread badge. */
@Composable
fun NotificationBell(unreadCount: Int, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(modifier = modifier.size(48.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(48.dp)
                .clip(CircleShape)
                .border(1.dp, PlumBorderSoft, CircleShape)
                .clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Outlined.Notifications,
                contentDescription = if (unreadCount > 0) {
                    "Notifications, $unreadCount unread"
                } else "Notifications",
                tint = if (unreadCount > 0) PlumAccent else PlumText,
                modifier = Modifier.size(22.dp),
            )
        }
        if (unreadCount > 0) {
            // Sits on the ring, not across the icon: a badge wide enough for
            // "99+" centred on the corner covered the bell it was annotating.
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = 2.dp, y = (-2).dp)
                    .clip(CircleShape)
                    .background(PlumRed)
                    .padding(horizontal = 4.dp, vertical = 1.dp),
            ) {
                Text(
                    if (unreadCount > 9) "9+" else "$unreadCount",
                    color = Color.White,
                    fontSize = 8.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

/** "5m ago" beats an absolute timestamp in a feed this dense. */
private fun relativeTime(iso: String): String {
    val millis = runCatching {
        java.time.Instant.parse(if (iso.endsWith("Z")) iso else "${iso.replace(' ', 'T')}Z")
            .toEpochMilli()
    }.getOrNull() ?: return ""
    val minutes = ((System.currentTimeMillis() - millis) / 60_000L).toInt()
    return when {
        minutes < 1 -> "now"
        minutes < 60 -> "${minutes}m"
        minutes < 1440 -> "${minutes / 60}h"
        else -> "${minutes / 1440}d"
    }
}
