package com.claudewebui.wear

import androidx.wear.tiles.TileService
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService

/**
 * Caches every phone snapshot push and pokes the tile so glanceable surfaces
 * stay current without polling.
 */
class WearDataListenerService : WearableListenerService() {

    override fun onDataChanged(events: DataEventBuffer) {
        var updated = false
        events.forEach { event ->
            if (event.type != DataEvent.TYPE_CHANGED) return@forEach
            val item = event.dataItem
            if (item.uri.path == WearSnapshotStore.PATH_SNAPSHOT) {
                DataMapItem.fromDataItem(item).dataMap.getString(WearSnapshotStore.KEY_JSON)
                    ?.let { WearSnapshotStore.cache(this, it) }
                updated = true
            }
        }
        if (updated) {
            runCatching {
                TileService.getUpdater(this).requestUpdate(PlumTileService::class.java)
            }
        }
    }
}
