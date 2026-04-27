package com.claudewebui.app.core.updates

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.util.Log
import androidx.core.content.FileProvider
import com.claudewebui.app.BuildConfig
import com.claudewebui.app.core.network.ApiClient
import com.claudewebui.app.data.model.AppVersionInfo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File

private const val TAG = "AppUpdateChecker"
private const val APK_FILE_NAME = "claude-webui-update.apk"

/**
 * Checks the server's `/api/app/version` endpoint for a newer Android APK version.
 * Handles download via [DownloadManager] and triggers APK install via FileProvider.
 *
 * Usage:
 *  1. Inject as singleton.
 *  2. Call [checkForUpdate] on app startup or manually.
 *  3. Observe [updateState] to show UI.
 *  4. Call [downloadAndInstall] when user confirms.
 */
class AppUpdateChecker(
    private val context: Context,
    private val apiClient: ApiClient
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val appContext = context.applicationContext

    private val _updateState = MutableStateFlow<UpdateState>(UpdateState.Idle)
    val updateState: StateFlow<UpdateState> = _updateState.asStateFlow()

    private var downloadId: Long = -1L

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    fun checkForUpdate() {
        scope.launch {
            _updateState.value = UpdateState.Checking
            runCatching {
                val response = apiClient.checkAppVersion()
                if (response.success && response.data != null) {
                    val serverVersion = response.data.version
                    val serverCode = response.data.versionCode
                    val downloadUrl = response.data.downloadUrl
                    val currentCode = BuildConfig.VERSION_CODE

                    if (serverCode > currentCode && downloadUrl.isNotEmpty()) {
                        _updateState.value = UpdateState.UpdateAvailable(
                            currentVersion = BuildConfig.VERSION_NAME,
                            newVersion = serverVersion,
                            downloadUrl = downloadUrl,
                            releaseNotes = response.data.releaseNotes
                        )
                    } else {
                        _updateState.value = UpdateState.UpToDate
                    }
                } else {
                    _updateState.value = UpdateState.Idle
                }
            }.onFailure { e ->
                Log.w(TAG, "Update check failed: ${e.message}")
                _updateState.value = UpdateState.Idle
            }
        }
    }

    fun downloadAndInstall(downloadUrl: String) {
        _updateState.value = UpdateState.Downloading(progress = 0)

        val apkFile = File(appContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_FILE_NAME)

        val dm = appContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val request = DownloadManager.Request(Uri.parse(downloadUrl))
            .setTitle("Plum Code WebUI Update")
            .setDescription("Downloading update…")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationUri(Uri.fromFile(apkFile))

        downloadId = dm.enqueue(request)

        // Register broadcast receiver to detect completion
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                val id = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) ?: -1L
                if (id == downloadId) {
                    appContext.unregisterReceiver(this)
                    installApk(apkFile)
                }
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            appContext.registerReceiver(
                receiver,
                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                Context.RECEIVER_NOT_EXPORTED
            )
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            appContext.registerReceiver(
                receiver,
                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
            )
        }
    }

    fun dismissUpdate() {
        _updateState.value = UpdateState.Idle
    }

    // -------------------------------------------------------------------------
    // Install
    // -------------------------------------------------------------------------

    private fun installApk(apkFile: File) {
        if (!apkFile.exists()) {
            _updateState.value = UpdateState.Error("Downloaded file not found")
            return
        }

        _updateState.value = UpdateState.ReadyToInstall

        try {
            val apkUri = FileProvider.getUriForFile(
                appContext,
                "${appContext.packageName}.provider",
                apkFile
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(apkUri, "application/vnd.android.package-archive")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
            }
            appContext.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "APK install failed: ${e.message}")
            _updateState.value = UpdateState.Error("Failed to launch installer: ${e.message}")
        }
    }
}

// ── State ─────────────────────────────────────────────────────────────────────

sealed class UpdateState {
    object Idle : UpdateState()
    object Checking : UpdateState()
    object UpToDate : UpdateState()
    data class UpdateAvailable(
        val currentVersion: String,
        val newVersion: String,
        val downloadUrl: String,
        val releaseNotes: String? = null
    ) : UpdateState()
    data class Downloading(val progress: Int) : UpdateState()
    object ReadyToInstall : UpdateState()
    data class Error(val message: String) : UpdateState()
}

// AppVersionInfo is defined in com.claudewebui.app.data.model.AppVersionInfo
