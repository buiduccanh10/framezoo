package com.framezoo.tv.ui.features.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.framezoo.tv.auth.Auth
import com.framezoo.tv.data.repository.AuthRepository
import com.framezoo.tv.model.OtpChallenge
import com.framezoo.tv.model.UserIcon
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class AuthMode {
    LOGIN,
    REGISTER,
    RECOVERY
}

enum class RegisterStep {
    CREDENTIALS,
    PROFILE,
    OTP
}

enum class RecoveryStep {
    EMAIL,
    OTP,
    NEW_PASSWORD
}

enum class IconPickerTab {
    CLASSIC,
    EMOJI
}

data class AuthUiState(
    val mode: AuthMode = AuthMode.LOGIN,
    val registerStep: RegisterStep = RegisterStep.CREDENTIALS,
    val recoveryStep: RecoveryStep = RecoveryStep.EMAIL,
    val name: String = "",
    val email: String = "",
    val password: String = "",
    val confirmPassword: String = "",
    val rememberMe: Boolean = false,
    val legalAccepted: Boolean = false,
    val showPassword: Boolean = false,
    val showConfirmPassword: Boolean = false,
    val colorA: String = UserIcon.INITIAL_COLOR,
    val colorB: String = UserIcon.INITIAL_COLOR,
    val userIcon: UserIcon = UserIcon.INITIAL_ICON,
    val iconPickerTab: IconPickerTab = IconPickerTab.CLASSIC,
    val otpChallenge: OtpChallenge? = null,
    val otpCode: String = "",
    val recoveryActionToken: String? = null,
    val infoMessage: String? = null,
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val isSuccess: Boolean = false
)

sealed interface AuthAction {
    data class ModeChanged(val mode: AuthMode) : AuthAction
    data class NameChanged(val value: String) : AuthAction
    data class EmailChanged(val value: String) : AuthAction
    data class PasswordChanged(val value: String) : AuthAction
    data class ConfirmPasswordChanged(val value: String) : AuthAction
    data object ToggleRememberMe : AuthAction
    data object ToggleLegalAccepted : AuthAction
    data object ToggleShowPassword : AuthAction
    data object ToggleShowConfirmPassword : AuthAction
    data class ColorAChanged(val color: String) : AuthAction
    data class ColorBChanged(val color: String) : AuthAction
    data class UserIconChanged(val icon: UserIcon) : AuthAction
    data class IconPickerTabChanged(val tab: IconPickerTab) : AuthAction
    data class OtpCodeChanged(val code: String) : AuthAction
    data object SubmitLogin : AuthAction
    data object SubmitRegister : AuthAction
    data object NextRegisterStep : AuthAction
    data object BackStep : AuthAction
    data object ResendOtp : AuthAction
    data object SubmitRecovery : AuthAction
    data object ClearError : AuthAction
}

class AuthViewModel(
    private val repo: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        AuthUiState(
            name = if (repo.store.rememberLogin) repo.store.rememberedIdentifier.orEmpty() else "",
            password = if (repo.store.rememberLogin) repo.store.rememberedPassword.orEmpty() else "",
            rememberMe = repo.store.rememberLogin
        )
    )
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    fun onAction(action: AuthAction) {
        when (action) {
            is AuthAction.ModeChanged -> _uiState.update {
                it.copy(
                    mode = action.mode,
                    registerStep = RegisterStep.CREDENTIALS,
                    recoveryStep = RecoveryStep.EMAIL,
                    errorMessage = null,
                    infoMessage = null,
                    otpChallenge = null,
                    otpCode = ""
                )
            }
            is AuthAction.NameChanged -> _uiState.update { state ->
                val cleaned = if (state.mode == AuthMode.REGISTER) action.value.replace(Regex("\\s"), "") else action.value
                state.copy(name = cleaned, errorMessage = null)
            }
            is AuthAction.EmailChanged -> _uiState.update { it.copy(email = action.value, errorMessage = null) }
            is AuthAction.PasswordChanged -> _uiState.update { it.copy(password = action.value, errorMessage = null) }
            is AuthAction.ConfirmPasswordChanged -> _uiState.update { it.copy(confirmPassword = action.value, errorMessage = null) }
            is AuthAction.ToggleRememberMe -> _uiState.update {
                val next = !it.rememberMe
                if (!next) repo.store.clearRememberedCredentials()
                it.copy(rememberMe = next)
            }
            is AuthAction.ToggleLegalAccepted -> _uiState.update { it.copy(legalAccepted = !it.legalAccepted, errorMessage = null) }
            is AuthAction.ToggleShowPassword -> _uiState.update { it.copy(showPassword = !it.showPassword) }
            is AuthAction.ToggleShowConfirmPassword -> _uiState.update { it.copy(showConfirmPassword = !it.showConfirmPassword) }
            is AuthAction.ColorAChanged -> _uiState.update { it.copy(colorA = action.color) }
            is AuthAction.ColorBChanged -> _uiState.update { it.copy(colorB = action.color) }
            is AuthAction.UserIconChanged -> _uiState.update { it.copy(userIcon = action.icon) }
            is AuthAction.IconPickerTabChanged -> _uiState.update { it.copy(iconPickerTab = action.tab) }
            is AuthAction.OtpCodeChanged -> _uiState.update {
                it.copy(otpCode = action.code.filter(Char::isDigit).take(6), errorMessage = null)
            }
            is AuthAction.ClearError -> _uiState.update { it.copy(errorMessage = null, infoMessage = null) }
            is AuthAction.SubmitLogin -> login()
            is AuthAction.SubmitRegister -> nextRegisterStep()
            is AuthAction.NextRegisterStep -> nextRegisterStep()
            is AuthAction.BackStep -> backStep()
            is AuthAction.ResendOtp -> resendOtp()
            is AuthAction.SubmitRecovery -> submitRecovery()
        }
    }

    private fun backStep() {
        val current = _uiState.value
        when (current.mode) {
            AuthMode.LOGIN -> Unit
            AuthMode.REGISTER -> when (current.registerStep) {
                RegisterStep.CREDENTIALS -> _uiState.update { it.copy(mode = AuthMode.LOGIN, errorMessage = null) }
                RegisterStep.PROFILE -> _uiState.update { it.copy(registerStep = RegisterStep.CREDENTIALS, errorMessage = null) }
                RegisterStep.OTP -> _uiState.update { it.copy(registerStep = RegisterStep.PROFILE, errorMessage = null, otpCode = "") }
            }
            AuthMode.RECOVERY -> when (current.recoveryStep) {
                RecoveryStep.EMAIL -> _uiState.update { it.copy(mode = AuthMode.LOGIN, errorMessage = null, infoMessage = null) }
                RecoveryStep.OTP -> _uiState.update { it.copy(recoveryStep = RecoveryStep.EMAIL, errorMessage = null, otpCode = "") }
                RecoveryStep.NEW_PASSWORD -> _uiState.update { it.copy(recoveryStep = RecoveryStep.OTP, errorMessage = null) }
            }
        }
    }

    private fun login() {
        val current = _uiState.value
        if (current.isLoading) return
        if (current.name.trim().isEmpty()) {
            _uiState.update { it.copy(errorMessage = "auth.login.identifierRequired") }
            return
        }
        if (current.password.trim().isEmpty()) {
            _uiState.update { it.copy(errorMessage = "auth.login.passwordRequired") }
            return
        }
        if (!Auth.verifyValidMnemonic(current.password.trim())) {
            _uiState.update { it.copy(errorMessage = "auth.login.validationError") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            try {
                repo.login(current.name.trim(), current.password.trim(), current.rememberMe)
                _uiState.update { it.copy(isLoading = false, isSuccess = true) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, errorMessage = getFriendlyLoginError(e)) }
            }
        }
    }

    private fun nextRegisterStep() {
        val current = _uiState.value
        if (current.isLoading) return
        when (current.registerStep) {
            RegisterStep.CREDENTIALS -> validateRegisterCredentials(current)
            RegisterStep.PROFILE -> requestRegisterOtpOrComplete(current)
            RegisterStep.OTP -> completeRegistrationWithOtp(current)
        }
    }

    private fun validateRegisterCredentials(current: AuthUiState) {
        val nickname = current.name.trim()
        val email = current.email.trim()
        val password = current.password
        val confirm = current.confirmPassword

        if (nickname.isEmpty()) {
            _uiState.update { it.copy(errorMessage = "auth.register.nicknameRequired") }
            return
        }
        if (email.isEmpty()) {
            _uiState.update { it.copy(errorMessage = "auth.register.emailInvalid") }
            return
        }
        if (!current.legalAccepted) {
            _uiState.update { it.copy(errorMessage = "auth.register.legalConsent") }
            return
        }
        if (password.isEmpty()) {
            _uiState.update { it.copy(errorMessage = "auth.login.passwordRequired") }
            return
        }
        if (!Auth.verifyValidPassword(password) || !Auth.verifyValidMnemonic(password)) {
            _uiState.update { it.copy(errorMessage = "auth.register.passwordWeak") }
            return
        }
        if (password != confirm) {
            _uiState.update { it.copy(errorMessage = "auth.register.passwordMismatch") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            try {
                if (repo.checkNicknameExists(nickname)) {
                    _uiState.update { it.copy(isLoading = false, errorMessage = "auth.register.nicknameTaken") }
                    return@launch
                }
                if (repo.checkEmailExists(email)) {
                    _uiState.update { it.copy(isLoading = false, errorMessage = "auth.register.emailTaken") }
                    return@launch
                }
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = null,
                        registerStep = RegisterStep.PROFILE
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, errorMessage = getFriendlyLoginError(e)) }
            }
        }
    }

    private fun requestRegisterOtpOrComplete(current: AuthUiState) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            try {
                val challenge = runCatching { repo.requestRegistrationOtp(current.email.trim()) }.getOrNull()
                if (challenge != null && challenge.challengeId.isNotBlank()) {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            otpChallenge = challenge,
                            otpCode = "",
                            registerStep = RegisterStep.OTP
                        )
                    }
                } else {
                    repo.register(
                        nickname = current.name.trim(),
                        email = current.email.trim(),
                        password = current.password,
                        colorA = current.colorA,
                        colorB = current.colorB,
                        icon = current.userIcon.key
                    )
                    _uiState.update { it.copy(isLoading = false, isSuccess = true) }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, errorMessage = extractApiMessage(e, "auth.otp.requestFailed")) }
            }
        }
    }

    private fun completeRegistrationWithOtp(current: AuthUiState) {
        val challenge = current.otpChallenge ?: return
        if (current.otpCode.length != 6) {
            _uiState.update { it.copy(errorMessage = "auth.otp.invalid") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            try {
                repo.register(
                    nickname = current.name.trim(),
                    email = current.email.trim(),
                    password = current.password,
                    colorA = current.colorA,
                    colorB = current.colorB,
                    icon = current.userIcon.key,
                    otpChallengeId = challenge.challengeId,
                    otpCode = current.otpCode
                )
                _uiState.update { it.copy(isLoading = false, isSuccess = true) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, errorMessage = extractApiMessage(e, "auth.otp.invalid")) }
            }
        }
    }

    private fun resendOtp() {
        val current = _uiState.value
        val challenge = current.otpChallenge ?: return
        if (current.isLoading) return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            try {
                val updated = repo.resendOtp(challenge.challengeId)
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        otpChallenge = updated,
                        otpCode = ""
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, errorMessage = extractApiMessage(e, "auth.otp.resendFailed")) }
            }
        }
    }

    private fun submitRecovery() {
        val current = _uiState.value
        if (current.isLoading) return
        when (current.recoveryStep) {
            RecoveryStep.EMAIL -> {
                if (current.email.trim().isEmpty()) {
                    _uiState.update { it.copy(errorMessage = "auth.register.emailInvalid") }
                    return
                }
                viewModelScope.launch {
                    _uiState.update { it.copy(isLoading = true, errorMessage = null, infoMessage = null) }
                    try {
                        val response = repo.requestPasswordReset(current.email.trim())
                        if (response.challengeId.isBlank()) {
                            _uiState.update {
                                it.copy(
                                    isLoading = false,
                                    infoMessage = response.message.ifBlank { "toasts.passwordResetSuccess" }
                                )
                            }
                        } else {
                            _uiState.update {
                                it.copy(
                                    isLoading = false,
                                    otpChallenge = response,
                                    otpCode = "",
                                    recoveryStep = RecoveryStep.OTP
                                )
                            }
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        _uiState.update { it.copy(isLoading = false, errorMessage = extractApiMessage(e, "auth.otp.requestFailed")) }
                    }
                }
            }
            RecoveryStep.OTP -> {
                val challenge = current.otpChallenge ?: return
                if (current.otpCode.length != 6) {
                    _uiState.update { it.copy(errorMessage = "auth.otp.invalid") }
                    return
                }
                viewModelScope.launch {
                    _uiState.update { it.copy(isLoading = true, errorMessage = null) }
                    try {
                        val actionToken = repo.verifyPasswordReset(challenge.challengeId, current.otpCode)
                        _uiState.update {
                            it.copy(
                                isLoading = false,
                                recoveryActionToken = actionToken,
                                password = "",
                                confirmPassword = "",
                                recoveryStep = RecoveryStep.NEW_PASSWORD
                            )
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        _uiState.update { it.copy(isLoading = false, errorMessage = extractApiMessage(e, "auth.otp.invalid")) }
                    }
                }
            }
            RecoveryStep.NEW_PASSWORD -> {
                val actionToken = current.recoveryActionToken ?: return
                val password = current.password
                val confirm = current.confirmPassword
                if (!Auth.verifyValidPassword(password) || !Auth.verifyValidMnemonic(password)) {
                    _uiState.update { it.copy(errorMessage = "auth.register.passwordWeak") }
                    return
                }
                if (password != confirm) {
                    _uiState.update { it.copy(errorMessage = "auth.register.passwordMismatch") }
                    return
                }
                viewModelScope.launch {
                    _uiState.update { it.copy(isLoading = true, errorMessage = null) }
                    try {
                        repo.completePasswordReset(actionToken, current.email.trim(), password)
                        _uiState.update { it.copy(isLoading = false, isSuccess = true) }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        _uiState.update { it.copy(isLoading = false, errorMessage = extractApiMessage(e, "toasts.passwordResetError")) }
                    }
                }
            }
        }
    }

    private fun extractApiMessage(error: Throwable, fallback: String): String {
        val raw = error.message.orEmpty()
        val jsonStart = raw.indexOf('{')
        if (jsonStart >= 0) {
            val extracted = runCatching {
                org.json.JSONObject(raw.substring(jsonStart)).optString("message")
            }.getOrNull()
            if (!extracted.isNullOrBlank()) return extracted
        }
        return fallback
    }

    private fun getFriendlyLoginError(error: Throwable): String {
        val message = (error.message ?: "").lowercase()
        if (message.contains("no backend url")) {
            return "auth.login.noBackendUrl"
        }
        if (message.contains("400") ||
            message.contains("401") ||
            message.contains("403") ||
            message.contains("404") ||
            message.contains("user cannot be found") ||
            message.contains("user not found") ||
            message.contains("invalid signature") ||
            message.contains("invalid challenge") ||
            message.contains("challenge code expired") ||
            message.contains("invalid request body") ||
            message.contains("unauthorized") ||
            message.contains("forbidden") ||
            message.contains("incorrect") ||
            message.contains("failed to authenticate") ||
            message.contains("notallowederror")
        ) {
            return "auth.login.validationError"
        }
        return "auth.login.failedToReachServer"
    }

    companion object {
        fun provideFactory(repo: AuthRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return AuthViewModel(repo) as T
                }
            }
    }
}
