package com.claudewebui.app.ui.components.chat

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.QuestionAnswer
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.PermissionRequestData
import com.claudewebui.app.data.model.QuestionRequestEvent

/**
 * Card for the legacy (denials-based) permission flow: the CLI turn was
 * blocked on one or more tools and asks to re-run with them approved.
 */
@Composable
fun LegacyPermissionCard(
    request: PermissionRequestData,
    onApprove: () -> Unit,
    onDeny: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp)),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(
                text = "Permission required",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(modifier = Modifier.height(4.dp))
            val tools = request.denials.joinToString(", ") { it.toolName }.ifBlank { "tools" }
            Text(
                text = "The agent wants to use: $tools",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = onDeny,
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                ) {
                    Icon(Icons.Outlined.Block, contentDescription = null, modifier = Modifier.width(14.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Deny", style = MaterialTheme.typography.labelMedium)
                }
                FilledTonalButton(
                    onClick = onApprove,
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                ) {
                    Icon(Icons.Outlined.Check, contentDescription = null, modifier = Modifier.width(14.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Approve & retry", style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}

/**
 * Card for OpenCode question prompts (`session:question_request`).
 * answers[i] carries the selected labels (or custom text) for question i.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuestionPromptCard(
    request: QuestionRequestEvent,
    onRespond: (List<List<String>>) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // question index -> selected labels
    val selections = remember(request.requestId) { mutableStateMapOf<Int, Set<String>>() }
    // question index -> free-text answer (custom questions)
    val customText = remember(request.requestId) { mutableStateMapOf<Int, String>() }

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp)),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Outlined.QuestionAnswer,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.width(18.dp),
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "The agent needs input",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            request.questions.forEachIndexed { index, question ->
                Spacer(modifier = Modifier.height(10.dp))
                Text(
                    text = question.question,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Medium,
                )
                if (question.options.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(6.dp))
                    LazyRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        contentPadding = PaddingValues(end = 8.dp),
                    ) {
                        items(question.options) { option ->
                            val selected = selections[index]?.contains(option.label) == true
                            FilterChip(
                                selected = selected,
                                onClick = {
                                    val current = selections[index].orEmpty()
                                    selections[index] = when {
                                        selected -> current - option.label
                                        question.multiple -> current + option.label
                                        else -> setOf(option.label)
                                    }
                                },
                                label = { Text(option.label, fontSize = 11.sp) },
                            )
                        }
                    }
                }
                if (question.custom) {
                    Spacer(modifier = Modifier.height(6.dp))
                    OutlinedTextField(
                        value = customText[index].orEmpty(),
                        onValueChange = { customText[index] = it },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Custom answer", fontSize = 12.sp) },
                        textStyle = MaterialTheme.typography.bodySmall,
                        minLines = 1,
                        maxLines = 3,
                    )
                }
            }

            Spacer(modifier = Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = onDismiss,
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                ) {
                    Text("Dismiss", style = MaterialTheme.typography.labelMedium)
                }
                val canSend = request.questions.indices.all { i ->
                    !selections[i].isNullOrEmpty() || !customText[i].isNullOrBlank() ||
                        request.questions[i].options.isEmpty() && !request.questions[i].custom
                }
                FilledTonalButton(
                    onClick = {
                        val answers = request.questions.indices.map { i ->
                            val picked = selections[i].orEmpty().toList()
                            val custom = customText[i]?.takeIf { it.isNotBlank() }
                            when {
                                picked.isNotEmpty() -> picked
                                custom != null -> listOf(custom)
                                else -> emptyList()
                            }
                        }
                        onRespond(answers)
                    },
                    enabled = canSend,
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                ) {
                    Text("Send", style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}
