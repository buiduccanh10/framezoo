package com.framezoo.tv.ui.features.discover

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.framezoo.tv.data.repository.*
import com.framezoo.tv.model.*
import com.framezoo.tv.ui.personalSources
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

data class DiscoverUiState(
    val discover: List<Media> = emptyList(),
    val filter: DiscoverFilter = DiscoverFilter(),
    val provider: String = "8",
    val carouselGenre: String = "",
    val genres: List<DiscoverOption> = emptyList(),
    val countries: List<DiscoverOption> = emptyList(),
    val providers: List<DiscoverOption> = emptyList(),
    val sections: Map<String, List<Media>> = emptyMap(),
    val rowLoading: Set<String> = emptySet(),
    val rowErrors: Map<String, String> = emptyMap(),
    val addonCatalog: List<AddonCatalog> = emptyList(),
    val recommendationSource: String = "",
    val recommendationSources: List<Media> = emptyList(),
    val trailerEnabled: Boolean = true,
    val trailerMuted: Boolean = true,
    val isLoading: Boolean = false,
    val errorMessage: String? = null
)

sealed interface DiscoverAction {
    data class UpdateFilter(val filter: DiscoverFilter) : DiscoverAction
    data class SelectProvider(val providerId: String) : DiscoverAction
    data class SelectGenre(val genreId: String) : DiscoverAction
    data class SelectRecommendation(val sourceId: String) : DiscoverAction
    data object ToggleTrailer : DiscoverAction
    data object ToggleTrailerAudio : DiscoverAction
    data object Refresh : DiscoverAction
    data class RefreshRow(val section: String) : DiscoverAction
}

class DiscoverViewModel(
    private val mediaRepo: MediaRepository,
    private val historyRepo: HistoryRepository,
    private val bookmarksRepo: BookmarksRepository,
    private val addonsRepo: AddonsRepository,
    private val settingsRepo: SettingsRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        DiscoverUiState(
            trailerEnabled = settingsRepo.trailerEnabled.value,
            trailerMuted = settingsRepo.trailerMuted.value
        )
    )
    val uiState: StateFlow<DiscoverUiState> = _uiState.asStateFlow()

    private var discoverJob: Job? = null
    private val rowJobs = mutableMapOf<String, Job>()
    private var discoverGeneration = 0
    private val rowGeneration = mutableMapOf<String, Int>()

    init {
        observeSettings()
        initialLoad()
    }

    private fun observeSettings() {
        viewModelScope.launch {
            settingsRepo.trailerEnabled.collect { en -> _uiState.update { it.copy(trailerEnabled = en) } }
        }
        viewModelScope.launch {
            settingsRepo.trailerMuted.collect { muted -> _uiState.update { it.copy(trailerMuted = muted) } }
        }
        viewModelScope.launch {
            addonsRepo.addonCatalog.collect { cat -> _uiState.update { it.copy(addonCatalog = cat) } }
        }
    }

    private fun initialLoad() {
        viewModelScope.launch {
            try {
                val disc = mediaRepo.discover()
                _uiState.update { it.copy(discover = disc) }
            } catch (_: Exception) {}
            refreshDiscover()
            addonsRepo.load()
        }
    }

    fun onAction(action: DiscoverAction) {
        when (action) {
            is DiscoverAction.UpdateFilter -> {
                if (_uiState.value.filter != action.filter) {
                    val providers = mediaRepo.providersFor(action.filter.category)
                    val nextProvider = if (providers.any { it.id == _uiState.value.provider }) _uiState.value.provider
                    else providers.firstOrNull()?.id ?: "8"
                    _uiState.update { it.copy(filter = action.filter, providers = providers, provider = nextProvider) }
                    refreshDiscover()
                }
            }
            is DiscoverAction.SelectProvider -> {
                if (_uiState.value.provider != action.providerId) {
                    _uiState.update { it.copy(provider = action.providerId) }
                    refreshRow("provider")
                }
            }
            is DiscoverAction.SelectGenre -> {
                if (_uiState.value.carouselGenre != action.genreId) {
                    _uiState.update { it.copy(carouselGenre = action.genreId) }
                    refreshRow("genre")
                }
            }
            is DiscoverAction.SelectRecommendation -> {
                if (_uiState.value.recommendationSource != action.sourceId) {
                    _uiState.update { it.copy(recommendationSource = action.sourceId) }
                    refreshRow("recommendations")
                }
            }
            is DiscoverAction.ToggleTrailer -> settingsRepo.toggleTrailer()
            is DiscoverAction.ToggleTrailerAudio -> settingsRepo.toggleTrailerAudio()
            is DiscoverAction.Refresh -> refreshDiscover()
            is DiscoverAction.RefreshRow -> refreshRow(action.section)
        }
    }

    private fun refreshDiscover() {
        val generation = ++discoverGeneration
        discoverJob?.cancel()
        rowJobs.values.forEach { it.cancel() }
        rowJobs.clear()
        _uiState.update { it.copy(rowErrors = emptyMap(), rowLoading = emptySet()) }

        val currentState = _uiState.value
        val selectedFilter = currentState.filter
        val selectedProvider = currentState.provider

        discoverJob = viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            try {
                if (_uiState.value.genres.isEmpty() || _uiState.value.countries.isEmpty()) {
                    val (g, c) = mediaRepo.discoverOptions()
                    val p = mediaRepo.providersFor(selectedFilter.category)
                    _uiState.update { it.copy(genres = g, countries = c, providers = p) }
                }

                val genre = _uiState.value.carouselGenre.ifBlank { _uiState.value.genres.firstOrNull()?.id.orEmpty() }
                if (_uiState.value.carouselGenre.isBlank()) {
                    _uiState.update { it.copy(carouselGenre = genre) }
                }

                val recSources = historyRepo.progress.value.map { it.media }
                val hasPersonal = (historyRepo.history.value.map { it.media } + recSources + bookmarksRepo.bookmarks.value).isNotEmpty()
                val recSource = _uiState.value.recommendationSource.ifBlank { recSources.firstOrNull()?.id.orEmpty() }

                _uiState.update { it.copy(recommendationSources = recSources, recommendationSource = recSource) }

                val keys = if (selectedFilter.category.startsWith("genre:")) listOf("genre") else buildList {
                    add("trending")
                    if (selectedFilter.category == "all") add("popular")
                    addAll(listOf("provider", "top", "editor", "latest"))
                    if (selectedFilter.category in listOf("movie", "tv")) {
                        if (hasPersonal) add("personal")
                        if (recSources.isNotEmpty()) add("recommendations")
                    }
                    add("genre")
                }

                _uiState.update { it.copy(sections = emptyMap()) }

                coroutineScope {
                    keys.map { section ->
                        val rowVersion = rowGeneration[section] ?: 0
                        async {
                            fun isCurrent() = discoverGeneration == generation && (rowGeneration[section] ?: 0) == rowVersion
                            val items = try {
                                loadRow(section, selectedFilter, selectedProvider, genre, recSource)
                            } catch (e: CancellationException) {
                                throw e
                            } catch (e: Exception) {
                                if (isCurrent()) {
                                    _uiState.update { it.copy(rowErrors = it.rowErrors + (section to (e.message ?: "Failed to load"))) }
                                }
                                emptyList()
                            }
                            if (isCurrent() && _uiState.value.filter == selectedFilter) {
                                _uiState.update { it.copy(sections = it.sections + (section to items)) }
                            }
                        }
                    }.forEach { it.await() }
                }

                if (_uiState.value.sections.values.all { it.isEmpty() }) {
                    _uiState.update { it.copy(errorMessage = "Failed to load discover content") }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update { it.copy(sections = emptyMap(), errorMessage = e.message ?: "Failed to load") }
            } finally {
                if (discoverGeneration == generation) {
                    _uiState.update { it.copy(isLoading = false) }
                }
            }
        }
    }

    private suspend fun loadRow(
        section: String,
        selectedFilter: DiscoverFilter,
        selectedProvider: String,
        genre: String,
        selectedRecommendation: String
    ): List<Media> {
        if (section == "editor") return mediaRepo.editorPicks(selectedFilter)
        if (section == "personal" || section == "recommendations") {
            val type = if (selectedFilter.category == "tv") "show" else "movie"
            val chosen = if (section == "personal") {
                personalSources(type, historyRepo.history.value, historyRepo.progress.value, bookmarksRepo.bookmarks.value)
            } else {
                _uiState.value.recommendationSources.filter { it.id == selectedRecommendation }.take(1)
            }
            val existing = (historyRepo.history.value.map { it.media } + historyRepo.progress.value.map { it.media } + bookmarksRepo.bookmarks.value).map { it.id }.toSet()
            return coroutineScope {
                chosen.map { source ->
                    async {
                        try { mediaRepo.recommendations(source).take(if (section == "personal") 10 else 20) }
                        catch (_: Exception) { emptyList() }
                    }
                }.map { it.await() }.flatten()
            }.filter { it.id !in existing && (selectedFilter.year.isEmpty() || it.year == selectedFilter.year) &&
                    (selectedFilter.country.isEmpty() || selectedFilter.country in it.originCountries) }
                .distinctBy { it.id }
        }
        return mediaRepo.discoverSection(selectedFilter, section, selectedProvider, if (section == "genre") genre else "")
    }

    private fun refreshRow(section: String) {
        rowJobs.remove(section)?.cancel()
        val generation = discoverGeneration
        val rowVersion = (rowGeneration[section] ?: 0) + 1
        rowGeneration[section] = rowVersion
        fun isCurrent() = discoverGeneration == generation && rowGeneration[section] == rowVersion

        val selectedFilter = _uiState.value.filter
        val selectedProvider = _uiState.value.provider
        val selectedGenre = _uiState.value.carouselGenre
        val selectedRecommendation = _uiState.value.recommendationSource

        rowJobs[section] = viewModelScope.launch {
            _uiState.update { it.copy(rowLoading = it.rowLoading + section, rowErrors = it.rowErrors - section) }
            try {
                val items = loadRow(section, selectedFilter, selectedProvider, selectedGenre, selectedRecommendation)
                if (isCurrent()) {
                    _uiState.update { it.copy(sections = it.sections + (section to items)) }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (isCurrent()) {
                    _uiState.update { it.copy(rowErrors = it.rowErrors + (section to (e.message ?: "Failed to load"))) }
                }
            } finally {
                if (isCurrent()) {
                    _uiState.update { it.copy(rowLoading = it.rowLoading - section) }
                }
            }
        }
    }

    companion object {
        fun provideFactory(
            mediaRepo: MediaRepository,
            historyRepo: HistoryRepository,
            bookmarksRepo: BookmarksRepository,
            addonsRepo: AddonsRepository,
            settingsRepo: SettingsRepository
        ): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                return DiscoverViewModel(mediaRepo, historyRepo, bookmarksRepo, addonsRepo, settingsRepo) as T
            }
        }
    }
}
