package com.framezoo.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.framezoo.tv.R
import com.framezoo.tv.data.repository.AuthRepository
import com.framezoo.tv.model.AccountProfile
import com.framezoo.tv.model.OtpChallenge
import com.framezoo.tv.model.UserIcon
import com.framezoo.tv.model.UserIconGraphic
import com.framezoo.tv.model.parseHexColor
import com.framezoo.tv.ui.features.auth.*
import kotlinx.coroutines.delay

@Composable
internal fun AuthScreen(
    uiState: AuthUiState,
    onAction: (AuthAction) -> Unit,
    onBack: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val backRequester = remember { FocusRequester() }
    val scrollState = rememberScrollState()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.92f)),
        contentAlignment = Alignment.Center
    ) {
        // Back Button Top-Left
        Box(
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(28.dp)
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
                .widthIn(min = 480.dp, max = 560.dp)
                .padding(vertical = 18.dp)
                .clip(RoundedCornerShape(22.dp))
                .background(colors["background.main"])
                .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(22.dp))
                .padding(horizontal = 32.dp, vertical = 20.dp)
        ) {
            Column(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(scrollState)
            ) {
                Image(
                    painter = painterResource(R.drawable.framezoo_brand),
                    contentDescription = "FrameZoo",
                    modifier = Modifier.width(126.dp).height(34.dp)
                )

                    // Error Banner
                    if (!uiState.errorMessage.isNullOrBlank()) {
                        AuthErrorBanner(uiState.errorMessage)
                    }

                    // Info Banner
                    if (!uiState.infoMessage.isNullOrBlank()) {
                        Text(
                            text = t(uiState.infoMessage),
                            color = colors["type.secondary"],
                            fontSize = 13.sp,
                            textAlign = TextAlign.Center
                        )
                    }

                    when (uiState.mode) {
                        AuthMode.LOGIN -> LoginStepContent(uiState, onAction)
                        AuthMode.REGISTER -> when (uiState.registerStep) {
                            RegisterStep.CREDENTIALS -> RegisterCredentialsStepContent(uiState, onAction)
                            RegisterStep.PROFILE -> RegisterProfileStepContent(uiState, onAction)
                            RegisterStep.OTP -> {
                                val challenge = uiState.otpChallenge
                                if (challenge != null) {
                                    TvOtpVerificationCard(
                                        title = t("auth.otp.registrationTitle"),
                                        description = t("auth.otp.registrationDescription"),
                                        challenge = challenge,
                                        code = uiState.otpCode,
                                        isLoading = uiState.isLoading,
                                        submitLabel = t("auth.otp.continue"),
                                        email = uiState.email,
                                        onCodeChanged = { onAction(AuthAction.OtpCodeChanged(it)) },
                                        onVerify = { onAction(AuthAction.NextRegisterStep) },
                                        onResend = { onAction(AuthAction.ResendOtp) },
                                        onBack = { onAction(AuthAction.BackStep) }
                                    )
                                }
                            }
                        }
                        AuthMode.RECOVERY -> RecoveryStepContent(uiState, onAction)
                    }
                }
            }
        }
    }

@Composable
private fun AuthErrorBanner(message: String) {
    val colors = LocalFrameZooColors.current
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
                text = t(message),
                color = colors["type.danger"],
                fontSize = 13.sp
            )
        }
    }
}

@Composable
private fun LoginStepContent(
    uiState: AuthUiState,
    onAction: (AuthAction) -> Unit
) {
    val colors = LocalFrameZooColors.current
    val passwordRequester = remember { FocusRequester() }
    val submitRequester = remember { FocusRequester() }

    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            text = t("auth.login.title"),
            color = colors["type.emphasis"],
            fontSize = 21.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center
        )
        Text(
            text = t("auth.login.description"),
            color = colors["type.secondary"],
            fontSize = 13.sp,
            textAlign = TextAlign.Center
        )
    }

    OutlinedTextField(
        value = uiState.name,
        onValueChange = { onAction(AuthAction.NameChanged(it)) },
        label = { Text(t("auth.login.identifierLabel")) },
        placeholder = { Text(t("auth.login.identifierPlaceholder")) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        keyboardActions = KeyboardActions(onNext = { passwordRequester.requestFocus() }),
        colors = tvFieldColors(),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth()
    )

    TvPasswordField(
        value = uiState.password,
        onValueChange = { onAction(AuthAction.PasswordChanged(it)) },
        label = t("auth.login.passwordLabel"),
        placeholder = t("auth.login.passwordPlaceholder"),
        showPassword = uiState.showPassword,
        onToggleVisibility = { onAction(AuthAction.ToggleShowPassword) },
        imeAction = ImeAction.Done,
        onImeAction = { submitRequester.requestFocus() },
        modifier = Modifier.fillMaxWidth().focusRequester(passwordRequester)
    )

    // Remember Me & Forgot Password Row (matching PasswordInputPart.tsx lines 274-305)
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        TvCheckboxRow(
            checked = uiState.rememberMe,
            label = t("auth.login.rememberMe"),
            onToggle = { onAction(AuthAction.ToggleRememberMe) }
        )
        TvButton(
            label = t("auth.otp.forgotLink"),
            navigation = true
        ) {
            onAction(AuthAction.ModeChanged(AuthMode.RECOVERY))
        }
    }

    TvButton(
        label = t("auth.login.submit"),
        accent = true,
        loading = uiState.isLoading,
        modifier = Modifier.fillMaxWidth().focusRequester(submitRequester)
    ) {
        onAction(AuthAction.SubmitLogin)
    }

    TvButton(
        label = t("auth.createAccount").replace(Regex("<[^>]*>"), ""),
        navigation = true
    ) {
        onAction(AuthAction.ModeChanged(AuthMode.REGISTER))
    }
}

@Composable
private fun RegisterCredentialsStepContent(
    uiState: AuthUiState,
    onAction: (AuthAction) -> Unit
) {
    val colors = LocalFrameZooColors.current
    val emailRequester = remember { FocusRequester() }
    val passwordRequester = remember { FocusRequester() }
    val confirmRequester = remember { FocusRequester() }
    val submitRequester = remember { FocusRequester() }

    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            text = t("auth.register.passwordInput.title"),
            color = colors["type.emphasis"],
            fontSize = 21.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center
        )
        Text(
            text = t("auth.register.passwordInput.description"),
            color = colors["type.secondary"],
            fontSize = 13.sp,
            textAlign = TextAlign.Center
        )
    }

    OutlinedTextField(
        value = uiState.name,
        onValueChange = { onAction(AuthAction.NameChanged(it)) },
        label = { Text(t("auth.register.nicknameLabel")) },
        placeholder = { Text(t("auth.register.nicknamePlaceholder")) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        keyboardActions = KeyboardActions(onNext = { emailRequester.requestFocus() }),
        colors = tvFieldColors(),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth()
    )

    OutlinedTextField(
        value = uiState.email,
        onValueChange = { onAction(AuthAction.EmailChanged(it)) },
        label = { Text(t("auth.register.emailLabel")) },
        placeholder = { Text(t("auth.register.emailPlaceholder")) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        keyboardActions = KeyboardActions(onNext = { passwordRequester.requestFocus() }),
        colors = tvFieldColors(),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth().focusRequester(emailRequester)
    )

    TvPasswordField(
        value = uiState.password,
        onValueChange = { onAction(AuthAction.PasswordChanged(it)) },
        label = t("auth.register.passwordLabel"),
        placeholder = t("auth.register.passwordPlaceholder"),
        showPassword = uiState.showPassword,
        onToggleVisibility = { onAction(AuthAction.ToggleShowPassword) },
        imeAction = ImeAction.Next,
        onImeAction = { confirmRequester.requestFocus() },
        modifier = Modifier.fillMaxWidth().focusRequester(passwordRequester)
    )

    TvPasswordField(
        value = uiState.confirmPassword,
        onValueChange = { onAction(AuthAction.ConfirmPasswordChanged(it)) },
        label = t("auth.register.confirmPasswordLabel"),
        placeholder = t("auth.register.confirmPasswordPlaceholder"),
        showPassword = uiState.showConfirmPassword,
        onToggleVisibility = { onAction(AuthAction.ToggleShowConfirmPassword) },
        imeAction = ImeAction.Done,
        onImeAction = { submitRequester.requestFocus() },
        modifier = Modifier.fillMaxWidth().focusRequester(confirmRequester)
    )

    TvCheckboxRow(
        checked = uiState.legalAccepted,
        label = t("auth.register.legalConsent").replace(Regex("<[^>]*>"), ""),
        onToggle = { onAction(AuthAction.ToggleLegalAccepted) }
    )

    TvButton(
        label = t("auth.register.information.next"),
        accent = true,
        loading = uiState.isLoading,
        modifier = Modifier.fillMaxWidth().focusRequester(submitRequester)
    ) {
        onAction(AuthAction.NextRegisterStep)
    }

    TvButton(
        label = t("auth.hasAccount").replace(Regex("<[^>]*>"), ""),
        navigation = true
    ) {
        onAction(AuthAction.ModeChanged(AuthMode.LOGIN))
    }
}

@Composable
private fun RegisterProfileStepContent(
    uiState: AuthUiState,
    onAction: (AuthAction) -> Unit
) {
    val colors = LocalFrameZooColors.current

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = t("auth.register.information.title"),
                color = colors["type.emphasis"],
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = t("auth.register.information.header"),
                color = colors["type.secondary"],
                fontSize = 12.sp
            )
        }
        UserAvatar(
            profile = AccountProfile(
                colorA = uiState.colorA,
                colorB = uiState.colorB,
                icon = uiState.userIcon,
                nickname = uiState.name
            ),
            size = 54.dp,
            fontSize = 24.sp
        )
    }

    TvColorPicker(
        label = t("auth.register.information.color1"),
        selectedColor = uiState.colorA,
        onColorSelected = { onAction(AuthAction.ColorAChanged(it)) }
    )

    TvColorPicker(
        label = t("auth.register.information.color2"),
        selectedColor = uiState.colorB,
        onColorSelected = { onAction(AuthAction.ColorBChanged(it)) }
    )

    TvIconPicker(
        label = t("auth.register.information.icon"),
        selectedIcon = uiState.userIcon,
        activeTab = uiState.iconPickerTab,
        onTabChanged = { onAction(AuthAction.IconPickerTabChanged(it)) },
        onIconSelected = { onAction(AuthAction.UserIconChanged(it)) }
    )

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        TvButton(
            label = t("discover.page.back"),
            navigation = true,
            modifier = Modifier.weight(1f)
        ) {
            onAction(AuthAction.BackStep)
        }
        TvButton(
            label = t("auth.register.information.next"),
            accent = true,
            loading = uiState.isLoading,
            modifier = Modifier.weight(1f)
        ) {
            onAction(AuthAction.NextRegisterStep)
        }
    }
}

@Composable
private fun RecoveryStepContent(
    uiState: AuthUiState,
    onAction: (AuthAction) -> Unit
) {
    val colors = LocalFrameZooColors.current
    when (uiState.recoveryStep) {
        RecoveryStep.EMAIL -> {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = t("auth.otp.forgotTitle"),
                    color = colors["type.emphasis"],
                    fontSize = 21.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center
                )
                Text(
                    text = t("auth.otp.forgotDescription"),
                    color = colors["type.secondary"],
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center
                )
            }
            OutlinedTextField(
                value = uiState.email,
                onValueChange = { onAction(AuthAction.EmailChanged(it)) },
                label = { Text(t("auth.register.emailLabel")) },
                placeholder = { Text(t("auth.register.emailPlaceholder")) },
                singleLine = true,
                colors = tvFieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                TvButton(
                    label = t("discover.page.back"),
                    navigation = true,
                    modifier = Modifier.weight(1f)
                ) {
                    onAction(AuthAction.BackStep)
                }
                TvButton(
                    label = t("auth.otp.send"),
                    accent = true,
                    loading = uiState.isLoading,
                    modifier = Modifier.weight(1f)
                ) {
                    onAction(AuthAction.SubmitRecovery)
                }
            }
        }
        RecoveryStep.OTP -> {
            val challenge = uiState.otpChallenge
            if (challenge != null) {
                TvOtpVerificationCard(
                    title = t("auth.otp.resetTitle"),
                    description = t("auth.otp.resetDescription"),
                    challenge = challenge,
                    code = uiState.otpCode,
                    isLoading = uiState.isLoading,
                    submitLabel = t("auth.otp.continue"),
                    email = uiState.email,
                    onCodeChanged = { onAction(AuthAction.OtpCodeChanged(it)) },
                    onVerify = { onAction(AuthAction.SubmitRecovery) },
                    onResend = { onAction(AuthAction.ResendOtp) },
                    onBack = { onAction(AuthAction.BackStep) }
                )
            }
        }
        RecoveryStep.NEW_PASSWORD -> {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = t("auth.otp.newPasswordTitle"),
                    color = colors["type.emphasis"],
                    fontSize = 21.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center
                )
                Text(
                    text = t("auth.otp.newPasswordDescription"),
                    color = colors["type.secondary"],
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center
                )
            }
            TvPasswordField(
                value = uiState.password,
                onValueChange = { onAction(AuthAction.PasswordChanged(it)) },
                label = t("auth.login.passwordLabel"),
                placeholder = t("auth.register.passwordPlaceholder"),
                showPassword = uiState.showPassword,
                onToggleVisibility = { onAction(AuthAction.ToggleShowPassword) },
                imeAction = ImeAction.Next,
                onImeAction = {},
                modifier = Modifier.fillMaxWidth()
            )
            TvPasswordField(
                value = uiState.confirmPassword,
                onValueChange = { onAction(AuthAction.ConfirmPasswordChanged(it)) },
                label = t("auth.register.confirmPasswordLabel"),
                placeholder = t("auth.register.confirmPasswordPlaceholder"),
                showPassword = uiState.showConfirmPassword,
                onToggleVisibility = { onAction(AuthAction.ToggleShowConfirmPassword) },
                imeAction = ImeAction.Done,
                onImeAction = {},
                modifier = Modifier.fillMaxWidth()
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                TvButton(
                    label = t("discover.page.back"),
                    navigation = true,
                    modifier = Modifier.weight(1f)
                ) {
                    onAction(AuthAction.BackStep)
                }
                TvButton(
                    label = t("auth.otp.finish"),
                    accent = true,
                    loading = uiState.isLoading,
                    modifier = Modifier.weight(1f)
                ) {
                    onAction(AuthAction.SubmitRecovery)
                }
            }
        }
    }
}

@Composable
internal fun TvPasswordField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    placeholder: String,
    showPassword: Boolean,
    onToggleVisibility: () -> Unit,
    imeAction: ImeAction,
    onImeAction: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            label = { Text(label) },
            placeholder = { Text(placeholder) },
            singleLine = true,
            visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(imeAction = imeAction),
            keyboardActions = KeyboardActions(
                onNext = { onImeAction() },
                onDone = { onImeAction() }
            ),
            colors = tvFieldColors(),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.weight(1f)
        )
        TvButton(
            label = "",
            navigation = true,
            icon = if (showPassword) R.drawable.desktop_eye_slash else R.drawable.desktop_eye,
            onClick = onToggleVisibility
        )
    }
}

@Composable
internal fun TvCheckboxRow(
    checked: Boolean,
    label: String,
    onToggle: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    var focused by remember { mutableStateOf(false) }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (focused) Color.White.copy(alpha = 0.08f) else Color.Transparent)
            .border(
                width = 1.dp,
                color = if (focused) Color.White.copy(alpha = 0.7f) else Color.Transparent,
                shape = RoundedCornerShape(8.dp)
            )
            .onFocusChanged { focused = it.isFocused }
            .onPreviewKeyEvent { event ->
                if (event.type == KeyEventType.KeyDown &&
                    (event.key.nativeKeyCode == android.view.KeyEvent.KEYCODE_DPAD_CENTER ||
                        event.key.nativeKeyCode == android.view.KeyEvent.KEYCODE_ENTER)
                ) {
                    onToggle()
                    true
                } else false
            }
            .focusable()
            .clickable { onToggle() }
            .padding(horizontal = 8.dp, vertical = 6.dp)
    ) {
        Box(
            modifier = Modifier
                .size(18.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(if (checked) colors["type.logo"] else colors["search.background"])
                .border(
                    width = 1.dp,
                    color = if (checked) colors["type.logo"] else colors["authentication.border"],
                    shape = RoundedCornerShape(4.dp)
                ),
            contentAlignment = Alignment.Center
        ) {
            if (checked) {
                Icon(
                    painter = painterResource(R.drawable.desktop_checkmark),
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(12.dp)
                )
            }
        }
        Text(
            text = label,
            color = colors["type.secondary"],
            fontSize = 13.sp
        )
    }
}

/**
 * Mirrors `ColorPicker.tsx` from `framezoo-desktop`.
 */
@Composable
internal fun TvColorPicker(
    label: String,
    selectedColor: String,
    onColorSelected: (String) -> Unit
) {
    val colors = LocalFrameZooColors.current
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = label,
            color = colors["type.emphasis"],
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            UserIcon.AVATAR_COLORS.forEach { hex ->
                val isSelected = selectedColor.equals(hex, ignoreCase = true)
                var focused by remember { mutableStateOf(false) }
                val swatchColor = parseHexColor(hex, Color(0xFF0A54FF))

                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(38.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(swatchColor)
                        .border(
                            width = 2.dp,
                            color = when {
                                focused -> Color.White
                                isSelected -> Color.White.copy(alpha = 0.85f)
                                else -> Color.Transparent
                            },
                            shape = RoundedCornerShape(8.dp)
                        )
                        .onFocusChanged { focused = it.isFocused }
                        .onPreviewKeyEvent { event ->
                            if (event.type == KeyEventType.KeyDown &&
                                (event.key.nativeKeyCode == android.view.KeyEvent.KEYCODE_DPAD_CENTER ||
                                    event.key.nativeKeyCode == android.view.KeyEvent.KEYCODE_ENTER)
                            ) {
                                onColorSelected(hex)
                                true
                            } else false
                        }
                        .focusable()
                        .clickable { onColorSelected(hex) },
                    contentAlignment = Alignment.Center
                ) {
                    if (isSelected) {
                        Icon(
                            painter = painterResource(R.drawable.desktop_checkmark),
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
            }
        }
    }
}

/**
 * Mirrors `IconPicker.tsx` from `framezoo-desktop` (Classic & Emoji tabs + 6-column grid).
 */
@Composable
internal fun TvIconPicker(
    label: String,
    selectedIcon: UserIcon,
    activeTab: IconPickerTab,
    onTabChanged: (IconPickerTab) -> Unit,
    onIconSelected: (UserIcon) -> Unit
) {
    val colors = LocalFrameZooColors.current
    val icons = if (activeTab == IconPickerTab.CLASSIC) UserIcon.CLASSIC_ICONS else UserIcon.EMOJI_ICONS

    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = label,
                color = colors["type.emphasis"],
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold
            )
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                TvButton(
                    label = t("settings.account.profile.iconTabs.classic"),
                    selected = activeTab == IconPickerTab.CLASSIC,
                    navigation = true
                ) {
                    onTabChanged(IconPickerTab.CLASSIC)
                }
                TvButton(
                    label = t("settings.account.profile.iconTabs.emoji"),
                    selected = activeTab == IconPickerTab.EMOJI,
                    navigation = true
                ) {
                    onTabChanged(IconPickerTab.EMOJI)
                }
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            icons.chunked(6).forEach { rowIcons ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    rowIcons.forEach { icon ->
                        val isSelected = selectedIcon == icon
                        var focused by remember { mutableStateOf(false) }

                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .height(38.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(colors["search.background"])
                                .border(
                                    width = 2.dp,
                                    color = when {
                                        focused -> Color.White
                                        isSelected -> colors["type.logo"]
                                        else -> Color.Transparent
                                    },
                                    shape = RoundedCornerShape(8.dp)
                                )
                                .onFocusChanged { focused = it.isFocused }
                                .onPreviewKeyEvent { event ->
                                    if (event.type == KeyEventType.KeyDown &&
                                        (event.key.nativeKeyCode == android.view.KeyEvent.KEYCODE_DPAD_CENTER ||
                                            event.key.nativeKeyCode == android.view.KeyEvent.KEYCODE_ENTER)
                                    ) {
                                        onIconSelected(icon)
                                        true
                                    } else false
                                }
                                .focusable()
                                .clickable { onIconSelected(icon) },
                            contentAlignment = Alignment.Center
                        ) {
                            when (val graphic = icon.toGraphic()) {
                                is UserIconGraphic.Emoji -> Text(
                                    text = graphic.char,
                                    fontSize = 18.sp
                                )
                                is UserIconGraphic.VectorRes -> Icon(
                                    painter = painterResource(graphic.resId),
                                    contentDescription = icon.key,
                                    tint = Color.White,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                    }
                    repeat(6 - rowIcons.size) {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/**
 * Mirrors `OtpVerificationPart.tsx` from `framezoo-desktop`.
 */
@Composable
internal fun TvOtpVerificationCard(
    title: String,
    description: String,
    challenge: OtpChallenge,
    code: String,
    isLoading: Boolean,
    submitLabel: String,
    email: String? = null,
    onCodeChanged: (String) -> Unit,
    onVerify: () -> Unit,
    onResend: () -> Unit,
    onBack: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    var expiresIn by remember(challenge.challengeId) { mutableIntStateOf(challenge.expiresIn) }
    var resendCooldown by remember(challenge.challengeId) { mutableIntStateOf(challenge.resendAfter) }

    LaunchedEffect(challenge.challengeId) {
        while (expiresIn > 0 || resendCooldown > 0) {
            delay(1000L)
            if (expiresIn > 0) expiresIn--
            if (resendCooldown > 0) resendCooldown--
        }
    }

    fun formatTimer(seconds: Int): String {
        val mins = seconds / 60
        val secs = seconds % 60
        return "$mins:${secs.toString().padStart(2, '0')}"
    }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Text(
            text = title,
            color = colors["type.emphasis"],
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center
        )
        if (!email.isNullOrBlank()) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(
                    text = t("auth.otp.sentToPrompt"),
                    color = colors["type.secondary"],
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center
                )
                Text(
                    text = email,
                    color = colors["type.emphasis"],
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis
                )
            }
        } else {
            Text(
                text = description,
                color = colors["type.secondary"],
                fontSize = 13.sp,
                textAlign = TextAlign.Center
            )
        }
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .background(Color(0x26F59E0B))
                .border(BorderStroke(1.dp, Color(0x4DF59E0B)), RoundedCornerShape(8.dp))
                .padding(horizontal = 10.dp, vertical = 4.dp)
        ) {
            Text(
                text = "⚠️ " + t("auth.otp.spamNotice"),
                color = Color(0xFFFCD34D),
                fontSize = 11.sp,
                textAlign = TextAlign.Center
            )
        }

        OutlinedTextField(
            value = code,
            onValueChange = onCodeChanged,
            label = { Text(t("auth.otp.codeLabel")) },
            placeholder = { Text("000000") },
            singleLine = true,
            colors = tvFieldColors(),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = if (expiresIn > 0) {
                    t("auth.otp.expiresIn", "time" to formatTimer(expiresIn))
                } else {
                    t("auth.otp.expired")
                },
                color = colors["type.secondary"],
                fontSize = 12.sp
            )
            TvButton(
                label = if (resendCooldown > 0) {
                    t("auth.otp.resendIn", "seconds" to resendCooldown)
                } else {
                    t("auth.otp.resend")
                },
                navigation = true
            ) {
                if (resendCooldown == 0 && !isLoading) {
                    onResend()
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            TvButton(
                label = t("discover.page.back"),
                navigation = true,
                modifier = Modifier.weight(1f)
            ) {
                onBack()
            }
            TvButton(
                label = submitLabel,
                accent = true,
                loading = isLoading,
                modifier = Modifier.weight(1f)
            ) {
                onVerify()
            }
        }
    }
}

@Composable
internal fun AuthScreen(state: FrameZooState) {
    LaunchedEffect(state.isLoggedIn) {
        if (state.isLoggedIn) {
            state.page = "settings"
        }
    }

    val repo = remember(state.store, state.backend) {
        AuthRepository(state.store, state.backend)
    }
    val viewModel: AuthViewModel = viewModel(
        key = "auth_vm_${state.userId}",
        factory = AuthViewModel.provideFactory(repo)
    )
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(uiState.isSuccess) {
        if (uiState.isSuccess) {
            state.completeAuthSuccess()
        }
    }

    AuthScreen(
        uiState = uiState,
        onAction = viewModel::onAction,
        onBack = { state.back() }
    )
}
