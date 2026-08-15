package com.claudewebui.app.core.network

import com.claudewebui.app.core.security.AuthEvents
import com.claudewebui.app.core.security.TokenStore
import io.ktor.client.plugins.api.*
import io.ktor.http.HttpStatusCode

/**
 * Ktor plugin that injects the JWT bearer token into every outgoing request.
 * Reads the token from [TokenStore] and adds it as an Authorization header.
 */
val AuthInterceptorPlugin = createClientPlugin("AuthInterceptor") {

    onRequest { request, _ ->
        val token = TokenStore.getToken()
        if (token != null) {
            request.headers.append("Authorization", "Bearer $token")
        }
    }

    // A rejected token has to end the session visibly. Previously every request
    // just kept failing while cached data stayed on screen, so the app looked
    // signed in for as long as Room had something to show.
    onResponse { response ->
        if (response.status != HttpStatusCode.Unauthorized) return@onResponse
        // The auth endpoints answer 401 as part of normal sign-in; reacting to
        // those would sign the user out while they are signing in.
        val path = response.call.request.url.encodedPath
        if (path.startsWith("/auth/") || path.startsWith("/api/auth/")) return@onResponse

        TokenStore.clearAll()
        AuthEvents.notifySessionExpired()
    }
}
