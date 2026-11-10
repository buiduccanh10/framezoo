package com.framezoo.tv.ui.features.watchparty

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.framezoo.tv.api.Backend
import com.framezoo.tv.model.WatchPartyError
import com.framezoo.tv.model.WatchPartyException
import com.framezoo.tv.model.WatchPartyHost
import com.framezoo.tv.model.parseWatchPartyCode
import com.framezoo.tv.storage.SecureStore
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Navigation event emitted upon successful Watch Party join.
 */
data class WatchPartyNavTarget(
    val host: WatchPartyHost,
    val code: String
)

/**
 * ViewModel handling Watch Party join logic, validating codes and fetching room statuses from backend.
 * Extracts business logic completely out of composable UI files.
 */
class WatchPartyViewModel(
    private val backend: Backend,
    private val store: SecureStore,
    private val stringResolver: (String) -> String
) : ViewModel() {

    private val _uiState = MutableStateFlow(WatchPartyUiState())
    val uiState: StateFlow<WatchPartyUiState> = _uiState.asStateFlow()

    private val _navigationEvents = MutableSharedFlow<WatchPartyNavTarget>()
    val navigationEvents: SharedFlow<WatchPartyNavTarget> = _navigationEvents.asSharedFlow()

    private val _loginRequiredEvents = MutableSharedFlow<Unit>()
    val loginRequiredEvents: SharedFlow<Unit> = _loginRequiredEvents.asSharedFlow()

    fun handleAction(action: WatchPartyAction) {
        when (action) {
            WatchPartyAction.Open -> {
                if (store.userId == null) {
                    viewModelScope.launch { _loginRequiredEvents.emit(Unit) }
                    return
                }
                _uiState.update {
                    it.copy(
                        isOpen = true,
                        codeInput = "",
                        errorMessage = null,
                        isLoading = false
                    )
                }
            }
            WatchPartyAction.Close -> {
                _uiState.update {
                    it.copy(
                        isOpen = false,
                        errorMessage = null,
                        isLoading = false
                    )
                }
            }
            is WatchPartyAction.CodeChanged -> {
                _uiState.update {
                    it.copy(
                        codeInput = action.newCode,
                        errorMessage = null
                    )
                }
            }
            WatchPartyAction.Submit -> {
                submit()
            }
        }
    }

    private fun submit() {
        if (store.userId == null) {
            _uiState.update { it.copy(isOpen = false) }
            viewModelScope.launch { _loginRequiredEvents.emit(Unit) }
            return
        }

        val parsedCode = parseWatchPartyCode(_uiState.value.codeInput)
        if (parsedCode == null) {
            _uiState.update { it.copy(errorMessage = stringResolver("watchParty.invalidRoom")) }
            return
        }

        _uiState.update { it.copy(isLoading = true, errorMessage = null) }

        viewModelScope.launch {
            try {
                val host = backend.watchPartyHost(parsedCode)
                _uiState.update { it.copy(isOpen = false, isLoading = false) }
                _navigationEvents.emit(WatchPartyNavTarget(host, parsedCode))
            } catch (e: WatchPartyException) {
                val msgKey = if (e.kind == WatchPartyError.EMPTY_ROOM) "watchParty.emptyRoom" else "watchParty.noHost"
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = stringResolver(msgKey)
                    )
                }
            } catch (_: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = stringResolver("watchParty.invalidRoom")
                    )
                }
            }
        }
    }
}
