package com.claudewebui.app.ui.components.chat

import android.util.Base64
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.claudewebui.app.data.model.FileAttachmentData

@Composable
fun ChatInput(
    text: String,
    onTextChange: (String) -> Unit,
    onSend: (String) -> Unit,
    onAttachFile: (() -> Unit)? = null,
    isWorking: Boolean = false,
    onInterrupt: (() -> Unit)? = null,
    attachments: List<FileAttachmentData> = emptyList(),
    onRemoveAttachment: ((Int) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val haptic = LocalHapticFeedback.current
    val keyboardController = LocalSoftwareKeyboardController.current

    val canSend = (text.isNotBlank() || attachments.isNotEmpty()) && !isWorking
    val charCount = text.length
    val showCharCount = charCount > 800

    Surface(
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 3.dp,
    ) {
        Column {
            // Pending attachments
            AnimatedVisibility(
                visible = attachments.isNotEmpty(),
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut(),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    attachments.forEachIndexed { index, attachment ->
                        AttachmentChip(
                            attachment = attachment,
                            onRemove = { onRemoveAttachment?.invoke(index) },
                        )
                    }
                }
            }

            // Character count warning
            AnimatedVisibility(
                visible = showCharCount,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut(),
            ) {
                Text(
                    text = "$charCount characters",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (charCount > 2000)
                        MaterialTheme.colorScheme.error
                    else
                        MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 16.dp, top = 6.dp),
                    fontSize = 11.sp,
                )
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                // Attachment button
                if (onAttachFile != null) {
                    IconButton(
                        onClick = onAttachFile,
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape),
                        enabled = !isWorking,
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.AttachFile,
                            contentDescription = "Attach file",
                            tint = if (!isWorking)
                                MaterialTheme.colorScheme.onSurfaceVariant
                            else
                                MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.38f),
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }

                // Text field
                OutlinedTextField(
                    value = text,
                    onValueChange = onTextChange,
                    placeholder = {
                        Text(
                            text = if (isWorking) "Agent is working…" else "Message agent…",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                        )
                    },
                    modifier = Modifier
                        .weight(1f)
                        .heightIn(min = 48.dp, max = 160.dp), // ~6 lines
                    shape = RoundedCornerShape(24.dp),
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Sentences,
                        keyboardType = KeyboardType.Text,
                        imeAction = ImeAction.Default, // Allow multiline
                    ),
                    keyboardActions = KeyboardActions.Default,
                    maxLines = 6,
                    textStyle = MaterialTheme.typography.bodyMedium,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.5f),
                        unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f),
                        focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                    ),
                    enabled = !isWorking,
                )

                // Send / Interrupt button
                val buttonScale by animateFloatAsState(
                    targetValue = if (canSend || isWorking) 1f else 0.85f,
                    animationSpec = spring(stiffness = Spring.StiffnessMedium),
                    label = "send_scale",
                )

                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .graphicsLayer { scaleX = buttonScale; scaleY = buttonScale }
                        .clip(CircleShape)
                        .background(
                            color = when {
                                isWorking -> MaterialTheme.colorScheme.error
                                canSend -> MaterialTheme.colorScheme.primary
                                else -> MaterialTheme.colorScheme.surfaceContainerHighest
                            }
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    IconButton(
                        onClick = {
                            if (isWorking) {
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                onInterrupt?.invoke()
                            } else if (canSend) {
                                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                onSend(text)
                                keyboardController?.hide()
                            }
                        },
                        modifier = Modifier.fillMaxSize(),
                        enabled = canSend || isWorking,
                    ) {
                        AnimatedContent(
                            targetState = isWorking,
                            transitionSpec = {
                                scaleIn(animationSpec = tween(150)) togetherWith
                                        scaleOut(animationSpec = tween(150))
                            },
                            label = "send_icon",
                        ) { working ->
                            Icon(
                                imageVector = if (working) Icons.Outlined.Stop else Icons.Filled.Send,
                                contentDescription = if (working) "Stop" else "Send",
                                tint = when {
                                    working -> MaterialTheme.colorScheme.onError
                                    canSend -> MaterialTheme.colorScheme.onPrimary
                                    else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.38f)
                                },
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AttachmentChip(
    attachment: FileAttachmentData,
    onRemove: () -> Unit,
) {
    val isImage = attachment.mimeType.startsWith("image/")
    val fallbackIcon = when {
        attachment.mimeType == "application/pdf" -> Icons.Outlined.PictureAsPdf
        attachment.mimeType.startsWith("text/") ||
            attachment.mimeType in TEXT_MIME_TYPES -> Icons.Outlined.Description
        else -> Icons.Outlined.InsertDriveFile
    }
    val imageBytes = remember(attachment.data, isImage) {
        if (isImage) runCatching { Base64.decode(attachment.data, Base64.NO_WRAP) }.getOrNull() else null
    }

    Surface(
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        tonalElevation = 1.dp,
    ) {
        Row(
            modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(28.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainerLow),
                contentAlignment = Alignment.Center,
            ) {
                if (imageBytes != null) {
                    AsyncImage(
                        model = imageBytes,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                } else {
                    Icon(
                        imageVector = if (isImage) Icons.Outlined.Image else fallbackIcon,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
            Text(
                text = attachment.filename ?: "attachment",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 140.dp),
            )
            IconButton(
                onClick = onRemove,
                modifier = Modifier.size(24.dp),
            ) {
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = "Remove attachment",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(14.dp),
                )
            }
        }
    }
}

private val TEXT_MIME_TYPES = setOf(
    "application/json",
    "application/xml",
    "application/javascript",
    "application/typescript",
    "application/x-yaml",
    "application/yaml",
    "application/x-sh",
)
