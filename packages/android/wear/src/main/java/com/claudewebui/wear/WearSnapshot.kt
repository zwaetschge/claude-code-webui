package com.claudewebui.wear

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** One pending approval mirrored from the phone. */
data class WearApproval(
    val sessionId: String,
    val sessionName: String,
    val toolName: String,
    val requestId: String,
)

data class WearSnapshot(
    val updatedAtMs: Long = 0,
    val running: Int = 0,
    val tokensToday: Long = 0,
    val costToday: Double = 0.0,
    val requestsToday: Long = 0,
    val approvals: List<WearApproval> = emptyList(),
)

/**
 * Snapshot access for every wear surface. The phone writes one DataItem at
 * /plum/snapshot; [WearDataListenerService] caches its JSON into prefs so the
 * tile and complication render instantly, and [readLive] pulls the DataItem
 * directly when freshness matters (foreground activity).
 */
object WearSnapshotStore {

    const val PATH_SNAPSHOT = "/plum/snapshot"
    const val PATH_APPROVAL_RESPONSE = "/plum/approval-response"
    const val KEY_JSON = "json"

    private const val PREFS = "wear_snapshot"
    private const val KEY_CACHED = "snapshot_json"

    fun cache(context: Context, json: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_CACHED, json).apply()
    }

    fun cached(context: Context): WearSnapshot =
        parse(
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_CACHED, null)
        )

    /** Blocking DataClient read — call off the main thread only. */
    fun readLive(context: Context): WearSnapshot {
        return runCatching {
            val items = Tasks.await(
                Wearable.getDataClient(context).dataItems,
                3, TimeUnit.SECONDS,
            )
            var json: String? = null
            items.forEach { item ->
                if (item.uri.path == PATH_SNAPSHOT) {
                    json = DataMapItem.fromDataItem(item).dataMap.getString(KEY_JSON)
                }
            }
            items.release()
            json?.also { cache(context, it) }
            parse(json)
        }.getOrElse { cached(context) }
    }

    private fun parse(json: String?): WearSnapshot {
        if (json.isNullOrBlank()) return WearSnapshot()
        return runCatching {
            val root = JSONObject(json)
            val approvals = buildList {
                val array = root.optJSONArray("approvals")
                for (i in 0 until (array?.length() ?: 0)) {
                    val entry = array!!.optJSONObject(i) ?: continue
                    add(
                        WearApproval(
                            sessionId = entry.optString("sessionId"),
                            sessionName = entry.optString("sessionName"),
                            toolName = entry.optString("toolName"),
                            requestId = entry.optString("requestId"),
                        )
                    )
                }
            }
            WearSnapshot(
                updatedAtMs = root.optLong("updatedAtMs"),
                running = root.optInt("running"),
                tokensToday = root.optLong("tokensToday"),
                costToday = root.optDouble("costToday", 0.0),
                requestsToday = root.optLong("requestsToday"),
                approvals = approvals,
            )
        }.getOrDefault(WearSnapshot())
    }

    fun fmtTokens(value: Long): String = when {
        value >= 1_000_000 -> "%.1fM".format(value / 1_000_000.0)
        value >= 1_000 -> "%.1fk".format(value / 1_000.0)
        else -> value.toString()
    }
}
