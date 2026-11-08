package com.framezoo.tv.ui.features.account

import androidx.lifecycle.ViewModel
import com.framezoo.tv.model.AccountProfile
import com.framezoo.tv.model.UserIcon
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * ViewModel managing the state and business logic for the Account Header and Dropdown Menu.
 * Extracts business logic completely out of composable UI files.
 */
class AccountMenuViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(AccountMenuUiState())
    val uiState: StateFlow<AccountMenuUiState> = _uiState.asStateFlow()

    fun updateAccount(
        isLoggedIn: Boolean,
        nickname: String?,
        colorA: String?,
        colorB: String?,
        icon: String?,
        userId: String? = null,
        isOffline: Boolean = false
    ) {
        val userIcon = UserIcon.fromKey(icon)
        val profile = AccountProfile(
            colorA = colorA ?: "#6366F1",
            colorB = colorB ?: "#EC4899",
            icon = userIcon,
            nickname = nickname.orEmpty(),
            userId = userId
        )
        _uiState.update {
            it.copy(
                isLoggedIn = isLoggedIn,
                profile = profile,
                isOffline = isOffline
            )
        }
    }

    fun handleAction(
        action: AccountMenuAction,
        onNavigate: (String) -> Unit,
        onOpenLogin: () -> Unit,
        onOpenProtected: (() -> Unit) -> Unit,
        onOpenWatchParty: () -> Unit,
        onOpenFeedback: () -> Unit,
        onLogout: () -> Unit
    ) {
        when (action) {
            AccountMenuAction.ToggleMenu -> {
                _uiState.update { it.copy(isExpanded = !it.isExpanded) }
            }
            AccountMenuAction.OpenMenu -> {
                _uiState.update { it.copy(isExpanded = true) }
            }
            AccountMenuAction.CloseMenu -> {
                _uiState.update { it.copy(isExpanded = false) }
            }
            AccountMenuAction.SelectProfile -> {
                _uiState.update { it.copy(isExpanded = false) }
                onNavigate("settings")
            }
            AccountMenuAction.SelectLogin -> {
                _uiState.update { it.copy(isExpanded = false) }
                onOpenLogin()
            }
            AccountMenuAction.SelectHistory -> {
                _uiState.update { it.copy(isExpanded = false) }
                onOpenProtected { onNavigate("history") }
            }
            AccountMenuAction.SelectBookmarks -> {
                _uiState.update { it.copy(isExpanded = false) }
                onOpenProtected { onNavigate("library") }
            }
            AccountMenuAction.SelectAddons -> {
                _uiState.update { it.copy(isExpanded = false) }
                onNavigate("addons")
            }
            AccountMenuAction.SelectWatchParty -> {
                _uiState.update { it.copy(isExpanded = false) }
                onOpenWatchParty()
            }
            AccountMenuAction.SelectFeedback -> {
                _uiState.update { it.copy(isExpanded = false) }
                onOpenFeedback()
            }
            AccountMenuAction.SelectSettings -> {
                _uiState.update { it.copy(isExpanded = false) }
                onNavigate("settings")
            }
            AccountMenuAction.SelectLogout -> {
                _uiState.update { it.copy(isExpanded = false) }
                onLogout()
            }
        }
    }
}
