package com.claudewebui.app.ui.screens.filemanager

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.claudewebui.app.data.model.FileInfo
import com.claudewebui.app.data.model.FileType

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileViewerScreen(
    file: FileInfo,
    fileContent: String?,
    isLoading: Boolean,
    onNavigateBack: () -> Unit,
    onSendToChat: (String) -> Unit = {},
    onShare: (String) -> Unit = {}
) {
    val isImage = isImageFile(file.extension)

    var searchVisible by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var currentMatchIndex by remember { mutableStateOf(0) }

    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        Column {
                            Text(
                                text = file.name,
                                style = MaterialTheme.typography.titleMedium,
                                maxLines = 1
                            )
                            Text(
                                text = detectLanguage(file.extension),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = onNavigateBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                        }
                    },
                    actions = {
                        if (!isImage) {
                            IconButton(onClick = { searchVisible = !searchVisible }) {
                                Icon(Icons.Default.Search, contentDescription = "Search")
                            }
                        }
                        IconButton(onClick = { onSendToChat(file.path) }) {
                            Icon(Icons.Default.Chat, contentDescription = "Open in chat")
                        }
                        IconButton(onClick = { fileContent?.let { onShare(it) } }) {
                            Icon(Icons.Default.Share, contentDescription = "Share")
                        }
                    }
                )
                // Search bar
                if (searchVisible && !isImage) {
                    FileSearchBar(
                        query = searchQuery,
                        onQueryChange = {
                            searchQuery = it
                            currentMatchIndex = 0
                        },
                        onClose = {
                            searchVisible = false
                            searchQuery = ""
                        },
                        matchCount = if (searchQuery.isBlank() || fileContent == null) 0
                            else countMatches(fileContent, searchQuery),
                        currentMatch = currentMatchIndex + 1,
                        onPrevious = { if (currentMatchIndex > 0) currentMatchIndex-- },
                        onNext = {
                            val count = if (fileContent != null) countMatches(fileContent, searchQuery) else 0
                            if (currentMatchIndex < count - 1) currentMatchIndex++
                        }
                    )
                }
            }
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when {
                isLoading -> {
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                }
                isImage -> {
                    ImageViewer(
                        imagePath = file.path,
                        modifier = Modifier.fillMaxSize()
                    )
                }
                fileContent != null -> {
                    CodeViewer(
                        content = fileContent,
                        extension = file.extension,
                        searchQuery = searchQuery.takeIf { it.isNotBlank() },
                        modifier = Modifier.fillMaxSize()
                    )
                }
                else -> {
                    Text(
                        "Could not load file content",
                        modifier = Modifier.align(Alignment.Center),
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun FileSearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    onClose: () -> Unit,
    matchCount: Int,
    currentMatch: Int,
    onPrevious: () -> Unit,
    onNext: () -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        tonalElevation = 4.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = onQueryChange,
                placeholder = { Text("Find in file...", style = MaterialTheme.typography.bodySmall) },
                singleLine = true,
                modifier = Modifier.weight(1f),
                textStyle = MaterialTheme.typography.bodySmall,
                shape = RoundedCornerShape(20.dp)
            )
            if (query.isNotBlank()) {
                Text(
                    text = if (matchCount == 0) "No matches" else "$currentMatch/$matchCount",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                IconButton(onClick = onPrevious, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.Default.KeyboardArrowUp, contentDescription = "Previous", modifier = Modifier.size(18.dp))
                }
                IconButton(onClick = onNext, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.Default.KeyboardArrowDown, contentDescription = "Next", modifier = Modifier.size(18.dp))
                }
            }
            IconButton(onClick = onClose, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Default.Close, contentDescription = "Close search", modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
private fun CodeViewer(
    content: String,
    extension: String?,
    searchQuery: String?,
    modifier: Modifier = Modifier
) {
    val lines = remember(content) { content.lines() }
    val lineNumberWidth = remember(lines.size) {
        lines.size.toString().length.coerceAtLeast(3)
    }

    Box(
        modifier = modifier
            .background(Color(0xFF1E1E2E))
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .horizontalScroll(rememberScrollState()),
            contentPadding = PaddingValues(vertical = 8.dp)
        ) {
            itemsIndexed(lines) { index, line ->
                Row(
                    modifier = Modifier.padding(vertical = 1.dp)
                ) {
                    // Line number
                    Text(
                        text = (index + 1).toString().padStart(lineNumberWidth),
                        style = MaterialTheme.typography.bodySmall.copy(
                            fontFamily = FontFamily.Monospace,
                            fontSize = 13.sp
                        ),
                        color = Color(0xFF6C7086),
                        modifier = Modifier
                            .background(Color(0xFF181825))
                            .padding(horizontal = 8.dp, vertical = 0.dp)
                            .widthIn(min = (lineNumberWidth * 10 + 16).dp)
                    )
                    Spacer(Modifier.width(8.dp))
                    // Code content with syntax highlight
                    Text(
                        text = buildHighlightedLine(line, extension, searchQuery),
                        style = MaterialTheme.typography.bodySmall.copy(
                            fontFamily = FontFamily.Monospace,
                            fontSize = 13.sp
                        ),
                        modifier = Modifier.padding(end = 24.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun ImageViewer(
    imagePath: String,
    modifier: Modifier = Modifier
) {
    var scale by remember { mutableStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    val context = LocalContext.current

    Box(
        modifier = modifier
            .background(Color.Black)
            .pointerInput(Unit) {
                detectTransformGestures { _, pan, zoom, _ ->
                    scale = (scale * zoom).coerceIn(0.5f, 5f)
                    offset = Offset(
                        x = (offset.x + pan.x).coerceIn(-500f, 500f),
                        y = (offset.y + pan.y).coerceIn(-500f, 500f)
                    )
                }
            },
        contentAlignment = Alignment.Center
    ) {
        AsyncImage(
            model = ImageRequest.Builder(context)
                .data(imagePath)
                .crossfade(true)
                .build(),
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer(
                    scaleX = scale,
                    scaleY = scale,
                    translationX = offset.x,
                    translationY = offset.y
                )
        )
        // Zoom hint
        if (scale == 1f) {
            Text(
                "Pinch to zoom",
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(16.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color.Black.copy(alpha = 0.5f))
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                style = MaterialTheme.typography.labelSmall,
                color = Color.White.copy(alpha = 0.8f)
            )
        }
    }
}

// ============================================================
// Syntax Highlighting (regex-based)
// ============================================================

private data class SyntaxToken(
    val regex: Regex,
    val color: Color
)

private val KEYWORDS_KOTLIN = setOf(
    "fun", "val", "var", "class", "object", "interface", "data", "enum", "sealed",
    "open", "abstract", "override", "private", "protected", "public", "internal",
    "companion", "import", "package", "return", "if", "else", "when", "for", "while",
    "do", "break", "continue", "null", "true", "false", "in", "is", "as", "by",
    "suspend", "coroutine", "launch", "async", "yield", "init", "constructor"
)

private val KEYWORDS_JS = setOf(
    "const", "let", "var", "function", "class", "return", "if", "else", "for",
    "while", "do", "break", "continue", "null", "undefined", "true", "false",
    "import", "export", "from", "default", "async", "await", "new", "this",
    "typeof", "instanceof", "throw", "try", "catch", "finally", "switch", "case"
)

private val KEYWORDS_PYTHON = setOf(
    "def", "class", "return", "if", "elif", "else", "for", "while", "break",
    "continue", "pass", "import", "from", "as", "True", "False", "None",
    "and", "or", "not", "in", "is", "lambda", "with", "yield", "async", "await",
    "try", "except", "finally", "raise"
)

private fun getKeywordsForExtension(ext: String?): Set<String> = when (ext?.lowercase()) {
    "kt", "kts" -> KEYWORDS_KOTLIN
    "js", "ts", "jsx", "tsx", "mjs" -> KEYWORDS_JS
    "py" -> KEYWORDS_PYTHON
    "java" -> setOf(
        "public", "private", "protected", "class", "interface", "enum",
        "void", "return", "if", "else", "for", "while", "do", "new",
        "null", "true", "false", "import", "package", "static", "final",
        "abstract", "extends", "implements", "super", "this", "try", "catch", "finally"
    )
    else -> emptySet()
}

private val STRING_COLOR = Color(0xFFA6E3A1)
private val COMMENT_COLOR = Color(0xFF6C7086)
private val KEYWORD_COLOR = Color(0xFF89B4FA)
private val NUMBER_COLOR = Color(0xFFFAB387)
private val ANNOTATION_COLOR = Color(0xFFF5C2E7)
private val DEFAULT_COLOR = Color(0xFFCDD6F4)
private val SEARCH_HIGHLIGHT = Color(0xFFFFD700)

private fun buildHighlightedLine(
    line: String,
    extension: String?,
    searchQuery: String?
): AnnotatedString {
    if (line.isBlank()) return AnnotatedString(line)

    return buildAnnotatedString {
        withStyle(SpanStyle(color = DEFAULT_COLOR)) {
            // Full-line comment check
            val trimmed = line.trimStart()
            val isFullComment = trimmed.startsWith("//") || trimmed.startsWith("#") ||
                trimmed.startsWith("*") || trimmed.startsWith("/*")

            if (isFullComment) {
                withStyle(SpanStyle(color = COMMENT_COLOR)) {
                    append(line)
                }
                return@buildAnnotatedString
            }

            // Annotation/decorator line
            if (trimmed.startsWith("@")) {
                withStyle(SpanStyle(color = ANNOTATION_COLOR)) {
                    append(line)
                }
                return@buildAnnotatedString
            }

            val keywords = getKeywordsForExtension(extension)
            val tokens = tokenizeLine(line)

            for (token in tokens) {
                when {
                    token.isString -> withStyle(SpanStyle(color = STRING_COLOR)) { append(token.text) }
                    token.isNumber -> withStyle(SpanStyle(color = NUMBER_COLOR)) { append(token.text) }
                    token.isWord && token.text in keywords ->
                        withStyle(SpanStyle(color = KEYWORD_COLOR, fontWeight = FontWeight.Medium)) {
                            append(token.text)
                        }
                    else -> append(token.text)
                }
            }
        }

        // Overlay search highlights
        if (!searchQuery.isNullOrBlank()) {
            var start = 0
            val lower = line.lowercase()
            val queryLower = searchQuery.lowercase()
            while (true) {
                val idx = lower.indexOf(queryLower, start)
                if (idx < 0) break
                addStyle(SpanStyle(background = SEARCH_HIGHLIGHT, color = Color.Black), idx, idx + searchQuery.length)
                start = idx + 1
            }
        }
    }
}

private data class LineToken(
    val text: String,
    val isString: Boolean = false,
    val isNumber: Boolean = false,
    val isWord: Boolean = false
)

private val NUMBER_REGEX = Regex("^\\d+\\.?\\d*")
private val WORD_REGEX = Regex("^[a-zA-Z_][a-zA-Z0-9_]*")

private fun tokenizeLine(line: String): List<LineToken> {
    val tokens = mutableListOf<LineToken>()
    var i = 0
    while (i < line.length) {
        val ch = line[i]
        when {
            ch == '"' || ch == '\'' || ch == '`' -> {
                // String token
                val quote = ch
                val sb = StringBuilder().append(ch)
                i++
                while (i < line.length) {
                    val c = line[i]
                    sb.append(c)
                    i++
                    if (c == quote && (sb.length < 2 || sb[sb.length - 2] != '\\')) break
                }
                tokens.add(LineToken(sb.toString(), isString = true))
            }
            ch.isDigit() -> {
                val match = NUMBER_REGEX.find(line.substring(i))
                if (match != null) {
                    tokens.add(LineToken(match.value, isNumber = true))
                    i += match.value.length
                } else {
                    tokens.add(LineToken(ch.toString()))
                    i++
                }
            }
            ch.isLetter() || ch == '_' -> {
                val match = WORD_REGEX.find(line.substring(i))
                if (match != null) {
                    tokens.add(LineToken(match.value, isWord = true))
                    i += match.value.length
                } else {
                    tokens.add(LineToken(ch.toString()))
                    i++
                }
            }
            else -> {
                tokens.add(LineToken(ch.toString()))
                i++
            }
        }
    }
    return tokens
}

private fun countMatches(content: String, query: String): Int {
    if (query.isBlank()) return 0
    var count = 0
    var start = 0
    val lower = content.lowercase()
    val queryLower = query.lowercase()
    while (true) {
        val idx = lower.indexOf(queryLower, start)
        if (idx < 0) break
        count++
        start = idx + 1
    }
    return count
}

private fun isImageFile(ext: String?) =
    ext?.lowercase() in setOf("png", "jpg", "jpeg", "gif", "webp", "bmp")

private fun detectLanguage(ext: String?): String = when (ext?.lowercase()) {
    "kt", "kts" -> "Kotlin"
    "java" -> "Java"
    "py" -> "Python"
    "js" -> "JavaScript"
    "ts" -> "TypeScript"
    "jsx" -> "JSX"
    "tsx" -> "TSX"
    "go" -> "Go"
    "rs" -> "Rust"
    "cpp", "cc" -> "C++"
    "c" -> "C"
    "h" -> "C/C++ Header"
    "cs" -> "C#"
    "swift" -> "Swift"
    "rb" -> "Ruby"
    "php" -> "PHP"
    "sh", "bash", "zsh" -> "Shell"
    "json" -> "JSON"
    "yaml", "yml" -> "YAML"
    "toml" -> "TOML"
    "xml" -> "XML"
    "html", "htm" -> "HTML"
    "css" -> "CSS"
    "scss" -> "SCSS"
    "md" -> "Markdown"
    "sql" -> "SQL"
    "png", "jpg", "jpeg", "gif", "webp", "bmp" -> "Image"
    else -> ext?.uppercase() ?: "Plain Text"
}
