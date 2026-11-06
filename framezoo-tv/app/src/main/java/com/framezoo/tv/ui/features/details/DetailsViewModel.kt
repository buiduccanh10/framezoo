package com.framezoo.tv.ui.features.details

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.framezoo.tv.data.repository.BookmarksRepository
import com.framezoo.tv.data.repository.HistoryRepository
import com.framezoo.tv.data.repository.MediaRepository
import com.framezoo.tv.data.repository.SettingsRepository
import com.framezoo.tv.model.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class DetailsUiState(
    val media: Media,
    val seasons: List<Int> = emptyList(),
    val selectedSeason: Int? = null,
    val episodes: List<Episode> = emptyList(),
    val cast: List<CastMember> = emptyList(),
    val trailers: List<Trailer> = emptyList(),
    val ratings: FeaturedRatings? = null,
    val collection: MediaCollection? = null,
    val isBookmarked: Boolean = false,
    val isWatched: Boolean = false,
    val bookmarkGroups: List<String> = emptyList(),
    val favoriteEpisodes: Set<String> = emptySet(),
    val trailerEnabled: Boolean = true,
    val trailerMuted: Boolean = true,
    val isLoading: Boolean = false,
    val episodesLoading: Boolean = false
)

sealed interface DetailsAction {
    data class SelectSeason(val season: Int) : DetailsAction
    data object ToggleBookmark : DetailsAction
    data object ToggleWatched : DetailsAction
    data class ToggleEpisodeWatched(val episode: Episode) : DetailsAction
    data object ToggleTrailer : DetailsAction
    data object ToggleTrailerAudio : DetailsAction
    data class AddBookmarkGroup(val group: String) : DetailsAction
    data class ToggleEpisodeFavorite(val episodeId: String) : DetailsAction
}

class DetailsViewModel(
    initialMedia: Media,
    private val mediaRepo: MediaRepository,
    private val bookmarksRepo: BookmarksRepository,
    private val historyRepo: HistoryRepository,
    private val settingsRepo: SettingsRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        DetailsUiState(
            media = initialMedia,
            isBookmarked = bookmarksRepo.isBookmarked(initialMedia.id),
            trailerEnabled = settingsRepo.trailerEnabled.value,
            trailerMuted = settingsRepo.trailerMuted.value
        )
    )
    val uiState: StateFlow<DetailsUiState> = _uiState.asStateFlow()

    init {
        loadDetails()
        observeData()
    }

    private fun observeData() {
        viewModelScope.launch {
            bookmarksRepo.bookmarks.collect { list ->
                _uiState.update { it.copy(isBookmarked = list.any { m -> m.id == _uiState.value.media.id }) }
            }
        }
        viewModelScope.launch {
            bookmarksRepo.bookmarkDetails.collect { list ->
                val match = list.firstOrNull { it.media.id == _uiState.value.media.id }
                _uiState.update {
                    it.copy(
                        bookmarkGroups = match?.groups ?: emptyList(),
                        favoriteEpisodes = match?.favoriteEpisodes?.toSet() ?: emptySet()
                    )
                }
            }
        }
        viewModelScope.launch {
            historyRepo.history.collect { list ->
                val watched = list.any { it.media.id == _uiState.value.media.id }
                _uiState.update { it.copy(isWatched = watched) }
            }
        }
        viewModelScope.launch {
            settingsRepo.trailerEnabled.collect { en -> _uiState.update { it.copy(trailerEnabled = en) } }
        }
        viewModelScope.launch {
            settingsRepo.trailerMuted.collect { muted -> _uiState.update { it.copy(trailerMuted = muted) } }
        }
    }

    private fun loadDetails() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val item = _uiState.value.media
            try {
                val (enriched, seasonList) = mediaRepo.details(item)
                val castList = mediaRepo.cast(item)
                val trailerList = mediaRepo.trailers(item)
                val featRatings = mediaRepo.featuredRatings(item)
                val col = if (item.collectionId != null) {
                    try { mediaRepo.collection(item.collectionId) } catch (_: Exception) { null }
                } else null

                val initialSeason = seasonList.firstOrNull()
                _uiState.update {
                    it.copy(
                        media = enriched,
                        seasons = seasonList,
                        selectedSeason = initialSeason,
                        cast = castList,
                        trailers = trailerList,
                        ratings = featRatings,
                        collection = col,
                        isLoading = false
                    )
                }
                if (initialSeason != null) {
                    loadEpisodes(initialSeason)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    private fun loadEpisodes(season: Int) {
        viewModelScope.launch {
            _uiState.update { it.copy(episodesLoading = true) }
            try {
                val eps = mediaRepo.episodes(_uiState.value.media.id, season)
                _uiState.update { it.copy(episodes = eps, episodesLoading = false) }
            } catch (_: Exception) {
                _uiState.update { it.copy(episodesLoading = false) }
            }
        }
    }

    fun onAction(action: DetailsAction) {
        when (action) {
            is DetailsAction.SelectSeason -> {
                if (_uiState.value.selectedSeason != action.season) {
                    _uiState.update { it.copy(selectedSeason = action.season) }
                    loadEpisodes(action.season)
                }
            }
            is DetailsAction.ToggleBookmark -> {
                viewModelScope.launch {
                    bookmarksRepo.toggleBookmark(_uiState.value.media)
                }
            }
            is DetailsAction.ToggleWatched -> {
                viewModelScope.launch {
                    val nextWatched = !_uiState.value.isWatched
                    historyRepo.markWatched(_uiState.value.media, null, nextWatched)
                }
            }
            is DetailsAction.ToggleEpisodeWatched -> {
                viewModelScope.launch {
                    historyRepo.markWatched(_uiState.value.media, action.episode, true)
                }
            }
            is DetailsAction.ToggleTrailer -> {
                settingsRepo.toggleTrailer()
            }
            is DetailsAction.ToggleTrailerAudio -> {
                settingsRepo.toggleTrailerAudio()
            }
            is DetailsAction.AddBookmarkGroup -> {
                viewModelScope.launch {
                    bookmarksRepo.addGroup(_uiState.value.media, action.group)
                }
            }
            is DetailsAction.ToggleEpisodeFavorite -> {
                viewModelScope.launch {
                    bookmarksRepo.toggleEpisodeFavorite(_uiState.value.media, action.episodeId)
                }
            }
        }
    }

    companion object {
        fun provideFactory(
            media: Media,
            mediaRepo: MediaRepository,
            bookmarksRepo: BookmarksRepository,
            historyRepo: HistoryRepository,
            settingsRepo: SettingsRepository
        ): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                return DetailsViewModel(media, mediaRepo, bookmarksRepo, historyRepo, settingsRepo) as T
            }
        }
    }
}
