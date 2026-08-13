package com.claudewebui.app.core.notifications

import com.claudewebui.app.data.model.SessionStatus

/** STOPPED follows the rich assistant reply and must never replace it. */
internal fun shouldPostGenericStatusNotification(status: SessionStatus): Boolean =
    status == SessionStatus.ERROR
