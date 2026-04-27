package com.claudewebui.app.ui.components.ralph

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.RalphPlan
import com.claudewebui.app.data.model.RalphTask
import com.claudewebui.app.data.model.RalphTaskStatus
import com.claudewebui.app.ui.theme.SuccessGreen

@Composable
fun RalphPlanView(
    plan: RalphPlan,
    currentTaskIndex: Int,
    selectedTaskId: String?,
    onTaskTap: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        // Plan header
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.padding(bottom = 4.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.AccountTree,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp),
            )
            Text(
                text = plan.title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.weight(1f))
            // Progress badge
            val completed = plan.tasks.count { it.status == RalphTaskStatus.COMPLETED }
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = SuccessGreen.copy(alpha = 0.12f),
            ) {
                Text(
                    text = "$completed / ${plan.tasks.size}",
                    style = MaterialTheme.typography.labelSmall,
                    color = SuccessGreen,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                )
            }
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
        Spacer(Modifier.height(4.dp))

        // Task list
        plan.tasks.forEachIndexed { index, task ->
            val isActive = index == currentTaskIndex
            val isSelected = task.id == selectedTaskId

            TaskRow(
                task = task,
                index = index,
                isActive = isActive,
                isSelected = isSelected,
                onTap = { onTaskTap(task.id) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun TaskRow(
    task: RalphTask,
    index: Int,
    isActive: Boolean,
    isSelected: Boolean,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val infiniteTransition = rememberInfiniteTransition(label = "taskPulse_${task.id}")
    val pulsedAlpha by infiniteTransition.animateFloat(
        initialValue = 0.4f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "taskAlpha",
    )

    val primaryColor = MaterialTheme.colorScheme.primary
    val borderColor = when {
        isActive -> primaryColor.copy(alpha = pulsedAlpha)
        isSelected -> primaryColor.copy(alpha = 0.5f)
        else -> Color.Transparent
    }

    val bgColor = when {
        isActive -> MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
        isSelected -> MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.2f)
        else -> Color.Transparent
    }

    Row(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(bgColor)
            .border(
                width = if (isActive || isSelected) 1.5.dp else 0.dp,
                color = borderColor,
                shape = RoundedCornerShape(10.dp),
            )
            .clickable(onClick = onTap)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Index / status icon
        Box(
            modifier = Modifier.size(28.dp),
            contentAlignment = Alignment.Center,
        ) {
            TaskStatusIcon(
                status = task.status,
                index = index,
                isActive = isActive,
            )
        }

        // Task details
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = task.title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (isActive) FontWeight.SemiBold else FontWeight.Normal,
                color = when (task.status) {
                    RalphTaskStatus.COMPLETED -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                    RalphTaskStatus.FAILED -> MaterialTheme.colorScheme.error
                    RalphTaskStatus.SKIPPED -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                    else -> MaterialTheme.colorScheme.onSurface
                },
                textDecoration = when (task.status) {
                    RalphTaskStatus.COMPLETED -> TextDecoration.LineThrough
                    RalphTaskStatus.SKIPPED -> TextDecoration.LineThrough
                    else -> TextDecoration.None
                },
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )

            if (isActive) {
                Text(
                    text = "In progress…",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                    fontSize = 11.sp,
                )
            } else if (task.status == RalphTaskStatus.FAILED && task.lastError != null) {
                Text(
                    text = task.lastError.take(60),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error.copy(alpha = 0.8f),
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        // Attempts badge (if retried)
        if (task.attempts > 1) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.tertiaryContainer,
            ) {
                Text(
                    text = "×${task.attempts}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                    fontSize = 10.sp,
                )
            }
        }
    }
}

@Composable
private fun TaskStatusIcon(
    status: RalphTaskStatus,
    index: Int,
    isActive: Boolean,
    modifier: Modifier = Modifier,
) {
    val infiniteTransition = rememberInfiniteTransition(label = "spin")
    val rotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(1200, easing = LinearEasing),
        ),
        label = "rotation",
    )

    when {
        isActive -> {
            CircularProgressIndicator(
                modifier = modifier
                    .size(22.dp)
                    .scale(1f),
                strokeWidth = 2.5.dp,
                color = MaterialTheme.colorScheme.primary,
            )
        }

        status == RalphTaskStatus.COMPLETED -> {
            Icon(
                imageVector = Icons.Filled.CheckCircle,
                contentDescription = "Completed",
                tint = SuccessGreen,
                modifier = modifier.size(22.dp),
            )
        }

        status == RalphTaskStatus.FAILED -> {
            Icon(
                imageVector = Icons.Filled.Cancel,
                contentDescription = "Failed",
                tint = MaterialTheme.colorScheme.error,
                modifier = modifier.size(22.dp),
            )
        }

        status == RalphTaskStatus.SKIPPED -> {
            Icon(
                imageVector = Icons.Filled.SkipNext,
                contentDescription = "Skipped",
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                modifier = modifier.size(22.dp),
            )
        }

        else -> {
            // Pending — show index number in circle
            Box(
                modifier = modifier
                    .size(22.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.outline.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "${index + 1}",
                    style = MaterialTheme.typography.labelSmall,
                    fontSize = 10.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}
