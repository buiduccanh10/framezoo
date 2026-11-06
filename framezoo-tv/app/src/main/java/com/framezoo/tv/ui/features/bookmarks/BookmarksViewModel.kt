package com.framezoo.tv.ui.features.bookmarks

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.framezoo.tv.data.repository.BookmarksRepository
import com.framezoo.tv.model.BookmarkDetails
import com.framezoo.tv.model.Media
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class BookmarksUiState(
    val bookmarks: List<Media> = emptyList(),
    val bookmarkDetails: List<BookmarkDetails> = emptyList(),
    val bookmarkGroups: List<String> = emptyList(),
    val selectedGroup: String? = null,
    val isEditing: Boolean = false,
    val isLoading: Boolean = false
) {
    val filteredBookmarks: List<Media> get() =
        if (selectedGroup == null) bookmarks
        else bookmarkDetails.filter { selectedGroup in it.groups }.map { it.media }
}

sealed interface BookmarksAction {
    data class SelectGroup(val group: String?) : BookmarksAction
    data object ToggleEditMode : BookmarksAction
    data class DeleteBookmark(val media: Media) : BookmarksAction
    data object Refresh : BookmarksAction
}

class BookmarksViewModel(
    private val repo: BookmarksRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(BookmarksUiState())
    val uiState: StateFlow<BookmarksUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repo.bookmarks.collect { list ->
                _uiState.update { it.copy(bookmarks = list) }
            }
        }
        viewModelScope.launch {
            repo.bookmarkDetails.collect { list ->
                _uiState.update { it.copy(bookmarkDetails = list) }
            }
        }
        viewModelScope.launch {
            repo.bookmarkGroups.collect { list ->
                _uiState.update { it.copy(bookmarkGroups = list) }
            }
        }
        refresh()
    }

    fun onAction(action: BookmarksAction) {
        when (action) {
            is BookmarksAction.SelectGroup -> _uiState.update { it.copy(selectedGroup = action.group) }
            is BookmarksAction.ToggleEditMode -> _uiState.update { it.copy(isEditing = !it.isEditing) }
            is BookmarksAction.DeleteBookmark -> {
                viewModelScope.launch {
                    repo.removeBookmark(action.media.id)
                }
            }
            is BookmarksAction.Refresh -> refresh()
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
        fun provideFactory(repo: BookmarksRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return BookmarksViewModel(repo) as T
                }
            }
    }
}
