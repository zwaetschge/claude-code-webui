package com.claudewebui.app.core.audio

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import java.io.File

/**
 * Push-to-talk recorder for dictated prompts.
 *
 * Records AAC into the app cache and hands the bytes to the server, which
 * forwards them to the configured transcription service. Deliberately minimal:
 * no streaming, no VAD — one tap starts, one tap stops.
 */
class VoiceRecorder(private val context: Context) {

    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null

    val isRecording: Boolean get() = recorder != null

    fun start(): Boolean = runCatching {
        val file = File(context.cacheDir, "dictation-${System.currentTimeMillis()}.m4a")
        val created = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }
        created.apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioSamplingRate(16_000)
            setAudioEncodingBitRate(32_000)
            setOutputFile(file.absolutePath)
            prepare()
            start()
        }
        recorder = created
        outputFile = file
        true
    }.getOrElse {
        release()
        false
    }

    /** Stops and returns the recorded bytes, or null when nothing usable. */
    fun stop(): ByteArray? {
        val file = outputFile
        runCatching { recorder?.stop() }
        release()
        val bytes = file?.takeIf { it.exists() && it.length() > 0 }?.readBytes()
        file?.delete()
        outputFile = null
        return bytes
    }

    fun cancel() {
        runCatching { recorder?.stop() }
        release()
        outputFile?.delete()
        outputFile = null
    }

    private fun release() {
        runCatching { recorder?.release() }
        recorder = null
    }
}
