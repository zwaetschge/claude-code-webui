package com.claudewebui.app.widget

/**
 * The original "Sessions" widget, kept under its historical class name so
 * widgets already placed on a home screen keep updating after the app update.
 * Shows active sessions, which provider/agent is working, and the pending
 * approval count.
 */
class SessionWidgetReceiver : BaseWidgetProvider() {
    override val kind = WidgetKind.SESSIONS
}
