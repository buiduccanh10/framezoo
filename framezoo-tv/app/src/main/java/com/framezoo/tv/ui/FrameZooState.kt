package com.framezoo.tv.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.framezoo.tv.api.Addons
import com.framezoo.tv.api.Backend
import com.framezoo.tv.model.Addon
import com.framezoo.tv.model.DiscoverFilter
import com.framezoo.tv.model.DiscoverOption
import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.LibraryItem
import com.framezoo.tv.model.Media
import com.framezoo.tv.model.Stream
import com.framezoo.tv.model.Subtitle
import com.framezoo.tv.player.PlayerController
import com.framezoo.tv.storage.SecureStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.CancellationException

internal class FrameZooState(context: Context, private val scope: CoroutineScope) {
    val store = SecureStore(context)
    val backend = Backend(store)
    private val addons = Addons(context, backend, store)
    val player = PlayerController(context)

    var page by mutableStateOf("discover")
    var theme by mutableStateOf(store.theme.lowercase().let { if (it in themeNames) it else "default" })
    var customPrimary by mutableStateOf(store.customPrimary)
    var customSecondary by mutableStateOf(store.customSecondary)
    var customTertiary by mutableStateOf(store.customTertiary)
    var busy by mutableStateOf(false)
    var error by mutableStateOf("")
    var discover by mutableStateOf<List<Media>>(emptyList())
    var filter by mutableStateOf(DiscoverFilter())
    var genres by mutableStateOf<List<DiscoverOption>>(emptyList())
    var countries by mutableStateOf<List<DiscoverOption>>(emptyList())
    var sections by mutableStateOf<Map<String, List<Media>>>(emptyMap())
    var discoverLoading by mutableStateOf(false)
    var discoverError by mutableStateOf("")
    private var discoverJob: Job? = null
    var addonCatalog by mutableStateOf<List<Media>>(emptyList())
    var results by mutableStateOf<List<Media>>(emptyList())
    var library by mutableStateOf<List<LibraryItem>>(emptyList())
    var installed by mutableStateOf<List<Addon>>(emptyList())
    var selected by mutableStateOf<Media?>(null)
    var seasons by mutableStateOf<List<Int>>(emptyList())
    var episodes by mutableStateOf<List<Episode>>(emptyList())
    private var addonEpisodes by mutableStateOf<List<Episode>>(emptyList())
    var episode by mutableStateOf<Episode?>(null)
    var sources by mutableStateOf<List<Stream>>(emptyList())
    var playing by mutableStateOf<Stream?>(null)
    private var recentResume by mutableStateOf<Triple<String, Episode?, Double>?>(null)
    var subtitles by mutableStateOf<List<Subtitle>>(emptyList())
    var query by mutableStateOf("")
    var addonUrl by mutableStateOf("")
    var loginName by mutableStateOf("")
    var loginPassword by mutableStateOf("")
    var backendUrl by mutableStateOf(store.backendUrl)

    suspend fun initialize() {
        try { discover = backend.discover() } catch (e: Exception) { error = e.message ?: "Không tải được Discover" }
        refreshDiscover()
        installed = addons.list()
        addonCatalog = addons.catalog()
        if (store.userId != null) runCatching { library = backend.library() }
    }

    fun refreshDiscover() {
        discoverJob?.cancel()
        val selectedFilter = filter
        discoverJob = scope.launch {
            discoverLoading = true; discoverError = ""
            try {
                if (genres.isEmpty() || countries.isEmpty()) {
                    val options = backend.discoverOptions(); genres = options.first; countries = options.second
                }
                sections = coroutineScope {
                    listOf("trending", "popular", "netflix", "top").associateWith { section ->
                        async { backend.discoverSection(selectedFilter, section) }
                    }.mapValues { it.value.await() }
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { sections = emptyMap(); discoverError = e.message ?: "Không tải được nội dung" }
            finally { if (filter == selectedFilter) discoverLoading = false }
        }
    }
    fun updateFilter(value: DiscoverFilter) { if (filter != value) { filter = value; refreshDiscover() } }

    fun runTask(block: suspend () -> Unit) {
        scope.launch {
            busy = true; error = ""
            try { block() } catch (e: Exception) { error = e.message ?: "Lỗi không rõ" }
            finally { busy = false }
        }
    }

    fun openDetails(item: Media) = runTask {
        if (item.addonManifest != null) {
            val (detail, videos) = addons.details(item)
            selected = detail; addonEpisodes = videos; seasons = videos.map { it.season }.distinct(); episodes = emptyList()
        } else {
            val (detail, seasonList) = backend.details(item)
            selected = detail; seasons = seasonList; episodes = emptyList(); addonEpisodes = emptyList()
        }
        episode = null; page = "details"
    }

    fun loadSources(item: Media, target: Episode?) = runTask {
        selected = item; episode = target
        sources = addons.streams(item, target)
        subtitles = addons.subtitles(item, target)
        page = "sources"
    }

    fun openLibrary() = runTask { library = backend.library(); page = "library" }
    fun openAddons() = runTask { installed = addons.list(); page = "addons" }
    fun search() = runTask { results = backend.search(query) }
    fun bookmark(item: Media) = runTask { backend.bookmark(item) }
    fun chooseSeason(item: Media, season: Int) {
        if (item.addonManifest != null) episodes = addonEpisodes.filter { it.season == season }
        else runTask { episodes = backend.episodes(item.id, season) }
    }
    fun chooseSource(source: Stream) { playing = source; page = "player" }
    fun installAddon() = runTask { addons.install(addonUrl); installed = addons.list(); addonCatalog = addons.catalog(); addonUrl = "" }
    fun removeAddon(addon: Addon) = runTask { addons.remove(addon.manifestUrl); installed = addons.list(); addonCatalog = addons.catalog() }
    fun saveBackend() = runTask {
        val previous = store.backendUrl
        store.backendUrl = backendUrl
        backendUrl = store.backendUrl
        if (previous != backendUrl) {
            discoverJob?.cancel(); library = emptyList(); discover = emptyList(); sections = emptyMap(); genres = emptyList(); countries = emptyList()
            initialize()
        }
    }
    fun updateTheme(name: String) { theme = name; store.theme = name }
    fun updateCustomPart(part: String, name: String) {
        require(name in themeNames && name != "custom")
        when (part) {
            "primary" -> { customPrimary = name; store.customPrimary = name }
            "secondary" -> { customSecondary = name; store.customSecondary = name }
            "tertiary" -> { customTertiary = name; store.customTertiary = name }
        }
    }
    fun login() = runTask {
        backend.login(loginName, loginPassword)
        installed = addons.list(); library = backend.library(); page = "discover"; loginPassword = ""
    }
    fun logout() { store.clearSession(); library = emptyList(); page = "discover" }
    fun resume(item: Media, target: Episode?): Double {
        val saved = library.firstOrNull { it.media.id == item.id && it.season == target?.season && it.episode == target?.number }?.position ?: 0.0
        return recentResume?.takeIf { it.first == item.id && it.second == target }?.third ?: saved
    }
    fun stopped(item: Media, target: Episode?, position: Double) { recentResume = Triple(item.id, target, position) }
    fun back() {
        page = when (page) {
            "player" -> "sources"
            "sources" -> "details"
            else -> "discover"
        }
    }
}
