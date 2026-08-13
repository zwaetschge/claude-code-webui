package com.claudewebui.app.ui.components.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumSubtleFill

/**
 * Marks where the harness compacted its context. Everything above this line is
 * summarised rather than verbatim, which explains why the agent may "forget"
 * details from earlier in the thread.
 */
@Composable
fun CompactBoundaryCard(
    content: String,
    modifier: Modifier = Modifier,
) {
    val summary = content.lineSequence()
        .map { it.trim() }
        .firstOrNull { it.isNotEmpty() }
        ?: "Context compacted"

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(PlumSubtleFill)
            .border(1.dp, PlumBorder, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "⟢",
                style = MaterialTheme.typography.labelMedium,
                color = PlumAccent,
                modifier = Modifier.padding(end = 6.dp),
            )
            Text(
                "Context compacted",
                style = MaterialTheme.typography.labelMedium,
                color = PlumAccent,
                fontWeight = FontWeight.Bold,
            )
        }
        Text(
            summary,
            style = MaterialTheme.typography.labelSmall,
            color = PlumMuted,
            maxLines = 3,
        )
    }
}
