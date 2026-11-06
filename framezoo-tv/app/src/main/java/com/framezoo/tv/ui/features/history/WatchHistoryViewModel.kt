package com.framezoo.tv.ui.features.history

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.framezoo.tv.data.repository.HistoryRepository
import com.framezoo.tv.model.LibraryItem
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class WatchHistoryUiState(
    val history: List<LibraryItem> = emptyList(),
    val progress: List<LibraryItem> = emptyList(),
    val isEditing: Boolean = false,
    val isLoading: Boolean = false
)

sealed interface WatchHistoryAction {
    data object ToggleEditMode : WatchHistoryAction
    data class DeleteItem(val item: LibraryItem) : WatchHistoryAction
    data object ClearAll : WatchHistoryAction
    data object Refresh : WatchHistoryAction
}

class WatchHistoryViewModel(
    private val repo: HistoryRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(WatchHistoryUiState())
    val uiState: StateFlow<WatchHistoryUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repo.history.collect { list ->
                _uiState.update { it.copy(history = list) }
            }
        }
        viewModelScope.launch {
            repo.progress.collect { list ->
                _uiState.update { it.copy(progress = list) }
            }
        }
        refresh()
    }

    fun onAction(action: WatchHistoryAction) {
        when (action) {
            is WatchHistoryAction.ToggleEditMode -> _uiState.update { it.copy(isEditing = !it.isEditing) }
            is WatchHistoryAction.DeleteItem -> {
                viewModelScope.launch {
                    repo.deleteItem(action.item)
                }
            }
            is WatchHistoryAction.ClearAll -> {
                viewModelScope.launch {
                    repo.clearAll()
                }
            }
            is WatchHistoryAction.Refresh -> refresh()
        }
    }

    private fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            repo.refresh()
            _uiState.update { it.copy(isLoading = false) }
        }
    }

    companion object {
        fun provideFactory(repo: HistoryRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return WatchHistoryViewModel(repo) as T
                }
            }
    }
}
