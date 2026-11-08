package com.framezoo.tv.ui.features.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.framezoo.tv.data.repository.AuthRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AuthUiState(
    val name: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val isSuccess: Boolean = false
)

sealed interface AuthAction {
    data class NameChanged(val value: String) : AuthAction
    data class PasswordChanged(val value: String) : AuthAction
    data object SubmitLogin : AuthAction
    data object SubmitRegister : AuthAction
    data object ClearError : AuthAction
}

class AuthViewModel(
    private val repo: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    fun onAction(action: AuthAction) {
        when (action) {
            is AuthAction.NameChanged -> _uiState.update { it.copy(name = action.value) }
            is AuthAction.PasswordChanged -> _uiState.update { it.copy(password = action.value) }
            is AuthAction.ClearError -> _uiState.update { it.copy(errorMessage = null) }
            is AuthAction.SubmitLogin -> login()
            is AuthAction.SubmitRegister -> register()
        }
    }

    private fun login() {
        val current = _uiState.value
        if (current.isLoading || current.name.isBlank() || current.password.isBlank()) return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            try {
                repo.login(current.name, current.password)
                _uiState.update { it.copy(isLoading = false, isSuccess = true) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, errorMessage = getFriendlyLoginError(e)) }
            }
        }
    }

    private fun getFriendlyLoginError(error: Throwable): String {
        val message = (error.message ?: "").lowercase()
        if (message.contains("no backend url")) {
            return "Không có URL backend"
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
            return "Mật khẩu không chính xác hoặc không đầy đủ"
        }
        return "Không thể truy cập máy chủ"
    }

    private fun register() {
        login()
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
