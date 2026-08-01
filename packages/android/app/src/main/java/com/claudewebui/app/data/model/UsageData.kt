package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class UsageData(
    val sessionId: String,
    // Token usage
    val inputTokens: Long = 0,
    val outputTokens: Long = 0,
    val cacheReadTokens: Long = 0,
    val cacheCreationTokens: Long = 0,
    val totalTokens: Long = 0,
    // Context window
    val contextWindow: Long = 0,
    val contextUsedPercent: Double = 0.0,
    // Cost
    val totalCostUsd: Double = 0.0,
    // Model info
    val model: String = ""
)
