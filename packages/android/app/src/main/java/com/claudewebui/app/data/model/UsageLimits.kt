package com.claudewebui.app.data.model

import kotlinx.serialization.Serializable

/**
 * Models for `GET /api/usage/limits?provider=<id>` — live account quota straight
 * from the upstream provider (ChatGPT/Codex, Anthropic, Z.AI, Kimi, …).
 *
 * The envelope is *not* the generic [ApiResponse]: it carries a `supported`
 * flag alongside `data`, because execution harnesses like OpenCode and Pi have
 * no account of their own and answer `supported: false` with an explanatory
 * error instead of failing the request.
 */

@Serializable
data class UsageLimitWindow(
    val utilization: Int = 0,
    val resetsAt: String? = null,
    val windowSeconds: Long? = null,
    val used: Double? = null,
    val limit: Double? = null,
    val remaining: Double? = null,
    val unit: String? = null,
)

@Serializable
data class AdditionalUsageLimit(
    val name: String,
    val utilization: Int = 0,
    val resetsAt: String? = null,
    val windowSeconds: Long? = null,
)

@Serializable
data class UsageLimitData(
    val subscriptionType: String? = null,
    val rateLimitTier: String? = null,
    val fiveHour: UsageLimitWindow? = null,
    val sevenDay: UsageLimitWindow? = null,
    val sevenDaySonnet: UsageLimitWindow? = null,
    val additional: List<AdditionalUsageLimit> = emptyList(),
)

@Serializable
data class UsageLimitsResponse(
    val success: Boolean = false,
    val supported: Boolean = false,
    val provider: String = "",
    val data: UsageLimitData? = null,
    val error: ApiError? = null,
)

/**
 * Providers that expose an account-level quota API. Mirrors
 * `ACCOUNT_USAGE_LIMIT_PROVIDERS` in the WebUI's `lib/providers.ts`.
 */
enum class UsageLimitProvider(val id: String, val label: String) {
    CODEX("codex", "Codex"),
    CLAUDE("claude", "Claude"),
    ZAI("zai", "Z.AI"),
    KIMI("kimi", "Kimi"),
    ALIBABA("alibaba", "Alibaba"),
}
