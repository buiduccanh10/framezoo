package com.framezoo.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.framezoo.tv.R
import com.framezoo.tv.ui.features.auth.AuthAction
import com.framezoo.tv.ui.features.auth.AuthUiState

@Composable
internal fun AuthScreen(
    uiState: AuthUiState,
    userId: String? = null,
    userNickname: String? = null,
    colorA: String? = null,
    colorB: String? = null,
    icon: String? = null,
    onAction: (AuthAction) -> Unit,
    onLogout: () -> Unit = {},
    onBack: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    var isRegisterMode by remember { mutableStateOf(false) }

    val passwordRequester = remember { FocusRequester() }
    val submitAction = remember { FocusRequester() }
    val backRequester = remember { FocusRequester() }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.9f)),
        contentAlignment = Alignment.Center
    ) {
        // Back Button Top-Left
        Box(
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(32.dp)
        ) {
            TvButton(
                label = t("discover.page.back"),
                icon = R.drawable.desktop_chevron_left,
                navigation = true,
                modifier = Modifier.focusRequester(backRequester)
            ) {
                onBack()
            }
        }

        Box(
            modifier = Modifier
                .widthIn(min = 440.dp, max = 520.dp)
                .clip(RoundedCornerShape(22.dp))
                .background(colors["background.main"])
                .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(22.dp))
                .padding(horizontal = 36.dp, vertical = 32.dp)
        ) {
            if (userId != null) {
                // Logged in User Profile Card
                Column(
                    verticalArrangement = Arrangement.spacedBy(18.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Image(
                        painter = painterResource(R.drawable.framezoo_brand),
                        contentDescription = "FrameZoo",
                        modifier = Modifier.width(160.dp).height(46.dp)
                    )

                    UserAvatar(
                        colorA = colorA,
                        colorB = colorB,
                        icon = icon,
                        size = 72.dp,
                        fontSize = 32.sp
                    )

                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = userNickname?.takeIf { it.isNotBlank() } ?: userId,
                            color = colors["type.emphasis"],
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = if (userNickname != null && userNickname != userId) "ID: $userId" else t("settings.account.title"),
                            color = colors["type.secondary"],
                            fontSize = 14.sp
                        )
                    }

                    Spacer(Modifier.height(8.dp))

                    TvButton(
                        label = t("navigation.menu.logout"),
                        icon = R.drawable.desktop_logout,
                        accent = true,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        onLogout()
                    }
                }
            } else {
                // Login / Register Form Card
                Column(
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Image(
                        painter = painterResource(R.drawable.framezoo_brand),
                        contentDescription = "FrameZoo",
                        modifier = Modifier.width(150.dp).height(42.dp)
                    )

                    // Tab Pill Switcher (Sign In vs Register)
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(50))
                            .background(colors["background.secondary"].copy(alpha = 0.6f))
                            .padding(4.dp),
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        TvButton(
                            label = t("auth.login.title"),
                            selected = !isRegisterMode,
                            navigation = true
                        ) {
                            isRegisterMode = false
                            onAction(AuthAction.ClearError)
                        }
                        TvButton(
                            label = t("auth.register.submit"),
                            selected = isRegisterMode,
                            navigation = true
                        ) {
                            isRegisterMode = true
                            onAction(AuthAction.ClearError)
                        }
                    }

                    // Title & Description
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = if (isRegisterMode) t("auth.register.passwordInput.title") else t("auth.login.title"),
                            color = colors["type.emphasis"],
                            fontSize = 22.sp,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center
                        )
                        Text(
                            text = if (isRegisterMode) t("auth.register.passwordInput.description") else t("auth.login.description"),
                            color = colors["type.secondary"],
                            fontSize = 13.sp,
                            textAlign = TextAlign.Center,
                            lineHeight = 18.sp
                        )
                    }

                    // Error Banner
                    if (!uiState.errorMessage.isNullOrBlank()) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(colors["type.danger"].copy(alpha = 0.15f))
                                .border(BorderStroke(1.dp, colors["type.danger"].copy(alpha = 0.35f)), RoundedCornerShape(10.dp))
                                .padding(horizontal = 14.dp, vertical = 10.dp)
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Icon(
                                    painter = painterResource(R.drawable.desktop_warning),
                                    contentDescription = null,
                                    tint = colors["type.danger"],
                                    modifier = Modifier.size(16.dp)
                                )
                                Text(
                                    text = uiState.errorMessage,
                                    color = colors["type.danger"],
                                    fontSize = 13.sp
                                )
                            }
                        }
                    }

                    // Identifier / Nickname Field
                    OutlinedTextField(
                        value = uiState.name,
                        onValueChange = { onAction(AuthAction.NameChanged(it)) },
                        label = { Text(if (isRegisterMode) t("auth.register.nicknameLabel") else t("auth.login.identifierLabel")) },
                        placeholder = { Text(if (isRegisterMode) t("auth.register.nicknamePlaceholder") else t("auth.login.identifierLabel")) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                        keyboardActions = KeyboardActions(onNext = { passwordRequester.requestFocus() }),
                        colors = tvFieldColors(),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    )

                    // Password Field
                    OutlinedTextField(
                        value = uiState.password,
                        onValueChange = { onAction(AuthAction.PasswordChanged(it)) },
                        label = { Text(if (isRegisterMode) t("auth.register.passwordLabel") else t("auth.login.passwordLabel")) },
                        placeholder = { Text(if (isRegisterMode) t("auth.register.passwordPlaceholder") else t("auth.login.passwordLabel")) },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { submitAction.requestFocus() }),
                        colors = tvFieldColors(),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(passwordRequester)
                    )

                    Spacer(Modifier.height(4.dp))

                    // Submit Button
                    TvButton(
                        label = if (isRegisterMode) t("auth.register.submit") else t("auth.login.submit"),
                        accent = true,
                        loading = uiState.isLoading,
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(submitAction)
                    ) {
                        if (isRegisterMode) onAction(AuthAction.SubmitRegister) else onAction(AuthAction.SubmitLogin)
                    }

                    // Switcher Toggle Button
                    TvButton(
                        label = if (isRegisterMode) {
                            t("auth.hasAccount").replace(Regex("<[^>]*>"), "")
                        } else {
                            t("auth.createAccount").replace(Regex("<[^>]*>"), "")
                        },
                        navigation = true
                    ) {
                        isRegisterMode = !isRegisterMode
                        onAction(AuthAction.ClearError)
                    }
                }
            }
        }
    }
}

@Composable
internal fun AuthScreen(state: FrameZooState) {
    AuthScreen(
        uiState = AuthUiState(
            name = state.loginName,
            password = state.loginPassword,
            isLoading = state.busy,
            errorMessage = state.error.ifBlank { null }
        ),
        userId = state.store.userId,
        userNickname = state.userNickname,
        colorA = state.userProfileColorA,
        colorB = state.userProfileColorB,
        icon = state.userProfileIcon,
        onAction = { action ->
            when (action) {
                is AuthAction.NameChanged -> state.loginName = action.value
                is AuthAction.PasswordChanged -> state.loginPassword = action.value
                is AuthAction.SubmitLogin -> state.login()
                is AuthAction.SubmitRegister -> state.login()
                is AuthAction.ClearError -> state.error = ""
            }
        },
        onLogout = { state.logout() },
        onBack = { state.back() }
    )
}
