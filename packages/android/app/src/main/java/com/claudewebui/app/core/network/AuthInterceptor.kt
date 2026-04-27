package com.claudewebui.app.core.network

import com.claudewebui.app.core.security.TokenStore
import io.ktor.client.plugins.api.*

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
}
