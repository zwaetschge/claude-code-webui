package com.claudewebui.app.ui.screens.filemanager

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.FileInfo
import com.claudewebui.app.data.model.FileType
import com.claudewebui.app.ui.components.filemanager.FileUploadSheet
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf
import java.text.DecimalFormat

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileManagerScreen(
    sessionId: String,
    workingDirectory: String,
    onNavigateBack: () -> Unit,
    onOpenFile: (FileInfo) -> Unit,
    onSendToChat: (String) -> Unit = {}
) {
    val viewModel: FileManagerViewModel = koinViewModel(
        parameters = { parametersOf(sessionId, workingDirectory) }
    )
    val state by viewModel.state.collectAsState()

    var showUploadSheet by remember { mutableStateOf(false) }
    var longPressedFile by remember { mutableStateOf<FileInfo?>(null) }
    var showDeleteDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        Text(
                            text = state.pathSegments.lastOrNull() ?: "Files",
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    },
                    navigationIcon = {
                        IconButton(onClick = onNavigateBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                        }
                    },
                    actions = {
                        IconButton(onClick = { viewModel.refresh() }) {
                            Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                        }
                    }
                )
                // Breadcrumb bar
                BreadcrumbBar(
                    segments = state.pathSegments,
                    onSegmentClick = { index ->
                        viewModel.navigateTo(viewModel.pathForSegment(index))
                    },
                    onGoUp = { viewModel.goUp() },
                    showGoUp = state.pathSegments.size > 1
                )
                // Search bar
                SearchBar(
                    query = state.searchQuery,
                    onQueryChange = { viewModel.search(it) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp)
                )
            }
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showUploadSheet = true },
                containerColor = MaterialTheme.colorScheme.primaryContainer
            ) {
                Icon(Icons.Default.Upload, contentDescription = "Upload file")
            }
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when {
                state.isLoading -> {
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                }
                state.error != null -> {
                    ErrorView(
                        message = state.error!!,
                        onRetry = { viewModel.refresh() },
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                state.filteredFiles.isEmpty() && state.searchQuery.isBlank() -> {
                    EmptyDirectoryView(modifier = Modifier.align(Alignment.Center))
                }
                state.filteredFiles.isEmpty() -> {
                    NoSearchResultsView(
                        query = state.searchQuery,
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(bottom = 80.dp)
                    ) {
                        items(
                            items = state.filteredFiles,
                            key = { it.path }
                        ) { file ->
                            FileListItem(
                                file = file,
                                onClick = {
                                    if (file.type == FileType.DIRECTORY) {
                                        viewModel.navigateTo(file.path)
                                    } else {
                                        onOpenFile(file)
                                    }
                                },
                                onLongClick = {
                                    longPressedFile = file
                                }
                            )
                            HorizontalDivider(
                                modifier = Modifier.padding(start = 68.dp),
                                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f)
                            )
                        }
                    }
                }
            }

            // Upload progress overlay
            if (state.isUploading) {
                UploadProgressOverlay(
                    progress = state.uploadProgress ?: 0f,
                    modifier = Modifier.align(Alignment.BottomCenter)
                )
            }
        }
    }

    // Long-press context menu
    longPressedFile?.let { file ->
        FileContextMenu(
            file = file,
            onDismiss = { longPressedFile = null },
            onDelete = {
                showDeleteDialog = true
            },
            onSendToChat = {
                onSendToChat(file.path)
                longPressedFile = null
            }
        )
    }

    // Delete confirmation dialog
    if (showDeleteDialog && longPressedFile != null) {
        AlertDialog(
            onDismissRequest = {
                showDeleteDialog = false
                longPressedFile = null
            },
            title = { Text("Delete ${longPressedFile?.name}?") },
            text = { Text("This action cannot be undone.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        longPressedFile?.let { viewModel.deleteFile(it) }
                        showDeleteDialog = false
                        longPressedFile = null
                    },
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    showDeleteDialog = false
                    longPressedFile = null
                }) {
                    Text("Cancel")
                }
            }
        )
    }

    // Upload sheet
    if (showUploadSheet) {
        FileUploadSheet(
            sessionId = sessionId,
            currentPath = state.currentPath,
            onDismiss = { showUploadSheet = false },
            onUploadComplete = {
                showUploadSheet = false
                viewModel.refresh()
            },
            viewModel = viewModel
        )
    }
}

@Composable
private fun BreadcrumbBar(
    segments: List<String>,
    onSegmentClick: (Int) -> Unit,
    onGoUp: () -> Unit,
    showGoUp: Boolean,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (showGoUp) {
            IconButton(
                onClick = onGoUp,
                modifier = Modifier.size(32.dp)
            ) {
                Icon(
                    Icons.Default.ArrowUpward,
                    contentDescription = "Go up",
                    modifier = Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
        Icon(
            Icons.Default.Home,
            contentDescription = null,
            modifier = Modifier.size(16.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
        segments.forEachIndexed { index, segment ->
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
            )
            TextButton(
                onClick = { onSegmentClick(index) },
                contentPadding = PaddingValues(horizontal = 4.dp, vertical = 2.dp),
                modifier = Modifier.height(28.dp)
            ) {
                Text(
                    text = segment,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = if (index == segments.lastIndex) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (index == segments.lastIndex)
                        MaterialTheme.colorScheme.primary
                    else
                        MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun SearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        placeholder = { Text("Search files...", style = MaterialTheme.typography.bodyMedium) },
        leadingIcon = {
            Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(18.dp))
        },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(Icons.Default.Close, contentDescription = "Clear", modifier = Modifier.size(18.dp))
                }
            }
        },
        singleLine = true,
        modifier = modifier,
        shape = RoundedCornerShape(24.dp),
        textStyle = MaterialTheme.typography.bodyMedium
    )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FileListItem(
    file: FileInfo,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick
            )
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // File icon
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(fileIconBackground(file)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = fileIcon(file),
                contentDescription = null,
                modifier = Modifier.size(22.dp),
                tint = fileIconTint(file)
            )
        }

        // Name + metadata
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = file.name,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (file.type == FileType.FILE) {
                    Text(
                        text = formatFileSize(file.size),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = "•",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Text(
                    text = formatDate(file.modifiedAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        if (file.type == FileType.DIRECTORY) {
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
            )
        }
    }
}

@Composable
private fun fileIconBackground(file: FileInfo): androidx.compose.ui.graphics.Color {
    return when {
        file.type == FileType.DIRECTORY -> MaterialTheme.colorScheme.primaryContainer
        isImageFile(file.extension) -> MaterialTheme.colorScheme.tertiaryContainer
        isCodeFile(file.extension) -> MaterialTheme.colorScheme.secondaryContainer
        else -> MaterialTheme.colorScheme.surfaceVariant
    }
}

@Composable
private fun fileIconTint(file: FileInfo): androidx.compose.ui.graphics.Color {
    return when {
        file.type == FileType.DIRECTORY -> MaterialTheme.colorScheme.onPrimaryContainer
        isImageFile(file.extension) -> MaterialTheme.colorScheme.onTertiaryContainer
        isCodeFile(file.extension) -> MaterialTheme.colorScheme.onSecondaryContainer
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
}

private fun fileIcon(file: FileInfo): ImageVector {
    if (file.type == FileType.DIRECTORY) return Icons.Default.Folder
    return when (file.extension?.lowercase()) {
        "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp" -> Icons.Default.Image
        "mp4", "mkv", "avi", "mov", "webm" -> Icons.Default.VideoFile
        "mp3", "wav", "flac", "ogg", "aac" -> Icons.Default.AudioFile
        "pdf" -> Icons.Default.PictureAsPdf
        "zip", "tar", "gz", "7z", "rar" -> Icons.Default.FolderZip
        "kt", "java", "py", "js", "ts", "go", "rs", "cpp", "c", "h",
        "cs", "swift", "rb", "php", "sh", "bash", "zsh" -> Icons.Default.Code
        "json", "yaml", "yml", "toml", "xml", "env" -> Icons.Default.DataObject
        "md", "txt", "rst", "log" -> Icons.Default.Article
        "html", "htm", "css", "scss" -> Icons.Default.Language
        else -> Icons.AutoMirrored.Filled.InsertDriveFile
    }
}

private fun isImageFile(ext: String?) = ext?.lowercase() in setOf("png", "jpg", "jpeg", "gif", "webp", "svg", "bmp")
private fun isCodeFile(ext: String?) = ext?.lowercase() in setOf(
    "kt", "java", "py", "js", "ts", "go", "rs", "cpp", "c", "h",
    "cs", "swift", "rb", "php", "sh", "bash", "json", "yaml", "yml",
    "toml", "xml", "html", "htm", "css", "scss", "md"
)

private fun formatFileSize(bytes: Long): String {
    if (bytes == 0L) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB")
    val fmt = DecimalFormat("#.#")
    var size = bytes.toDouble()
    var unitIndex = 0
    while (size >= 1024 && unitIndex < units.lastIndex) {
        size /= 1024
        unitIndex++
    }
    return "${fmt.format(size)} ${units[unitIndex]}"
}

private fun formatDate(dateStr: String): String {
    return try {
        dateStr.take(10) // "YYYY-MM-DD"
    } catch (e: Exception) {
        dateStr
    }
}

@Composable
private fun FileContextMenu(
    file: FileInfo,
    onDismiss: () -> Unit,
    onDelete: () -> Unit,
    onSendToChat: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = file.name,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        },
        text = {
            Column {
                TextButton(
                    onClick = {
                        onSendToChat()
                        onDismiss()
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Chat, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Send path to chat")
                }
                TextButton(
                    onClick = {
                        onDelete()
                        onDismiss()
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Delete")
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

@Composable
private fun UploadProgressOverlay(
    progress: Float,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 8.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Uploading...", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                Text("${(progress * 100).toInt()}%", style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
private fun ErrorView(message: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Icon(
            Icons.Default.ErrorOutline,
            contentDescription = null,
            modifier = Modifier.size(48.dp),
            tint = MaterialTheme.colorScheme.error
        )
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        OutlinedButton(onClick = onRetry) {
            Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(4.dp))
            Text("Retry")
        }
    }
}

@Composable
private fun EmptyDirectoryView(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Icon(
            Icons.Default.FolderOpen,
            contentDescription = null,
            modifier = Modifier.size(56.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
        )
        Text(
            "Empty directory",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            "Upload files using the button below",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
        )
    }
}

@Composable
private fun NoSearchResultsView(query: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Icon(
            Icons.Default.SearchOff,
            contentDescription = null,
            modifier = Modifier.size(48.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
        )
        Text(
            "No results for \"$query\"",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
