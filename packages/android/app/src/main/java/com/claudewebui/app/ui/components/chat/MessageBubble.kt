package com.claudewebui.app.ui.components.chat

import androidx.compose.animation.*
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.claudewebui.app.data.model.Message
import com.claudewebui.app.data.model.MessageRole
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.theme.JetBrainsMonoFamily

// ── Message Group Metadata ────────────────────────────────────────────────────

data class MessageGroupInfo(
    val isFirst: Boolean = true,
    val isLast: Boolean = true,
)

// ── Main MessageBubble ────────────────────────────────────────────────────────

@Composable
fun MessageBubble(
    message: Message,
    groupInfo: MessageGroupInfo = MessageGroupInfo(),
    modifier: Modifier = Modifier,
    isStreaming: Boolean = false,
) {
    val clipboardManager = LocalClipboardManager.current
    var showTimestamp by remember { mutableStateOf(false) }
    var showActions by remember { mutableStateOf(false) }

    when (message.role) {
        MessageRole.USER -> UserBubble(
            message = message,
            groupInfo = groupInfo,
            modifier = modifier,
            onLongPress = { showActions = true },
            showTimestamp = showTimestamp,
            onTap = { showTimestamp = !showTimestamp },
        )
        MessageRole.ASSISTANT -> AssistantBubble(
            message = message,
            groupInfo = groupInfo,
            modifier = modifier,
            isStreaming = isStreaming,
            onLongPress = { showActions = true },
            showTimestamp = showTimestamp,
            onTap = { showTimestamp = !showTimestamp },
        )
        MessageRole.SYSTEM -> SystemMessage(
            message = message,
            modifier = modifier,
        )
    }

    // Context menu
    if (showActions) {
        MessageActionsDialog(
            message = message,
            onDismiss = { showActions = false },
            onCopy = {
                clipboardManager.setText(AnnotatedString(message.content))
                showActions = false
            },
        )
    }
}

// ── User Bubble ───────────────────────────────────────────────────────────────

@Composable
private fun UserBubble(
    message: Message,
    groupInfo: MessageGroupInfo,
    modifier: Modifier = Modifier,
    onLongPress: () -> Unit,
    showTimestamp: Boolean,
    onTap: () -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(
                start = 48.dp,
                end = 16.dp,
                top = if (groupInfo.isFirst) 8.dp else 2.dp,
                bottom = if (groupInfo.isLast) 8.dp else 2.dp,
            ),
        horizontalAlignment = Alignment.End,
    ) {
        // Image attachments
        message.images?.takeIf { it.isNotEmpty() }?.forEach { image ->
            AttachmentImage(
                path = image.path,
                modifier = Modifier
                    .widthIn(max = 240.dp)
                    .padding(bottom = 4.dp),
            )
        }

        // Text bubble
        Surface(
            shape = RoundedCornerShape(
                topStart = 16.dp,
                topEnd = if (groupInfo.isFirst) 4.dp else 16.dp,
                bottomEnd = if (groupInfo.isLast) 16.dp else 4.dp,
                bottomStart = 16.dp,
            ),
            color = Color(0xFF6F3CA5),
            modifier = Modifier
                .wrapContentWidth()
                .pointerInput(Unit) {
                    detectTapGestures(
                        onTap = { onTap() },
                        onLongPress = { onLongPress() },
                    )
                },
        ) {
            Text(
                text = message.content,
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            )
        }

        // Timestamp
        AnimatedVisibility(visible = showTimestamp) {
            Text(
                text = formatTimestamp(message.createdAt),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp, end = 4.dp),
                fontSize = 11.sp,
            )
        }
    }
}

// ── Assistant Bubble ──────────────────────────────────────────────────────────

@Composable
private fun AssistantBubble(
    message: Message,
    groupInfo: MessageGroupInfo,
    modifier: Modifier = Modifier,
    isStreaming: Boolean,
    onLongPress: () -> Unit,
    showTimestamp: Boolean,
    onTap: () -> Unit,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(
                start = 12.dp,
                end = 12.dp,
                top = if (groupInfo.isFirst) 8.dp else 2.dp,
                bottom = if (groupInfo.isLast) 8.dp else 2.dp,
            ),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // Avatar
        if (groupInfo.isFirst) {
            Surface(
                shape = CircleShape,
                color = PlumGreen.copy(alpha = .15f),
                modifier = Modifier.size(34.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = "✦",
                        fontSize = 14.sp,
                        color = PlumGreen,
                    )
                }
            }
        } else {
            Spacer(modifier = Modifier.width(34.dp))
        }

        Column(
            horizontalAlignment = Alignment.Start,
            modifier = Modifier.weight(1f),
        ) {
            // Bubble
            Surface(
                shape = RoundedCornerShape(
                    topStart = if (groupInfo.isFirst) 4.dp else 16.dp,
                    topEnd = 16.dp,
                    bottomEnd = 16.dp,
                    bottomStart = if (groupInfo.isLast) 16.dp else 4.dp,
                ),
                color = PlumSurfaceStrong,
                border = BorderStroke(1.dp, PlumBorder),
                modifier = Modifier
                    .wrapContentWidth()
                    .fillMaxWidth()
                    .pointerInput(Unit) {
                        detectTapGestures(
                            onTap = { onTap() },
                            onLongPress = { onLongPress() },
                        )
                    },
            ) {
                Column(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    MarkdownContent(
                        text = message.content,
                        isStreaming = isStreaming,
                    )

                    // Streaming cursor
                    if (isStreaming) {
                        StreamingCursor()
                    }
                }
            }

            // Timestamp
            AnimatedVisibility(visible = showTimestamp) {
                Text(
                    text = formatTimestamp(message.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp, start = 4.dp),
                    fontSize = 11.sp,
                )
            }
        }
    }
}

// ── System Message ────────────────────────────────────────────────────────────

@Composable
private fun SystemMessage(
    message: Message,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 32.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = message.content,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

// ── Streaming Cursor ──────────────────────────────────────────────────────────

@Composable
private fun StreamingCursor() {
    val infiniteTransition = rememberInfiniteTransition(label = "cursor")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(500, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "cursor_alpha",
    )
    Box(
        modifier = Modifier
            .size(width = 2.dp, height = 16.dp)
            .background(
                color = MaterialTheme.colorScheme.primary.copy(alpha = alpha),
                shape = RoundedCornerShape(1.dp),
            )
    )
}

// ── Attachment Image ──────────────────────────────────────────────────────────

@Composable
private fun AttachmentImage(
    path: String,
    modifier: Modifier = Modifier,
) {
    AsyncImage(
        model = path,
        contentDescription = "Attachment",
        contentScale = ContentScale.Crop,
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .aspectRatio(1f),
    )
}

// ── Message Actions Dialog ────────────────────────────────────────────────────

@Composable
private fun MessageActionsDialog(
    message: Message,
    onDismiss: () -> Unit,
    onCopy: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = null,
        text = null,
        confirmButton = {},
        dismissButton = {},
        modifier = Modifier.wrapContentSize(),
    ) // Simplified — in production use a ModalBottomSheet with action items
    // Placeholder; replace with bottom sheet containing: Copy, Share, Delete
    LaunchedEffect(Unit) {
        // Auto-dismiss for now; real implementation uses bottom sheet
        onDismiss()
    }
}

// ── Markdown Renderer ─────────────────────────────────────────────────────────

@Composable
fun MarkdownContent(
    text: String,
    modifier: Modifier = Modifier,
    isStreaming: Boolean = false,
) {
    val parsed = remember(text) { parseMarkdown(text) }

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        for (block in parsed) {
            when (block) {
                is MarkdownBlock.Paragraph -> {
                    Text(
                        text = block.annotated,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        lineHeight = 22.sp,
                    )
                }
                is MarkdownBlock.Heading -> {
                    Text(
                        text = block.annotated,
                        style = when (block.level) {
                            1 -> MaterialTheme.typography.titleLarge
                            2 -> MaterialTheme.typography.titleMedium
                            else -> MaterialTheme.typography.titleSmall
                        },
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.padding(top = 4.dp, bottom = 2.dp),
                    )
                }
                is MarkdownBlock.Code -> {
                    CodeBlock(
                        code = block.code,
                        language = block.language,
                    )
                }
                is MarkdownBlock.Blockquote -> {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 2.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .width(3.dp)
                                .fillMaxHeight()
                                .background(
                                    MaterialTheme.colorScheme.primary.copy(alpha = 0.5f),
                                    RoundedCornerShape(2.dp),
                                )
                        )
                        Text(
                            text = block.annotated,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontStyle = FontStyle.Italic,
                        )
                    }
                }
                is MarkdownBlock.ListItem -> {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(start = block.indent.dp),
                    ) {
                        Text(
                            text = if (block.ordered) "${block.number}." else "•",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.width(20.dp),
                        )
                        Text(
                            text = block.annotated,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
                is MarkdownBlock.HorizontalRule -> {
                    HorizontalDivider(
                        modifier = Modifier.padding(vertical = 4.dp),
                        color = MaterialTheme.colorScheme.outlineVariant,
                    )
                }
            }
        }
    }
}

// ── Markdown Parser ───────────────────────────────────────────────────────────

sealed class MarkdownBlock {
    data class Paragraph(val annotated: AnnotatedString) : MarkdownBlock()
    data class Heading(val level: Int, val annotated: AnnotatedString) : MarkdownBlock()
    data class Code(val code: String, val language: String) : MarkdownBlock()
    data class Blockquote(val annotated: AnnotatedString) : MarkdownBlock()
    data class ListItem(
        val annotated: AnnotatedString,
        val ordered: Boolean,
        val number: Int,
        val indent: Int,
    ) : MarkdownBlock()
    object HorizontalRule : MarkdownBlock()
}

fun parseMarkdown(text: String): List<MarkdownBlock> {
    val blocks = mutableListOf<MarkdownBlock>()
    val lines = text.lines()
    var i = 0
    var orderedCounter = 0

    while (i < lines.size) {
        val line = lines[i]
        val trimmed = line.trim()

        // Fenced code block ```
        if (trimmed.startsWith("```")) {
            val lang = trimmed.removePrefix("```").trim()
            val codeLines = mutableListOf<String>()
            i++
            while (i < lines.size && !lines[i].trim().startsWith("```")) {
                codeLines.add(lines[i])
                i++
            }
            blocks.add(MarkdownBlock.Code(codeLines.joinToString("\n"), lang))
            i++ // skip closing ```
            continue
        }

        // Heading
        val headingMatch = Regex("^(#{1,6})\\s+(.+)$").matchEntire(trimmed)
        if (headingMatch != null) {
            val level = headingMatch.groupValues[1].length
            val content = headingMatch.groupValues[2]
            blocks.add(MarkdownBlock.Heading(level, parseInline(content)))
            i++
            continue
        }

        // Horizontal rule
        if (trimmed.matches(Regex("[-*_]{3,}"))) {
            blocks.add(MarkdownBlock.HorizontalRule)
            i++
            continue
        }

        // Blockquote
        if (trimmed.startsWith("> ")) {
            val content = trimmed.removePrefix("> ")
            blocks.add(MarkdownBlock.Blockquote(parseInline(content)))
            i++
            continue
        }

        // Ordered list item
        val orderedMatch = Regex("^(\\s*)(\\d+)\\.\\s+(.+)$").matchEntire(line)
        if (orderedMatch != null) {
            val indent = orderedMatch.groupValues[1].length * 4
            val num = orderedMatch.groupValues[2].toIntOrNull() ?: 1
            val content = orderedMatch.groupValues[3]
            blocks.add(MarkdownBlock.ListItem(parseInline(content), ordered = true, number = num, indent = indent))
            i++
            continue
        }

        // Unordered list item
        val unorderedMatch = Regex("^(\\s*)[-*+]\\s+(.+)$").matchEntire(line)
        if (unorderedMatch != null) {
            val indent = unorderedMatch.groupValues[1].length * 4
            val content = unorderedMatch.groupValues[2]
            blocks.add(MarkdownBlock.ListItem(parseInline(content), ordered = false, number = 0, indent = indent))
            i++
            continue
        }

        // Blank line
        if (trimmed.isEmpty()) {
            i++
            continue
        }

        // Paragraph — accumulate consecutive non-special lines
        val paragraphLines = mutableListOf<String>()
        while (i < lines.size) {
            val l = lines[i].trim()
            if (l.isEmpty() || l.startsWith("#") || l.startsWith("```") ||
                l.startsWith("> ") || l.matches(Regex("[-*_]{3,}")) ||
                Regex("^\\s*[-*+]\\s+.+").matches(lines[i]) ||
                Regex("^\\s*\\d+\\.\\s+.+").matches(lines[i])) break
            paragraphLines.add(lines[i])
            i++
        }
        if (paragraphLines.isNotEmpty()) {
            blocks.add(MarkdownBlock.Paragraph(parseInline(paragraphLines.joinToString(" "))))
        }
    }

    return blocks
}

// ── Inline Markdown Parser ────────────────────────────────────────────────────

fun parseInline(text: String): AnnotatedString = buildAnnotatedString {
    var i = 0
    val len = text.length

    while (i < len) {
        // Bold **text** or __text__
        if (i + 1 < len && ((text[i] == '*' && text[i + 1] == '*') || (text[i] == '_' && text[i + 1] == '_'))) {
            val marker = text.substring(i, i + 2)
            val end = text.indexOf(marker, i + 2)
            if (end > i + 2) {
                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                    append(text.substring(i + 2, end))
                }
                i = end + 2
                continue
            }
        }

        // Italic *text* or _text_
        if ((text[i] == '*' || text[i] == '_') && (i == 0 || text[i - 1] != text[i])) {
            val marker = text[i]
            val end = text.indexOf(marker, i + 1)
            if (end > i + 1) {
                withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                    append(text.substring(i + 1, end))
                }
                i = end + 1
                continue
            }
        }

        // Inline code `code`
        if (text[i] == '`') {
            val end = text.indexOf('`', i + 1)
            if (end > i + 1) {
                withStyle(
                    SpanStyle(
                        fontFamily = JetBrainsMonoFamily,
                        fontSize = 13.sp,
                        background = Color(0xFF2D2D2B),
                        color = Color(0xFFCE9178),
                    )
                ) {
                    append(text.substring(i + 1, end))
                }
                i = end + 1
                continue
            }
        }

        // Link [text](url)
        if (text[i] == '[') {
            val closeBracket = text.indexOf(']', i + 1)
            if (closeBracket > i && closeBracket + 1 < len && text[closeBracket + 1] == '(') {
                val closeParen = text.indexOf(')', closeBracket + 2)
                if (closeParen > closeBracket + 2) {
                    val linkText = text.substring(i + 1, closeBracket)
                    withStyle(
                        SpanStyle(
                            color = Color(0xFF3B82F6),
                            textDecoration = TextDecoration.Underline,
                        )
                    ) {
                        append(linkText)
                    }
                    i = closeParen + 1
                    continue
                }
            }
        }

        // Strikethrough ~~text~~
        if (i + 1 < len && text[i] == '~' && text[i + 1] == '~') {
            val end = text.indexOf("~~", i + 2)
            if (end > i + 2) {
                withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) {
                    append(text.substring(i + 2, end))
                }
                i = end + 2
                continue
            }
        }

        append(text[i])
        i++
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

private fun formatTimestamp(createdAt: String): String {
    return try {
        // Simplified — in production parse ISO 8601 with DateTimeFormatter
        createdAt.take(16).replace("T", " ")
    } catch (_: Exception) {
        createdAt
    }
}
