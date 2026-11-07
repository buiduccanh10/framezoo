package com.framezoo.tv.ui.features.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.framezoo.tv.data.repository.AuthRepository
import com.framezoo.tv.data.repository.SettingsRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class SettingsTab {
    PREFERENCES,
    APPEARANCE,
    CAPTIONS,
    TORRENT,
    ACCOUNT
}

data class SettingsUiState(
    val selectedTab: SettingsTab = SettingsTab.PREFERENCES,
    val theme: String = "ember",
    val language: String = "vi",
    val customPrimary: String = "classic",
    val customSecondary: String = "classic",
    val customTertiary: String = "classic",
    val subtitleFontSize: Int = 100,
    val subtitleColor: String = "#FFFFFF",
    val subtitleBackgroundOpacity: Int = 50,
    val torrentCacheSize: String = "5gb",
    val backendUrl: String = "",
    val isLoggedIn: Boolean = false,
    val userId: String? = null,
    val isCacheCleared: Boolean = false
)

sealed interface SettingsAction {
    data class SelectTab(val tab: SettingsTab) : SettingsAction
    data class ChangeTheme(val theme: String) : SettingsAction
    data class ChangeLanguage(val lang: String) : SettingsAction
    data class ChangeCustomPart(val part: String, val theme: String) : SettingsAction
    data class ChangeSubtitleFontSize(val delta: Int) : SettingsAction
    data class ChangeSubtitleColor(val color: String) : SettingsAction
    data class ChangeSubtitleBackgroundOpacity(val delta: Int) : SettingsAction
    data class ChangeTorrentCacheSize(val size: String) : SettingsAction
    data object ClearTorrentCache : SettingsAction
    data object Logout : SettingsAction
}

class SettingsViewModel(
    private val settingsRepo: SettingsRepository,
    private val authRepo: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        SettingsUiState(
            theme = settingsRepo.theme.value,
            language = settingsRepo.language.value,
            customPrimary = settingsRepo.customPrimary.value,
            customSecondary = settingsRepo.customSecondary.value,
            customTertiary = settingsRepo.customTertiary.value,
            subtitleFontSize = settingsRepo.subtitleFontSize.value,
            subtitleColor = settingsRepo.subtitleColor.value,
            subtitleBackgroundOpacity = settingsRepo.subtitleBackgroundOpacity.value,
            torrentCacheSize = settingsRepo.torrentCacheSize.value,
            backendUrl = settingsRepo.backendUrl.value,
            isLoggedIn = authRepo.isLoggedIn.value,
            userId = authRepo.userId.value
        )
    )
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            settingsRepo.theme.collect { t -> _uiState.update { it.copy(theme = t) } }
        }
        viewModelScope.launch {
            settingsRepo.language.collect { l -> _uiState.update { it.copy(language = l) } }
        }
        viewModelScope.launch {
            authRepo.isLoggedIn.collect { loggedIn -> _uiState.update { it.copy(isLoggedIn = loggedIn, userId = authRepo.userId.value) } }
        }
    }

    fun onAction(action: SettingsAction) {
        when (action) {
            is SettingsAction.SelectTab -> _uiState.update { it.copy(selectedTab = action.tab) }
            is SettingsAction.ChangeTheme -> {
                settingsRepo.updateTheme(action.theme)
            }
            is SettingsAction.ChangeLanguage -> {
                settingsRepo.updateLanguage(action.lang)
            }
            is SettingsAction.ChangeCustomPart -> {
                settingsRepo.updateCustomPart(action.part, action.theme)
                _uiState.update {
                    when (action.part) {
                        "primary" -> it.copy(customPrimary = action.theme)
                        "secondary" -> it.copy(customSecondary = action.theme)
                        "tertiary" -> it.copy(customTertiary = action.theme)
                        else -> it
                    }
                }
            }
            is SettingsAction.ChangeSubtitleFontSize -> {
                val newSize = (_uiState.value.subtitleFontSize + action.delta).coerceIn(50, 200)
                settingsRepo.updateSubtitleFontSize(newSize)
                _uiState.update { it.copy(subtitleFontSize = newSize) }
            }
            is SettingsAction.ChangeSubtitleColor -> {
                settingsRepo.updateSubtitleColor(action.color)
                _uiState.update { it.copy(subtitleColor = action.color) }
            }
            is SettingsAction.ChangeSubtitleBackgroundOpacity -> {
                val newOp = (_uiState.value.subtitleBackgroundOpacity + action.delta).coerceIn(0, 100)
                settingsRepo.updateSubtitleBackgroundOpacity(newOp)
                _uiState.update { it.copy(subtitleBackgroundOpacity = newOp) }
            }
            is SettingsAction.ChangeTorrentCacheSize -> {
                settingsRepo.updateTorrentCacheSize(action.size)
                _uiState.update { it.copy(torrentCacheSize = action.size) }
            }
            is SettingsAction.ClearTorrentCache -> {
                _uiState.update { it.copy(isCacheCleared = true) }
            }
            is SettingsAction.Logout -> {
                authRepo.logout()
            }
        }
    }

    companion object {
        fun provideFactory(settingsRepo: SettingsRepository, authRepo: AuthRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return SettingsViewModel(settingsRepo, authRepo) as T
                }
            }
    }
}
