package com.claudewebui.app.ui.screens.filemanager

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.FileInfo
import com.claudewebui.app.data.model.FileType
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.koin.core.component.KoinComponent
import org.koin.core.component.inject

data class FileManagerState(
    val currentPath: String = "",
    val files: List<FileInfo> = emptyList(),
    val filteredFiles: List<FileInfo> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val searchQuery: String = "",
    val pathSegments: List<String> = emptyList(),
    val uploadProgress: Float? = null,
    val isUploading: Boolean = false
)

class FileManagerViewModel(
    private val sessionId: String,
    private val initialPath: String
) : ViewModel(), KoinComponent {

    private val apiClient: ApiClient by inject()

    private val _state = MutableStateFlow(FileManagerState(currentPath = initialPath))
    val state: StateFlow<FileManagerState> = _state.asStateFlow()

    init {
        navigateTo(initialPath)
    }

    fun navigateTo(path: String) {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, error = null, searchQuery = "") }
            try {
                val result = apiClient.getDirectory(path)
                if (result.success && result.data != null) {
                    val sortedFiles = result.data.files.sortedWith(
                        compareBy<FileInfo> { it.type != FileType.DIRECTORY }.thenBy { it.name.lowercase() }
                    )
                    _state.update {
                        it.copy(
                            currentPath = path,
                            files = sortedFiles,
                            filteredFiles = sortedFiles,
                            pathSegments = buildPathSegments(path),
                            isLoading = false
                        )
                    }
                } else {
                    _state.update {
                        it.copy(
                            isLoading = false,
                            error = result.error?.message ?: "Failed to load directory"
                        )
                    }
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(
                        isLoading = false,
                        error = e.message ?: "Unknown error"
                    )
                }
            }
        }
    }

    fun goUp() {
        val current = _state.value.currentPath
        val parent = current.substringBeforeLast('/', current)
        if (parent != current && parent.isNotEmpty()) {
            navigateTo(parent)
        }
    }

    fun refresh() {
        navigateTo(_state.value.currentPath)
    }

    fun search(query: String) {
        _state.update { state ->
            val filtered = if (query.isBlank()) {
                state.files
            } else {
                state.files.filter { it.name.contains(query, ignoreCase = true) }
            }
            state.copy(searchQuery = query, filteredFiles = filtered)
        }
    }

    fun uploadFile(
        context: Context,
        uri: Uri,
        fileName: String
    ) {
        viewModelScope.launch {
            _state.update { it.copy(isUploading = true, uploadProgress = 0f, error = null) }
            try {
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    ?: throw Exception("Could not read file")
                val mimeType = context.contentResolver.getType(uri) ?: "application/octet-stream"
                _state.update { it.copy(uploadProgress = 0.5f) }
                val result = apiClient.uploadFile(sessionId, fileName, bytes, mimeType)
                if (result.success) {
                    _state.update { it.copy(isUploading = false, uploadProgress = null) }
                    refresh()
                } else {
                    _state.update {
                        it.copy(
                            isUploading = false,
                            uploadProgress = null,
                            error = result.error?.message ?: "Upload failed"
                        )
                    }
                }
            } catch (e: Exception) {
                _state.update {
                    it.copy(
                        isUploading = false,
                        uploadProgress = null,
                        error = e.message ?: "Upload failed"
                    )
                }
            }
        }
    }

    fun deleteFile(file: FileInfo) {
        // File deletion would require a dedicated backend endpoint
        _state.update { it.copy(error = "Delete not supported via API") }
    }

    fun clearError() {
        _state.update { it.copy(error = null) }
    }

    private fun buildPathSegments(path: String): List<String> {
        if (path.isEmpty()) return emptyList()
        return path.split('/').filter { it.isNotEmpty() }
    }

    fun pathForSegment(index: Int): String {
        val segments = _state.value.pathSegments
        val parts = segments.take(index + 1)
        return if (_state.value.currentPath.startsWith('/')) {
            "/" + parts.joinToString("/")
        } else {
            parts.joinToString("/")
        }
    }
}
