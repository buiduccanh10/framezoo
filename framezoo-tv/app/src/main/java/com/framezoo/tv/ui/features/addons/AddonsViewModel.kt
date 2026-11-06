package com.framezoo.tv.ui.features.addons

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.framezoo.tv.data.repository.AddonsRepository
import com.framezoo.tv.model.Addon
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AddonsUiState(
    val installed: List<Addon> = emptyList(),
    val addonUrl: String = "",
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val isSuccess: Boolean = false
)

sealed interface AddonsAction {
    data class UrlChanged(val value: String) : AddonsAction
    data object InstallAddon : AddonsAction
    data class RemoveAddon(val id: String) : AddonsAction
    data class ToggleAddon(val id: String) : AddonsAction
    data object ClearError : AddonsAction
    data object Refresh : AddonsAction
}

class AddonsViewModel(
    private val repo: AddonsRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(AddonsUiState())
    val uiState: StateFlow<AddonsUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repo.installedAddons.collect { list ->
                _uiState.update { it.copy(installed = list) }
            }
        }
        refresh()
    }

    fun onAction(action: AddonsAction) {
        when (action) {
            is AddonsAction.UrlChanged -> _uiState.update { it.copy(addonUrl = action.value) }
            is AddonsAction.ClearError -> _uiState.update { it.copy(errorMessage = null) }
            is AddonsAction.InstallAddon -> install()
            is AddonsAction.RemoveAddon -> {
                viewModelScope.launch {
                    repo.remove(action.id)
                }
            }
            is AddonsAction.ToggleAddon -> {
                viewModelScope.launch {
                    repo.toggle(action.id)
                }
            }
            is AddonsAction.Refresh -> refresh()
        }
    }

    private fun install() {
        val url = _uiState.value.addonUrl.trim()
        if (url.isBlank() || _uiState.value.isLoading) return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            try {
                repo.install(url)
                _uiState.update { it.copy(isLoading = false, addonUrl = "", isSuccess = true) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, errorMessage = e.message ?: "Failed to install addon") }
            }
        }
    }

    private fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                repo.load()
            } catch (_: Exception) {}
            _uiState.update { it.copy(isLoading = false) }
        }
    }

    companion object {
        fun provideFactory(repo: AddonsRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return AddonsViewModel(repo) as T
                }
            }
    }
}
