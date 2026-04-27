package com.claudewebui.app.ui.screens.auth

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.AuthUser
import com.claudewebui.app.ui.theme.AntiqueBrass
import com.claudewebui.app.ui.theme.AntiqueBrassDark
import com.claudewebui.app.ui.theme.BrandBlue
import com.claudewebui.app.ui.theme.BrandPurple
import com.claudewebui.app.ui.theme.SuccessGreen

// ── Screen entry point ────────────────────────────────────────────────────────

@Composable
fun LoginScreen(
    viewModel: LoginViewModel,
    onAuthenticated: (AuthUser) -> Unit,
    onNavigateToServerSetup: () -> Unit,
) {
    val authState by viewModel.authState.collectAsState()

    // Forward terminal state to caller
    LaunchedEffect(authState) {
        if (authState is AuthState.Authenticated) {
            onAuthenticated((authState as AuthState.Authenticated).user)
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        AnimatedContent(
            targetState = authState,
            transitionSpec = {
                (slideInVertically { it / 6 } + fadeIn(tween(300)))
                    .togetherWith(slideOutVertically { -it / 6 } + fadeOut(tween(200)))
            },
            label = "auth_content",
        ) { state ->
            when (state) {
                is AuthState.Idle -> {
                    // First launch — no server configured yet, go to server setup
                    LaunchedEffect(Unit) {
                        onNavigateToServerSetup()
                    }
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = AntiqueBrass)
                    }
                }

                is AuthState.Connecting -> {
                    ConnectingView()
                }

                is AuthState.Connected -> {
                    AuthMethodSelectionView(
                        serverInfo = state.serverInfo,
                        authConfig = state.authConfig,
                        viewModel = viewModel,
                        onChangeServer = onNavigateToServerSetup,
                    )
                }

                is AuthState.Authenticating -> {
                    AuthenticatingView()
                }

                is AuthState.Authenticated -> {
                    // Handled via LaunchedEffect above
                    Box(Modifier.fillMaxSize())
                }

                is AuthState.Error -> {
                    ErrorView(
                        message = state.message,
                        isConnectionError = state.isConnectionError,
                        onRetry = {
                            if (state.isConnectionError) onNavigateToServerSetup()
                            else viewModel.resetToConnected()
                        },
                        onBack = {
                            viewModel.resetToIdle()
                            onNavigateToServerSetup()
                        },
                    )
                }
            }
        }
    }
}

// ── Branding header ───────────────────────────────────────────────────────────

@Composable
private fun BrandHeader(
    modifier: Modifier = Modifier,
    subtitle: String = "Sign in to your workspace",
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Logo mark — gradient square with CC initial
        Box(
            modifier = Modifier
                .size(72.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(
                    Brush.linearGradient(
                        colors = listOf(AntiqueBrass, AntiqueBrassDark),
                    )
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "CC",
                style = MaterialTheme.typography.headlineSmall.copy(
                    fontWeight = FontWeight.Bold,
                    letterSpacing = (-0.5).sp,
                ),
                color = Color.White,
            )
        }

        val titleText = buildAnnotatedString {
            withStyle(SpanStyle(color = MaterialTheme.colorScheme.onBackground)) {
                append("Plum Code ")
            }
            withStyle(
                SpanStyle(
                    brush = Brush.horizontalGradient(listOf(BrandPurple, BrandBlue)),
                )
            ) {
                append("WebUI")
            }
        }

        Text(
            text = titleText,
            style = MaterialTheme.typography.headlineSmall,
        )

        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

// ── Auth method selection ─────────────────────────────────────────────────────

@Composable
private fun AuthMethodSelectionView(
    serverInfo: ServerInfo,
    authConfig: AuthConfig,
    viewModel: LoginViewModel,
    onChangeServer: () -> Unit,
) {
    var showBasicAuth by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .systemBarsPadding()
            .imePadding()
            .padding(horizontal = 24.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        BrandHeader()

        // Connected server chip
        ConnectedServerChip(
            url = serverInfo.url,
            onChangeServer = onChangeServer,
        )

        // Auth options card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceContainer,
            ),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    text = "Sign in",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )

                // Google OAuth
                if (authConfig.googleOAuthEnabled) {
                    OAuthButton(
                        label = "Continue with Google",
                        iconContent = {
                            GoogleIconSvg(modifier = Modifier.size(20.dp))
                        },
                        onClick = { /* Launch Custom Tab / WebView */ },
                    )
                }

                // GitHub OAuth
                if (authConfig.githubOAuthEnabled) {
                    OAuthButton(
                        label = "Continue with GitHub",
                        iconContent = {
                            Icon(
                                Icons.Default.Person,
                                contentDescription = null,
                                modifier = Modifier.size(20.dp),
                            )
                        },
                        onClick = { /* Launch Custom Tab */ },
                    )
                }

                // Separator before basic auth
                if (authConfig.googleOAuthEnabled || authConfig.githubOAuthEnabled) {
                    OrDivider()
                }

                // Basic Auth toggle
                AnimatedVisibility(
                    visible = !showBasicAuth,
                    enter = fadeIn(),
                    exit = fadeOut(),
                ) {
                    OutlinedButton(
                        onClick = { showBasicAuth = true },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        shape = RoundedCornerShape(10.dp),
                        border = androidx.compose.foundation.BorderStroke(
                            1.dp,
                            MaterialTheme.colorScheme.outline,
                        ),
                    ) {
                        Icon(
                            Icons.Default.Lock,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text("Use username & password")
                    }
                }

                // Basic Auth form
                AnimatedVisibility(
                    visible = showBasicAuth,
                    enter = expandVertically() + fadeIn(),
                    exit = shrinkVertically() + fadeOut(),
                ) {
                    BasicAuthForm(
                        viewModel = viewModel,
                        onCancel = { showBasicAuth = false },
                    )
                }

                // Dev login (only when available)
                if (authConfig.devLoginEnabled) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    TextButton(
                        onClick = { viewModel.loginDev() },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            "Dev login (no auth)",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

// ── Basic auth form ───────────────────────────────────────────────────────────

@Composable
private fun BasicAuthForm(
    viewModel: LoginViewModel,
    onCancel: () -> Unit,
) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var rememberMe by remember { mutableStateOf(true) }

    val authState by viewModel.authState.collectAsState()
    val isLoading = authState is AuthState.Authenticating
    val errorMessage = (authState as? AuthState.Error)?.message

    val passwordFocus = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // Username
        OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Username") },
            leadingIcon = {
                Icon(Icons.Default.Person, contentDescription = null, modifier = Modifier.size(20.dp))
            },
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Text,
                capitalization = KeyboardCapitalization.None,
                imeAction = ImeAction.Next,
            ),
            keyboardActions = KeyboardActions(
                onNext = { passwordFocus.requestFocus() }
            ),
            singleLine = true,
            isError = authState is AuthState.Error,
            shape = RoundedCornerShape(10.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = AntiqueBrass,
                focusedLabelColor = AntiqueBrass,
            ),
        )

        // Password
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            modifier = Modifier
                .fillMaxWidth()
                .focusRequester(passwordFocus),
            label = { Text("Password") },
            leadingIcon = {
                Icon(Icons.Default.Lock, contentDescription = null, modifier = Modifier.size(20.dp))
            },
            trailingIcon = {
                IconButton(onClick = { passwordVisible = !passwordVisible }) {
                    Icon(
                        if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = if (passwordVisible) "Hide password" else "Show password",
                        modifier = Modifier.size(20.dp),
                    )
                }
            },
            visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Password,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(
                onDone = {
                    focusManager.clearFocus()
                    viewModel.loginBasicAuth(username, password)
                }
            ),
            singleLine = true,
            isError = authState is AuthState.Error,
            shape = RoundedCornerShape(10.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = AntiqueBrass,
                focusedLabelColor = AntiqueBrass,
            ),
        )

        // Error
        AnimatedVisibility(
            visible = authState is AuthState.Error,
            enter = expandVertically() + fadeIn(),
            exit = shrinkVertically() + fadeOut(),
        ) {
            if (errorMessage != null) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(14.dp),
                    )
                    Text(
                        text = errorMessage,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }

        // Remember me
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Checkbox(
                checked = rememberMe,
                onCheckedChange = { rememberMe = it },
                colors = CheckboxDefaults.colors(checkedColor = AntiqueBrass),
            )
            Text(
                text = "Keep me signed in",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }

        // Actions
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            TextButton(
                onClick = onCancel,
                modifier = Modifier.weight(1f),
            ) {
                Text("Cancel")
            }

            Button(
                onClick = { viewModel.loginBasicAuth(username, password) },
                modifier = Modifier.weight(2f).height(48.dp),
                enabled = username.isNotBlank() && password.isNotBlank() && !isLoading,
                shape = RoundedCornerShape(10.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = AntiqueBrass,
                    contentColor = Color.White,
                ),
            ) {
                AnimatedContent(
                    targetState = isLoading,
                    transitionSpec = { fadeIn(tween(150)) togetherWith fadeOut(tween(150)) },
                    label = "login_button",
                ) { loading ->
                    if (loading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            color = Color.White,
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text("Sign in", style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
        }
    }
}

// ── OAuth button ──────────────────────────────────────────────────────────────

@Composable
private fun OAuthButton(
    label: String,
    iconContent: @Composable () -> Unit,
    onClick: () -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp),
        shape = RoundedCornerShape(10.dp),
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            MaterialTheme.colorScheme.outline,
        ),
        contentPadding = PaddingValues(horizontal = 16.dp),
    ) {
        iconContent()
        Spacer(Modifier.width(10.dp))
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

// ── Connected server chip ─────────────────────────────────────────────────────

@Composable
private fun ConnectedServerChip(
    url: String,
    onChangeServer: () -> Unit,
) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(androidx.compose.foundation.shape.CircleShape)
                .background(SuccessGreen),
        )
        Text(
            text = url,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
        TextButton(
            onClick = onChangeServer,
            contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp),
        ) {
            Text(
                "Change",
                style = MaterialTheme.typography.labelSmall,
                color = AntiqueBrass,
            )
        }
    }
}

// ── Or divider ────────────────────────────────────────────────────────────────

@Composable
private fun OrDivider() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        HorizontalDivider(
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
        Text(
            text = "or",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        HorizontalDivider(
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
    }
}

// ── Loading views ─────────────────────────────────────────────────────────────

@Composable
private fun ConnectingView() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            CircularProgressIndicator(
                color = AntiqueBrass,
                modifier = Modifier.size(36.dp),
                strokeWidth = 3.dp,
            )
            Text(
                "Connecting to server…",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun AuthenticatingView() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            CircularProgressIndicator(
                color = AntiqueBrass,
                modifier = Modifier.size(36.dp),
                strokeWidth = 3.dp,
            )
            Text(
                "Signing you in…",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// ── Error view ────────────────────────────────────────────────────────────────

@Composable
private fun ErrorView(
    message: String,
    isConnectionError: Boolean,
    onRetry: () -> Unit,
    onBack: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(MaterialTheme.colorScheme.errorContainer),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.size(32.dp),
                )
            }

            Text(
                text = if (isConnectionError) "Connection Failed" else "Sign In Failed",
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
            )

            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )

            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Button(
                    onClick = onRetry,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = AntiqueBrass),
                ) {
                    Text(if (isConnectionError) "Try Again" else "Back to Login")
                }

                if (!isConnectionError) {
                    OutlinedButton(
                        onClick = onBack,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Icon(
                            Icons.Default.ArrowBack,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text("Change Server")
                    }
                }
            }
        }
    }
}

// ── Google icon placeholder (SVG path would normally live here) ───────────────

@Composable
private fun GoogleIconSvg(modifier: Modifier = Modifier) {
    // Simple G placeholder using text — replace with actual Google icon vector
    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = "G",
            style = MaterialTheme.typography.labelLarge.copy(
                fontWeight = FontWeight.Bold,
                color = Color(0xFF4285F4),
            ),
        )
    }
}
