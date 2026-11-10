package com.framezoo.tv.ui.features.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.framezoo.tv.data.repository.MediaRepository
import com.framezoo.tv.model.DiscoverOption
import com.framezoo.tv.model.Media
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import com.framezoo.tv.model.LibraryItem
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SearchUiState(
    val query: String = "",
    val results: List<Media> = emptyList(),
    val filteredResults: List<Media> = emptyList(),
    val selectedCountry: String = "",
    val selectedYear: String = "",
    val selectedGenre: String = "",
    val genres: List<DiscoverOption> = emptyList(),
    val countries: List<DiscoverOption> = emptyList(),
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val progressItems: List<LibraryItem> = emptyList(),
    val editingWatching: Boolean = false,
    val watchingSortBy: String = "date",
    val recommendedMedia: List<Media> = emptyList()
)

sealed interface SearchAction {
    data class QueryChanged(val value: String) : SearchAction
    data class CountryChanged(val value: String) : SearchAction
    data class YearChanged(val value: String) : SearchAction
    data class GenreChanged(val value: String) : SearchAction
    data object ClearFilters : SearchAction
    data object ExecuteSearch : SearchAction
    data object ToggleEditingWatching : SearchAction
    data class ChangeWatchingSort(val sort: String) : SearchAction
    data class RemoveProgressItem(val item: LibraryItem) : SearchAction
}

class SearchViewModel(
    private val repo: MediaRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(SearchUiState())
    val uiState: StateFlow<SearchUiState> = _uiState.asStateFlow()

    private var searchJob: Job? = null

    init {
        loadOptions()
    }

    private fun loadOptions() {
        viewModelScope.launch {
            try {
                val (g, c) = repo.discoverOptions()
                _uiState.update { it.copy(genres = g, countries = c) }
            } catch (_: Exception) {}
        }
    }

    fun onAction(action: SearchAction) {
        when (action) {
            is SearchAction.QueryChanged -> {
                _uiState.update { it.copy(query = action.value) }
                debounceSearch(action.value)
            }
            is SearchAction.CountryChanged -> {
                _uiState.update { state ->
                    val next = if (state.selectedCountry == action.value) "" else action.value
                    state.copy(selectedCountry = next, filteredResults = applyFilters(state.results, next, state.selectedYear, state.selectedGenre))
                }
            }
            is SearchAction.YearChanged -> {
                _uiState.update { state ->
                    val next = if (state.selectedYear == action.value) "" else action.value
                    state.copy(selectedYear = next, filteredResults = applyFilters(state.results, state.selectedCountry, next, state.selectedGenre))
                }
            }
            is SearchAction.GenreChanged -> {
                _uiState.update { state ->
                    val next = if (state.selectedGenre == action.value) "" else action.value
                    state.copy(selectedGenre = next, filteredResults = applyFilters(state.results, state.selectedCountry, state.selectedYear, next))
                }
            }
            is SearchAction.ClearFilters -> {
                _uiState.update { state ->
                    state.copy(
                        selectedCountry = "",
                        selectedYear = "",
                        selectedGenre = "",
                        filteredResults = state.results
                    )
                }
            }
            is SearchAction.ExecuteSearch -> {
                searchJob?.cancel()
                performSearch(_uiState.value.query)
            }
            is SearchAction.ToggleEditingWatching -> {
                _uiState.update { it.copy(editingWatching = !it.editingWatching) }
            }
            is SearchAction.ChangeWatchingSort -> {
                _uiState.update { it.copy(watchingSortBy = action.sort) }
            }
            is SearchAction.RemoveProgressItem -> {
                _uiState.update { state ->
                    state.copy(progressItems = state.progressItems.filter { it.media.id != action.item.media.id })
                }
            }
        }
    }

    private fun debounceSearch(query: String) {
        searchJob?.cancel()
        if (query.isBlank()) {
            _uiState.update { it.copy(results = emptyList(), filteredResults = emptyList(), isLoading = false, errorMessage = null) }
            return
        }
        searchJob = viewModelScope.launch {
            delay(400)
            performSearch(query)
        }
    }

    private fun performSearch(query: String) {
        if (query.isBlank()) return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            try {
                val raw = repo.search(query)
                val enriched = repo.enrichSearch(raw)
                val filtered = applyFilters(enriched, _uiState.value.selectedCountry, _uiState.value.selectedYear, _uiState.value.selectedGenre)
                _uiState.update { it.copy(results = enriched, filteredResults = filtered, isLoading = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, errorMessage = e.message ?: "Search failed") }
            }
        }
    }

    private fun applyFilters(items: List<Media>, country: String, year: String, genre: String): List<Media> {
        return items.filter { item ->
            (country.isBlank() || country in item.originCountries) &&
            (year.isBlank() || item.year == year) &&
            (genre.isBlank() || genre in item.genreIds || genre in item.genres)
        }
    }

    companion object {
        fun provideFactory(repo: MediaRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return SearchViewModel(repo) as T
                }
            }
    }
}
