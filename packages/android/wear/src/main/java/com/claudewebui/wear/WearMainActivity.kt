package com.claudewebui.wear

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Watch companion screen: quick stats plus the pending-approval list with
 * Approve/Deny buttons. Responses go to the phone over the data layer; the
 * phone answers the backend and pushes a fresh snapshot back.
 */
class WearMainActivity : Activity() {

    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var content: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(28))
        }
        setContentView(ScrollView(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(content)
        })
        render(WearSnapshotStore.cached(this))
    }

    override fun onResume() {
        super.onResume()
        executor.execute {
            val snapshot = WearSnapshotStore.readLive(this)
            runOnUiThread { render(snapshot) }
        }
    }

    override fun onDestroy() {
        executor.shutdown()
        super.onDestroy()
    }

    private fun render(snapshot: WearSnapshot) {
        content.removeAllViews()
        content.addView(text("Plum Code", 15f, 0xFFCC785C.toInt(), bold = true).apply {
            gravity = Gravity.CENTER_HORIZONTAL
        })
        content.addView(
            text(
                "${snapshot.running} running · ${WearSnapshotStore.fmtTokens(snapshot.tokensToday)} tok · " +
                    "$%.2f".format(snapshot.costToday),
                12f,
                0xFFB7B2C0.toInt(),
            ).apply { gravity = Gravity.CENTER_HORIZONTAL }
        )
        content.addView(spacer(10))

        if (snapshot.approvals.isEmpty()) {
            content.addView(
                text("No pending approvals 🎉", 13f, 0xFF8A8494.toInt()).apply {
                    gravity = Gravity.CENTER_HORIZONTAL
                }
            )
            return
        }

        content.addView(text("Approvals", 13f, Color.WHITE, bold = true))
        snapshot.approvals.forEach { approval ->
            content.addView(spacer(8))
            content.addView(text(approval.toolName, 13f, Color.WHITE, bold = true))
            content.addView(text(approval.sessionName, 11f, 0xFF8A8494.toInt()))
            content.addView(LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(actionButton("Approve", 0xFF14532D.toInt()) { respond(approval, true) })
                addView(spacerH(8))
                addView(actionButton("Deny", 0xFF7F1D1D.toInt()) { respond(approval, false) })
            })
        }
    }

    private fun respond(approval: WearApproval, approve: Boolean) {
        executor.execute {
            val payload = JSONObject().apply {
                put("sessionId", approval.sessionId)
                put("requestId", approval.requestId)
                put("approve", approve)
            }.toString().toByteArray(Charsets.UTF_8)
            runCatching {
                val nodes = Tasks.await(
                    Wearable.getNodeClient(this).connectedNodes,
                    3, TimeUnit.SECONDS,
                )
                nodes.forEach { node ->
                    Tasks.await(
                        Wearable.getMessageClient(this).sendMessage(
                            node.id, WearSnapshotStore.PATH_APPROVAL_RESPONSE, payload,
                        ),
                        3, TimeUnit.SECONDS,
                    )
                }
            }
            // Optimistic: drop the row locally; the phone pushes the truth soon.
            val cached = WearSnapshotStore.cached(this)
            runOnUiThread {
                render(cached.copy(approvals = cached.approvals.filterNot { it.requestId == approval.requestId }))
            }
        }
    }

    // ── View helpers ───────────────────────────────────────────────────────

    private fun text(value: String, sizeSp: Float, color: Int, bold: Boolean = false) =
        TextView(this).apply {
            text = value
            textSize = sizeSp
            setTextColor(color)
            if (bold) setTypeface(typeface, Typeface.BOLD)
        }

    private fun actionButton(label: String, background: Int, onClick: () -> Unit) =
        Button(this).apply {
            text = label
            textSize = 11f
            setTextColor(Color.WHITE)
            setBackgroundColor(background)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener { onClick() }
        }

    private fun spacer(heightDp: Int) = TextView(this).apply {
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(heightDp))
    }

    private fun spacerH(widthDp: Int) = TextView(this).apply {
        layoutParams = LinearLayout.LayoutParams(dp(widthDp), ViewGroup.LayoutParams.MATCH_PARENT)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
