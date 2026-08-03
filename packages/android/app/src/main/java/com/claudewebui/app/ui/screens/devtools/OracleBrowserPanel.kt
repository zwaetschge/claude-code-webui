package com.claudewebui.app.ui.screens.devtools

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumRed
import com.claudewebui.app.ui.components.common.PlumSubtleFill
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.StatusPill
import kotlinx.coroutines.delay

@Composable
fun OracleBrowserPanel(state: DevToolsUiState, viewModel: DevToolsViewModel) {
    val browser = state.oracle
    var targetUrl by remember { mutableStateOf("") }
    var textInput by remember { mutableStateOf("") }

    LaunchedEffect(browser?.currentUrl, browser?.chatgptUrl) {
        if (targetUrl.isBlank()) {
            targetUrl = browser?.currentUrl ?: browser?.chatgptUrl.orEmpty()
        }
    }

    LaunchedEffect(browser?.running) {
        var ticks = 0
        while (browser?.running == true) {
            viewModel.loadOracleFrame()
            delay(1_100)
            ticks++
            if (ticks % 5 == 0) viewModel.loadOracle(loadFrame = false)
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
            Column(
                Modifier.fillMaxWidth().padding(15.dp),
                verticalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            browser?.title?.takeIf(String::isNotBlank) ?: "Oracle browser",
                            color = PlumText,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            when (browser?.mode) {
                                "manual" -> "Embedded browser"
                                "remote" -> "Remote browser"
                                else -> "Profile copy"
                            },
                            color = PlumMuted,
                            fontSize = 11.sp,
                        )
                    }
                    StatusPill(
                        browser?.status ?: if (state.isLoadingOracle) "loading" else "idle",
                        when (browser?.status) {
                            "running" -> PlumGreen
                            "error" -> PlumRed
                            else -> PlumMuted
                        },
                    )
                }

                browser?.message?.takeIf(String::isNotBlank)?.let {
                    Text(it, color = PlumMuted, fontSize = 11.sp)
                }
                browser?.error?.takeIf(String::isNotBlank)?.let {
                    Text(it, color = PlumRed, fontSize = 11.sp)
                }

                OutlinedTextField(
                    value = targetUrl,
                    onValueChange = { targetUrl = it },
                    label = { Text("URL") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (browser?.running == true) {
                        OracleChip("Go", state.isOracleActionPending) {
                            viewModel.navigateOracle(targetUrl)
                        }
                        OracleChip("Reload", state.isOracleActionPending) {
                            viewModel.reloadOracle()
                        }
                        OracleChip("Stop", state.isOracleActionPending, destructive = true) {
                            viewModel.stopOracle()
                        }
                    } else {
                        OracleChip("Start", state.isOracleActionPending) {
                            viewModel.startOracle(targetUrl)
                        }
                    }
                }
            }
        }

        if (browser?.running == true) {
            OracleFrame(state, viewModel)

            GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
                Column(
                    Modifier.fillMaxWidth().padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        "Input",
                        color = PlumText,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                    )
                    OutlinedTextField(
                        value = textInput,
                        onValueChange = { textInput = it },
                        label = { Text("Text to type") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                        OracleChip("Type", textInput.isEmpty()) {
                            viewModel.sendOracleText(textInput)
                            textInput = ""
                        }
                        OracleChip("Enter", false) { viewModel.sendOracleKey("Enter", "Enter") }
                        OracleChip("Tab", false) { viewModel.sendOracleKey("Tab", "Tab") }
                        OracleChip("⌫", false) {
                            viewModel.sendOracleKey("Backspace", "Backspace")
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                        OracleChip("Scroll up", false) { viewModel.scrollOracle(-520f) }
                        OracleChip("Scroll down", false) { viewModel.scrollOracle(520f) }
                    }
                    Text(
                        "Tap the browser image to click. Text and special keys are sent " +
                            "through the controls above.",
                        color = PlumMuted,
                        fontSize = 10.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun OracleFrame(state: DevToolsUiState, viewModel: DevToolsViewModel) {
    val frame = state.oracleFrame
    val bitmap = remember(frame) {
        frame?.let { bytes ->
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
        }
    }
    val viewport = state.oracle?.viewport
    val ratio = ((viewport?.width ?: 1280).toFloat() / (viewport?.height ?: 720).coerceAtLeast(1))

    GlassPanel(Modifier.fillMaxWidth(), radius = 17.dp) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(ratio)
                .background(PlumSubtleFill)
                .pointerInput(frame) {
                    detectTapGestures { offset ->
                        if (size.width > 0 && size.height > 0) {
                            viewModel.clickOracle(
                                (offset.x / size.width).coerceIn(0f, 1f),
                                (offset.y / size.height).coerceIn(0f, 1f),
                            )
                        }
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            if (bitmap == null) {
                CircularProgressIndicator(color = PlumAccent, strokeWidth = 2.5.dp)
            } else {
                Image(
                    painter = BitmapPainter(bitmap),
                    contentDescription = "Oracle browser frame",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxWidth().aspectRatio(ratio),
                )
            }
        }
    }
}

@Composable
private fun OracleChip(
    label: String,
    disabled: Boolean,
    destructive: Boolean = false,
    onClick: () -> Unit,
) {
    Text(
        label,
        color = if (disabled) PlumMuted else if (destructive) PlumRed else PlumText,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(
                if (destructive) PlumRed.copy(alpha = .12f) else PlumAccent.copy(alpha = .18f),
            )
            .clickable(enabled = !disabled, onClick = onClick)
            .padding(horizontal = 13.dp, vertical = 8.dp),
    )
}
