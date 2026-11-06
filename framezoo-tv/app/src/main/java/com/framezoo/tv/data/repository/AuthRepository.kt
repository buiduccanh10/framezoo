package com.framezoo.tv.data.repository

import com.framezoo.tv.api.Backend
import com.framezoo.tv.storage.SecureStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class AuthRepository(
    private val store: SecureStore,
    private val backend: Backend
) {
    private val _userId = MutableStateFlow(store.userId)
    val userId: StateFlow<String?> = _userId.asStateFlow()

    private val _isLoggedIn = MutableStateFlow(store.userId != null)
    val isLoggedIn: StateFlow<Boolean> = _isLoggedIn.asStateFlow()

    suspend fun login(name: String, pass: String) {
        backend.login(name, pass)
        _userId.value = store.userId
        _isLoggedIn.value = store.userId != null
    }

    fun logout() {
        store.clearSession()
        _userId.value = null
        _isLoggedIn.value = false
    }
}
