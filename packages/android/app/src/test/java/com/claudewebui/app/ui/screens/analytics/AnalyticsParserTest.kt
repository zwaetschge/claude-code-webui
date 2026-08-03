package com.claudewebui.app.ui.screens.analytics

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AnalyticsParserTest {
    @Test
    fun `uses current server models and never invents fallback models`() {
        val summary = Json.parseToJsonElement(
            """{
                "totals":{"totalTokens":4200,"apiEquivalentCost":1.25,"totalRequests":3,"pricingCoveragePercent":100},
                "byProvider":[{"provider":"Kimi","total_tokens":3000,"requests":2,"models":1,"api_equivalent_cost":0.9}],
                "byModel":[
                    {"model":"kimi-code/k3","provider":"Kimi","total_tokens":3000,"requests":2,"api_equivalent_cost":0.9,"pricing_known":true},
                    {"model":"gpt-5.6-sol","provider":"Codex","total_tokens":1200,"requests":1,"api_equivalent_cost":0.35,"pricing_known":true}
                ],
                "bySession":[],
                "pricingAudit":{"missingPricingModels":[]}
            }""".trimIndent(),
        ).jsonObject
        val timeline = Json.parseToJsonElement(
            """[{"date":"2026-08-02","total_tokens":4200,"cost":1.25,"requests":3}]""",
        ).jsonArray

        val parsed = AnalyticsParser.parse(summary, timeline)

        assertEquals(listOf("kimi-code/k3", "gpt-5.6-sol"), parsed.modelUsage.map { it.modelName })
        assertTrue(parsed.providerUsage.any { it.name == "Kimi" })
        assertEquals(4200L, parsed.timeline.single().tokenCount)
        assertFalse(parsed.modelUsage.any { it.modelName == "gpt-5.5" || it.modelName == "z-ai/glm-5.1" })
    }
}
