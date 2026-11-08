package com.framezoo.tv.data.repository

import com.framezoo.tv.api.Backend
import com.framezoo.tv.model.OtpChallenge
import com.framezoo.tv.storage.SecureStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class AuthRepository(
    val store: SecureStore,
    val backend: Backend
) {
    private val _userId = MutableStateFlow(store.userId)
    val userId: StateFlow<String?> = _userId.asStateFlow()

    private val _isLoggedIn = MutableStateFlow(store.userId != null)
    val isLoggedIn: StateFlow<Boolean> = _isLoggedIn.asStateFlow()

    private fun syncState() {
        _userId.value = store.userId
        _isLoggedIn.value = store.userId != null
    }

    suspend fun login(name: String, pass: String, rememberMe: Boolean = false) {
        backend.login(name, pass)
        if (rememberMe) {
            store.saveRememberedCredentials(name.trim(), pass)
        } else {
            store.clearRememberedCredentials()
        }
        syncState()
    }

    suspend fun checkNicknameExists(nickname: String): Boolean =
        backend.checkNicknameExists(nickname)

    suspend fun checkEmailExists(email: String): Boolean =
        backend.checkEmailExists(email)

    suspend fun requestRegistrationOtp(email: String): OtpChallenge =
        backend.requestRegistrationOtp(email)

    suspend fun resendOtp(challengeId: String): OtpChallenge =
        backend.resendOtp(challengeId)

    suspend fun register(
        nickname: String,
        email: String,
        password: String,
        colorA: String,
        colorB: String,
        icon: String,
        otpChallengeId: String? = null,
        otpCode: String? = null
    ) {
        backend.register(
            nickname = nickname,
            email = email,
            password = password,
            colorA = colorA,
            colorB = colorB,
            icon = icon,
            otpChallengeId = otpChallengeId,
            otpCode = otpCode
        )
        syncState()
    }

    suspend fun requestPasswordReset(email: String): OtpChallenge =
        backend.requestPasswordReset(email)

    suspend fun verifyPasswordReset(challengeId: String, code: String): String =
        backend.verifyPasswordReset(challengeId, code)

    suspend fun completePasswordReset(actionToken: String, email: String, newPassword: String) {
        backend.completePasswordReset(actionToken, email, newPassword)
        syncState()
    }

    fun logout() {
        store.clearSession()
        syncState()
    }
}
