package com.framezoo.tv.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import com.framezoo.tv.api.Addons
import com.framezoo.tv.api.Backend
import com.framezoo.tv.model.Addon
import com.framezoo.tv.model.BookmarkDetails
import com.framezoo.tv.model.AddonCatalog
import com.framezoo.tv.model.CuratedList
import com.framezoo.tv.model.DiscoverFilter
import com.framezoo.tv.model.DiscoverOption
import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.LibraryItem
import com.framezoo.tv.model.Media
import com.framezoo.tv.model.Stream
import com.framezoo.tv.model.Subtitle
import com.framezoo.tv.model.WatchPartyError
import com.framezoo.tv.model.WatchPartyException
import com.framezoo.tv.model.parseWatchPartyCode
import com.framezoo.tv.player.PlayerController
import com.framezoo.tv.storage.SecureStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.CancellationException
import org.json.JSONObject

internal class FrameZooState(context: Context, private val scope: CoroutineScope) {
    val store = SecureStore(context)
    val i18n = I18n(context, store.language)
    val backend = Backend(store)
    private val addons = Addons(context, backend, store)
    val player = PlayerController(context)

    fun setLanguage(lang: String) { store.language = lang; i18n.setLanguage(lang) }

    var trailerEnabled by mutableStateOf(store.trailerEnabled)
        private set
    var trailerMuted by mutableStateOf(store.trailerMuted)
        private set
    fun toggleTrailer() { trailerEnabled = !trailerEnabled; store.trailerEnabled = trailerEnabled }
    fun toggleTrailerAudio() { trailerMuted = !trailerMuted; store.trailerMuted = trailerMuted }

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
    private val discoverData = JSONObject(context.assets.open("discover.json").bufferedReader().use { it.readText() })
    private fun options(key: String): List<DiscoverOption> = discoverData.getJSONArray(key).let { data ->
        (0 until data.length()).map { data.getJSONObject(it).let { item -> DiscoverOption(item.getString("id"), item.getString("name")) } }
    }
    fun providersFor(category: String): List<DiscoverOption> = when (category) {
        "movie" -> options("MOVIE_PROVIDERS")
        "tv" -> options("TV_PROVIDERS")
        else -> (options("MOVIE_PROVIDERS") + options("TV_PROVIDERS")).distinctBy { it.id }
    }
    val providers: List<DiscoverOption> get() = providersFor(filter.category)
    private val editorPicks = listOf("MOVIES_DATA", "TV_SHOWS_DATA").flatMap { key ->
        discoverData.getJSONArray(key).let { data -> (0 until data.length()).map { data.getJSONObject(it).let { item -> item.getString("id") to item.getString("type") } } }
    }.shuffled()
    var recommendationSource by mutableStateOf("")
    val recommendationSources: List<Media> get() = progress.map { it.media }
        .filter { it.id.isNotEmpty() && it.id.all(Char::isDigit) && it.type == if (filter.category == "tv") "show" else "movie" }
        .distinctBy { "${it.type}:${it.id}" }
    val hasPersonalSources: Boolean get() = (history.map { it.media } + progress.map { it.media } + bookmarks).any {
        it.id.isNotEmpty() && it.id.all(Char::isDigit) && it.type == if (filter.category == "tv") "show" else "movie"
    }
    var provider by mutableStateOf("8")
    var carouselGenre by mutableStateOf("")
    var discoverLoading by mutableStateOf(false)
    var discoverError by mutableStateOf("")
    private var discoverJob: Job? = null
    private val rowJobs = mutableMapOf<String, Job>()
    private var discoverGeneration = 0
    private val rowGeneration = mutableMapOf<String, Int>()
    var rowErrors by mutableStateOf<Map<String, String>>(emptyMap())
    var rowLoading by mutableStateOf<Set<String>>(emptySet())
    var addonCatalog by mutableStateOf<List<AddonCatalog>>(emptyList())
    var allLists by mutableStateOf<Map<String, List<Media>>>(emptyMap())
    var allListsLoading by mutableStateOf(false)
    var allListsError by mutableStateOf("")
    var curatedLists by mutableStateOf<List<CuratedList>>(emptyList())
    var curatedItems by mutableStateOf<Map<String, List<Media>>>(emptyMap())
    var curatedErrors by mutableStateOf<Set<String>>(emptySet())
    private val curatedJobs = mutableMapOf<String, Job>()
    private var allListsJob: Job? = null
    private var moreReturnPage = "discover"
    var moreFilter by mutableStateOf(DiscoverFilter())
        private set
    var moreProvider by mutableStateOf("8")
        private set
    var moreGenre by mutableStateOf("")
        private set
    var moreRecommendation by mutableStateOf("")
        private set
    private var moreAddon: AddonCatalog? = null
    var focusReturnSection by mutableStateOf<String?>(null)
    var moreTitle by mutableStateOf("")
    var moreSection by mutableStateOf("")
    var moreItems by mutableStateOf<List<Media>>(emptyList())
    var morePage by mutableStateOf(1)
    var moreGeneration by mutableIntStateOf(0)
    var focusReturnMediaId by mutableStateOf<String?>(null)
    var moreHasNext by mutableStateOf(false)
    var moreLoading by mutableStateOf(false)
    var moreError by mutableStateOf("")
    private var moreJob: Job? = null
    private var detailsReturnPage = "discover"
    private data class DetailsSnapshot(val media: Media, val seasons: List<Int>, val episodes: List<Episode>, val addonEpisodes: List<Episode>, val selectedSeason: Int?)
    private val detailsStack = mutableListOf<DetailsSnapshot>()
    private var seasonJob: Job? = null
    var selectedSeason by mutableStateOf<Int?>(null)
    var episodesLoading by mutableStateOf(false)
    var trailerKey by mutableStateOf("")
    var trailerTitle by mutableStateOf("")
    var userId by mutableStateOf(store.userId)
        private set
    val isLoggedIn: Boolean
        get() = userId != null
    var userNickname by mutableStateOf(store.userNickname)
        private set
    var userDeviceName by mutableStateOf(store.userDeviceName)
        private set
    var userEmail by mutableStateOf(store.userEmail)
        private set
    var userProfileColorA by mutableStateOf(store.userProfileColorA)
        private set
    var userProfileColorB by mutableStateOf(store.userProfileColorB)
        private set
    var userProfileIcon by mutableStateOf(store.userProfileIcon)
        private set

    fun syncUserProfile() {
        userId = store.userId
        userNickname = store.userNickname
        userDeviceName = store.userDeviceName
        userEmail = store.userEmail
        userProfileColorA = store.userProfileColorA
        userProfileColorB = store.userProfileColorB
        userProfileIcon = store.userProfileIcon
    }
    private var loginReturnPage = "discover"

    // Watch party join dialog (desktop WatchPartyJoinDialog)
    var watchPartyDialogOpen by mutableStateOf(false)
        private set
    var watchPartyCodeInput by mutableStateOf("")
    var watchPartyError by mutableStateOf<String?>(null)
        private set
    var watchPartyLoading by mutableStateOf(false)
        private set
    var activeWatchParty by mutableStateOf<String?>(null)
        private set

    /** Desktop `openDialog`: requires account, otherwise opens login. */
    fun openWatchParty() {
        if (store.userId == null) { openLogin(); return }
        watchPartyCodeInput = ""; watchPartyError = null; watchPartyDialogOpen = true
    }
    fun closeWatchParty() { watchPartyDialogOpen = false; watchPartyError = null; watchPartyLoading = false }

    /** Desktop `handleProtectedRoute`: history/bookmarks need login. */
    fun openProtected(open: () -> Unit) { if (store.userId == null) openLogin() else open() }

    fun submitWatchParty() {
        if (store.userId == null) { closeWatchParty(); openLogin(); return }
        val code = parseWatchPartyCode(watchPartyCodeInput)
        if (code == null) { watchPartyError = i18n.t("watchParty.invalidRoom"); return }
        watchPartyLoading = true; watchPartyError = null
        scope.launch {
            try {
                val host = backend.watchPartyHost(code)
                activeWatchParty = code
                closeWatchParty()
                openDetails(Media(id = host.tmdbId, type = if (host.isShow) "show" else "movie", title = host.title))
                if (host.isShow && host.season != null) chooseSeason(selected ?: Media(host.tmdbId, "show", host.title), host.season)
            } catch (e: CancellationException) { throw e }
            catch (e: WatchPartyException) {
                watchPartyError = i18n.t(if (e.kind == WatchPartyError.EMPTY_ROOM) "watchParty.emptyRoom" else "watchParty.noHost")
            } catch (_: Exception) {
                watchPartyError = i18n.t("watchParty.invalidRoom")
            } finally { watchPartyLoading = false }
        }
    }
    private var feedbackReturnPage = "discover"
    var results by mutableStateOf<List<Media>>(emptyList())
    var searchCountry by mutableStateOf("")
    var searchYear by mutableStateOf("")
    var searchGenre by mutableStateOf("")
    var searchLoading by mutableStateOf(false)
    var searchError by mutableStateOf("")
    var searchedQuery by mutableStateOf("")
    private var searchJob: Job? = null
    private var searchGeneration = 0
    var library by mutableStateOf<List<LibraryItem>>(emptyList())
    var history by mutableStateOf<List<LibraryItem>>(emptyList())
    var progress by mutableStateOf<List<LibraryItem>>(emptyList())
    var bookmarks by mutableStateOf<List<Media>>(emptyList())
    var bookmarkDetails by mutableStateOf<List<BookmarkDetails>>(emptyList())
    var bookmarkGroups by mutableStateOf<List<String>>(emptyList())
    private val savingBookmarks = mutableSetOf<String>()
    var installed by mutableStateOf<List<Addon>>(emptyList())
    var selected by mutableStateOf<Media?>(null)
    var seasons by mutableStateOf<List<Int>>(emptyList())
    var episodes by mutableStateOf<List<Episode>>(emptyList())
    private var addonEpisodes by mutableStateOf<List<Episode>>(emptyList())
    var episode by mutableStateOf<Episode?>(null)
    var sources by mutableStateOf<List<Stream>>(emptyList())
    var sourcesLoading by mutableStateOf(false)
    var playing by mutableStateOf<Stream?>(null)
    private var recentResume by mutableStateOf<Triple<String, Episode?, Double>?>(null)
    var subtitles by mutableStateOf<List<Subtitle>>(emptyList())
    var query by mutableStateOf("")
    var addonUrl by mutableStateOf("")
    var loginName by mutableStateOf("")
    var loginPassword by mutableStateOf("")
    var isOffline by mutableStateOf(false)
    val backendUrl: String get() = store.backendUrl

    suspend fun initialize() {
        try {
            discover = backend.discover()
            isOffline = false
        } catch (e: Exception) {
            isOffline = true
            error = e.message ?: i18n.t("auth.login.failedToReachServer")
            discoverError = error
        }
        refreshDiscover()
        installed = addons.list()
        addonCatalog = addons.catalog()
        if (store.userId != null) {
            try { refreshUserData(); if (library.isNotEmpty()) refreshDiscover() }
            catch (e: CancellationException) { throw e } catch (_: Exception) { }
        } else {
            progress = backend.loadLocalProgress()
        }
    }

    fun refreshDiscover() {
        val generation = ++discoverGeneration
        discoverJob?.cancel()
        rowJobs.values.forEach { it.cancel() }; rowJobs.clear(); rowErrors = emptyMap(); rowLoading = emptySet()
        val selectedFilter = filter
        val selectedProvider = provider
        discoverJob = scope.launch {
            discoverLoading = true; discoverError = ""
            try {
                if (genres.isEmpty() || countries.isEmpty()) {
                    val options = backend.discoverOptions(); genres = options.first; countries = options.second
                }
                val genre = carouselGenre.ifBlank { genres.firstOrNull()?.id.orEmpty() }
                if (carouselGenre.isBlank()) carouselGenre = genre
                val keys = if (selectedFilter.category.startsWith("genre:")) listOf("genre") else buildList {
                    add("trending"); if (selectedFilter.category == "all") add("popular")
                    addAll(listOf("provider", "top", "editor", "latest"))
                    if (selectedFilter.category in listOf("movie", "tv")) {
                        if (hasPersonalSources) add("personal")
                        if (recommendationSources.isNotEmpty()) add("recommendations")
                    }
                    add("genre")
                }
                if (recommendationSources.none { it.id == recommendationSource }) recommendationSource = recommendationSources.firstOrNull()?.id.orEmpty()
                sections = emptyMap()
                coroutineScope { keys.map { section ->
                    val rowVersion = rowGeneration[section] ?: 0
                    async {
                    fun current() = discoverGeneration == generation && (rowGeneration[section] ?: 0) == rowVersion
                    val items = try {
                        discoverRow(section, selectedFilter, selectedProvider, genre)
                    } catch (e: CancellationException) { throw e } catch (e: Exception) {
                        if (current()) rowErrors = rowErrors + (section to (e.message ?: i18n.t("auth.login.failedToReachServer"))); emptyList()
                    }
                    if (current() && filter == selectedFilter && (section != "provider" || provider == selectedProvider) && (section != "genre" || carouselGenre == genre)) {
                        sections = sections + (section to items)
                    }
                } }.forEach { it.await() } }
                if (sections.values.all { it.isEmpty() }) discoverError = i18n.t("auth.login.failedToReachServer")
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { sections = emptyMap(); discoverError = e.message ?: i18n.t("auth.login.failedToReachServer") }
            finally { if (discoverGeneration == generation) discoverLoading = false }
        }
    }
    fun updateFilter(value: DiscoverFilter) { if (filter != value) { filter = value; if (providers.none { it.id == provider }) provider = providers.firstOrNull()?.id ?: "8"; refreshDiscover() } }
    private suspend fun discoverRow(section: String, selectedFilter: DiscoverFilter, selectedProvider: String, genre: String, selectedRecommendation: String = recommendationSource): List<Media> {
        if (section == "editor") return backend.editorPicks(selectedFilter, editorPicks)
        if (section == "personal" || section == "recommendations") {
            val type = if (selectedFilter.category == "tv") "show" else "movie"
            val chosen = if (section == "personal") personalSources(type, history, progress, bookmarks)
                else recommendationSources.filter { it.id == selectedRecommendation }.take(1)
            val existing = (history.map { it.media } + progress.map { it.media } + bookmarks).map { it.id }.toSet()
            return coroutineScope { chosen.map { source -> async {
                try { backend.recommendations(source).take(if (section == "personal") 10 else 20) }
                catch (e: CancellationException) { throw e } catch (_: Exception) { emptyList() }
            } }.map { it.await() }.flatten() }
                .filter { it.id !in existing && (selectedFilter.year.isEmpty() || it.year == selectedFilter.year) &&
                    (selectedFilter.country.isEmpty() || selectedFilter.country in it.originCountries) }
                .distinctBy { it.id }
        }
        return backend.discoverSection(selectedFilter, section, selectedProvider, if (section == "genre") genre else "")
    }
    fun selectRecommendation(id: String) { if (recommendationSource != id) { recommendationSource = id; refreshRow("recommendations") } }
    fun selectProvider(id: String) { if (provider != id) { provider = id; refreshRow("provider") } }
    fun selectGenre(id: String) { if (carouselGenre != id) { carouselGenre = id; refreshRow("genre") } }
    fun refreshRow(section: String) {
        rowJobs.remove(section)?.cancel()
        val generation = discoverGeneration
        val rowVersion = (rowGeneration[section] ?: 0) + 1
        rowGeneration[section] = rowVersion
        fun current() = discoverGeneration == generation && rowGeneration[section] == rowVersion
        val selectedFilter = filter; val selectedProvider = provider; val selectedGenre = carouselGenre
        rowJobs[section] = scope.launch {
            rowLoading = rowLoading + section; rowErrors = rowErrors - section
            try {
                val items = discoverRow(section, selectedFilter, selectedProvider, selectedGenre)
                if (current()) sections = sections + (section to items)
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                if (current()) rowErrors = rowErrors + (section to (e.message ?: i18n.t("auth.login.failedToReachServer")))
            } finally {
                if (current()) rowLoading = rowLoading - section
            }
        }
    }
    fun openAllLists() {
        page = "discover-lists"; allListsJob?.cancel(); allLists = emptyMap(); allListsError = ""
        curatedJobs.values.forEach { it.cancel() }; curatedJobs.clear(); curatedLists = emptyList(); curatedItems = emptyMap(); curatedErrors = emptySet()
        allListsJob = scope.launch {
            allListsLoading = true
            try {
                coroutineScope {
                  val curated = async { try { backend.curatedLists() } catch (e: CancellationException) { throw e } catch (_: Exception) { emptyList() } }
                  listOf("latest", "latest4k", "popular", "trending").map { key -> async {
                    val items = try { backend.discoverSection(DiscoverFilter(category = "movie"), key) }
                        catch (e: CancellationException) { throw e } catch (_: Exception) { emptyList() }
                    allLists = allLists + (key to items)
                  } }.forEach { it.await() }
                  curatedLists = curated.await()
                }
                if (allLists.values.all { it.isEmpty() }) allListsError = i18n.t("auth.login.failedToReachServer")
            } finally { allListsLoading = false }
        }
    }
    fun loadCurated(list: CuratedList) {
        if (curatedJobs[list.slug]?.isActive == true || list.slug in curatedItems) return
        curatedErrors = curatedErrors - list.slug
        curatedJobs[list.slug] = scope.launch {
            try { curatedItems = curatedItems + (list.slug to backend.movieDetails(list.ids)) }
            catch (e: CancellationException) { throw e } catch (_: Exception) { curatedErrors = curatedErrors + list.slug }
        }
    }
    fun openMore(section: String, title: String, items: List<Media>, addon: AddonCatalog? = null) {
        moreReturnPage = if (page == "discover-lists") page else "discover"
        moreFilter = if (moreReturnPage == "discover-lists") DiscoverFilter(category = "movie") else filter
        moreProvider = provider; moreGenre = carouselGenre; moreRecommendation = recommendationSource
        moreJob?.cancel(); moreSection = section; moreTitle = title; moreItems = items; moreAddon = addon; moreGeneration++; focusReturnMediaId = null
        morePage = 1; moreHasNext = when (section) {
            addon?.key -> items.size >= 20
            "personal", "recommendations", "latest4k" -> false
            "editor" -> items.isNotEmpty() && editorPicks.count { filter.category == "all" || it.second == if (filter.category == "tv") "show" else "movie" } > 20
            else -> !section.startsWith("curated:") && items.isNotEmpty()
        }
        moreError = ""; moreLoading = false; page = "discover-more"
    }
    fun loadMore() {
        if (moreLoading || !moreHasNext) return
        val target = moreSection; val nextPage = morePage + 1; val generation = moreGeneration
        moreLoading = true; moreError = ""
        moreJob = scope.launch {
            try {
                val addon = moreAddon
                val (next, hasNext) = if (addon != null) addons.catalogPage(addon.manifestUrl, addon.type, addon.id, (nextPage - 1) * 50).let { it to (it.size >= 20) }
                    else if (target == "editor") backend.editorPicks(moreFilter, editorPicks, nextPage) to (nextPage * 20 < editorPicks.count { moreFilter.category == "all" || it.second == if (moreFilter.category == "tv") "show" else "movie" })
                    else backend.discoverSectionPage(moreFilter, target, moreProvider, if (target == "genre") moreGenre else "", nextPage)
                if (generation != moreGeneration) return@launch
                val existingIds = moreItems.map { "${it.type}:${it.id}" }.toSet()
                val previousCount = moreItems.size
                moreItems = (moreItems + next).distinctBy { "${it.type}:${it.id}" }
                val focusItem = next.firstOrNull { "${it.type}:${it.id}" !in existingIds } ?: moreItems.lastOrNull()
                if (page == "discover-more" && focusItem != null) focusReturnMediaId = "${focusItem.type}:${focusItem.id}:${focusItem.addonManifest}"
                morePage = nextPage; moreHasNext = hasNext && (addon == null || moreItems.size > previousCount)
            } catch (e: CancellationException) { throw e } catch (e: Exception) { moreError = e.message ?: i18n.t("auth.login.failedToReachServer") }
            finally { if (generation == moreGeneration) moreLoading = false }
        }
    }
    fun updateMoreFilter(value: DiscoverFilter = moreFilter, selectedProvider: String = moreProvider, selectedGenre: String = moreGenre, selectedRecommendation: String = moreRecommendation, force: Boolean = false) {
        if (!force && moreFilter == value && moreProvider == selectedProvider && moreGenre == selectedGenre && moreRecommendation == selectedRecommendation) return
        moreJob?.cancel(); moreGeneration++; moreFilter = value; moreProvider = selectedProvider; moreGenre = selectedGenre; moreRecommendation = selectedRecommendation
        morePage = 1; moreItems = emptyList(); moreError = ""; moreHasNext = false
        val section = moreSection
        val generation = moreGeneration
        moreLoading = true
        moreJob = scope.launch {
            try {
                val (items, hasNext) = if (section == "editor") backend.editorPicks(value, editorPicks) to (editorPicks.count { value.category == "all" || it.second == if (value.category == "tv") "show" else "movie" } > 20)
                    else if (section in listOf("personal", "recommendations")) discoverRow(section, value, selectedProvider, selectedGenre, selectedRecommendation) to false
                    else backend.discoverSectionPage(value, section, selectedProvider, if (section == "genre") selectedGenre else "")
                if (generation != moreGeneration) return@launch
                moreItems = items
                moreHasNext = hasNext
            } catch (e: CancellationException) { throw e } catch (e: Exception) { moreError = e.message ?: i18n.t("auth.login.failedToReachServer") }
            finally { if (generation == moreGeneration) moreLoading = false }
        }
    }

    fun runTask(block: suspend () -> Unit) {
        scope.launch {
            busy = true; error = ""
            try { block() } catch (e: CancellationException) { throw e } catch (e: Exception) { error = e.message ?: i18n.t("auth.login.failedToReachServer") }
            finally { busy = false }
        }
    }

    fun openDetails(item: Media) = runTask {
        val fromPage = page
        val previous = selected?.let { DetailsSnapshot(it, seasons, episodes, addonEpisodes, selectedSeason) }
        seasonJob?.cancel()
        if (item.addonManifest != null) {
            val (detail, videos) = addons.details(item)
            selected = detail; addonEpisodes = videos; seasons = videos.map { it.season }.distinct(); episodes = emptyList()
        } else {
            val (detail, seasonList) = backend.details(item)
            selected = detail; seasons = seasonList; episodes = emptyList(); addonEpisodes = emptyList()
        }
        if (fromPage == "details" && previous != null) detailsStack.add(previous)
        else { detailsReturnPage = fromPage; detailsStack.clear() }
        selectedSeason = null
        episode = null; page = "details"
    }

    fun playFeatured(item: Media) {
        if (page != "details") { detailsReturnPage = page; detailsStack.clear() }
        val saved = progress.firstOrNull { it.media.id == item.id && it.media.type == item.type && it.position > 0 }
        val initialTarget = if (item.type == "show" && saved?.season != null && saved.episode != null) {
            Episode(
                id = "${item.id}:${saved.season}:${saved.episode}",
                number = saved.episode,
                season = saved.season,
                title = "",
                overview = "",
                still = "",
                airDate = "",
                seasonId = ""
            )
        } else null
        selected = item
        episode = initialTarget
        sources = emptyList()
        subtitles = emptyList()
        sourcesLoading = true
        page = "sources"

        scope.launch {
            try {
                val (detail, seasonList) = backend.details(item)
                selected = detail
                seasons = seasonList
                val resolvedTarget = if (item.type == "show") {
                    val season = saved?.season ?: seasonList.firstOrNull()
                    season?.let { number ->
                        val eps = backend.episodes(item.id, number)
                        saved?.episode?.let { ep -> eps.firstOrNull { it.number == ep } } ?: eps.firstOrNull()
                    }
                } else null
                episode = resolvedTarget
                if (item.type == "show" && resolvedTarget == null) {
                    sourcesLoading = false
                    page = "details"
                    return@launch
                }
                val streamList = addons.streams(detail, resolvedTarget)
                val subList = addons.subtitles(detail, resolvedTarget)
                sources = streamList
                subtitles = subList
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: "Failed to load sources"
            } finally {
                sourcesLoading = false
            }
        }
    }
    fun playRandom(item: Media) = playFeatured(item)

    fun loadSources(item: Media, target: Episode?) {
        selected = item
        episode = target
        sources = emptyList()
        subtitles = emptyList()
        sourcesLoading = true
        page = "sources"

        scope.launch {
            try {
                val streamList = addons.streams(item, target)
                val subList = addons.subtitles(item, target)
                sources = streamList
                subtitles = subList
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.message ?: "Failed to load sources"
            } finally {
                sourcesLoading = false
            }
        }
    }

    internal suspend fun refreshUserData() = coroutineScope {
        val userMe = async {
            try {
                backend.getMe()
            } catch (_: Exception) {
                null
            }
        }
        val saved = async { runCatching { backend.bookmarkDetails() }.getOrDefault(emptyList()) }
        val groups = async { runCatching { backend.bookmarkGroups() }.getOrDefault(emptyList()) }
        val watched = async { runCatching { backend.watchHistory() }.getOrDefault(emptyList()) }
        val ongoing = async { runCatching { backend.watchProgress() }.getOrDefault(emptyList()) }
        userMe.await()
        syncUserProfile()
        if (store.userId == null) {
            library = emptyList()
            history = emptyList()
            progress = backend.loadLocalProgress()
            bookmarks = emptyList()
            bookmarkDetails = emptyList()
            bookmarkGroups = emptyList()
            return@coroutineScope
        }
        bookmarkDetails = saved.await(); bookmarks = bookmarkDetails.map { it.media }; bookmarkGroups = (groups.await() + bookmarkDetails.flatMap { it.groups }).distinct(); history = watched.await(); progress = ongoing.await()
        library = (bookmarks.map { LibraryItem(it) } + history + progress)
            .associateBy { "${it.media.id}:${it.season ?: -1}:${it.episode ?: -1}" }.values.toList()
    }
    fun openLibrary() = runTask {
        if (store.userId != null) refreshUserData()
        page = "library"
    }
    fun openHistory() = runTask {
        if (store.userId != null) history = backend.watchHistory()
        page = "history"
    }
    fun openAddons() = runTask { installed = addons.list(); page = "addons" }
    fun search() {
        val term = query.trim()
        searchJob?.cancel(); val generation = ++searchGeneration
        searchedQuery = term; searchGenre = ""; searchError = ""; results = emptyList()
        if (term.isEmpty()) { results = emptyList(); searchLoading = false; return }
        searchLoading = true
        searchJob = scope.launch {
            try {
                val initial = backend.search(term)
                if (generation != searchGeneration) return@launch
                results = initial; searchLoading = false
                val enriched = backend.enrichSearch(initial)
                if (generation == searchGeneration) results = enriched
            }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { searchError = e.message ?: i18n.t("auth.login.failedToReachServer") }
            finally { if (searchGeneration == generation) searchLoading = false }
        }
    }
    fun bookmark(item: Media) {
        if (store.userId == null) {
            if (page in listOf("discover-more", "search")) focusReturnMediaId = "${item.type}:${item.id}:${item.addonManifest}"
            if (page == "discover") focusReturnSection = sections.entries.firstOrNull { (_, items) -> items.any { it.id == item.id && it.type == item.type } }?.key
                ?: addonCatalog.firstOrNull { group -> group.items.any { it.id == item.id && it.type == item.type } }?.key
            openLogin(); return
        }
        if (!savingBookmarks.add(item.id)) return
        runTask {
            try {
                val remove = bookmarks.any { it.id == item.id }
                backend.bookmark(item, remove)
                bookmarks = if (remove) bookmarks.filterNot { it.id == item.id } else bookmarks + item
                refreshUserData()
                if (filter.category in listOf("movie", "tv")) refreshDiscover()
            } finally { savingBookmarks.remove(item.id) }
        }
    }
    fun updateBookmarkGroups(item: Media, groups: List<String>) {
        if (store.userId == null) { openLogin(); return }
        if (!savingBookmarks.add(item.id)) return
        runTask {
            try {
                val existing = backend.bookmarkDetails().firstOrNull { it.media.id == item.id }
                backend.saveBookmarkDetails(item, groups.distinct(), existing?.favoriteEpisodes.orEmpty())
                refreshUserData()
            } finally { savingBookmarks.remove(item.id) }
        }
    }
    fun bookmarkCollection(items: List<Media>, group: String) {
        if (busy) return
        if (store.userId == null) { openLogin(); return }
        runTask {
            val existing = backend.bookmarkDetails().associateBy { it.media.id }
            items.filter { it.id.isNotBlank() && it.id.all(Char::isDigit) && it.year.isNotBlank() }.forEach { item ->
                val bookmark = existing[item.id]
                backend.saveBookmarkDetails(item, (bookmark?.groups.orEmpty() + group).distinct(), bookmark?.favoriteEpisodes.orEmpty())
            }
            refreshUserData()
        }
    }
    fun toggleFavoriteEpisode(item: Media, episode: Episode) {
        if (store.userId == null) { openLogin(); return }
        if (!savingBookmarks.add(item.id)) return
        runTask {
            try {
                val existing = backend.bookmarkDetails().firstOrNull { it.media.id == item.id }
                val favorites = existing?.favoriteEpisodes.orEmpty()
                val next = if (episode.id in favorites) favorites - episode.id else favorites + episode.id
                backend.saveBookmarkDetails(item, existing?.groups.orEmpty(), next)
                refreshUserData()
            } finally { savingBookmarks.remove(item.id) }
        }
    }
    fun markEpisodeWatched(item: Media, episode: Episode, watched: Boolean) {
        if (store.userId == null) { openLogin(); return }
        runTask {
            val existing = (progress + history).firstOrNull { it.media.id == item.id && it.season == episode.season && it.episode == episode.number }
            backend.markEpisodeWatched(item, episode, watched, existing); refreshUserData()
        }
    }
    fun markSeasonWatched(item: Media, targets: List<Episode>, watched: Boolean) {
        if (busy) return
        if (store.userId == null) { openLogin(); return }
        runTask {
            targets.forEach { episode ->
                val existing = (progress + history).firstOrNull { it.media.id == item.id && it.season == episode.season && it.episode == episode.number }
                backend.markEpisodeWatched(item, episode, watched, existing)
            }
            refreshUserData()
        }
    }
    fun markMovieWatched(item: Media, watched: Boolean) {
        if (store.userId == null) { openLogin(); return }
        runTask { backend.markMovieWatched(item, watched); refreshUserData() }
    }
    fun removeProgressItem(item: LibraryItem) {
        progress = progress.filter { it.media.id != item.media.id }
        if (store.userId != null) {
            scope.launch {
                try { backend.removeProgress(item.media.id) } catch (_: Exception) {}
            }
        }
    }
    fun chooseSeason(item: Media, season: Int) {
        seasonJob?.cancel(); selectedSeason = season; episodes = emptyList()
        episodesLoading = item.addonManifest == null
        if (item.addonManifest != null) episodes = addonEpisodes.filter { it.season == season }
        else seasonJob = scope.launch {
            try { episodes = backend.episodes(item.id, season) }
            catch (e: CancellationException) { throw e } catch (e: Exception) { error = e.message ?: i18n.t("auth.login.failedToReachServer") }
            finally { if (selectedSeason == season) episodesLoading = false }
        }
    }
    fun openTrailer(key: String, title: String) { trailerKey = key; trailerTitle = title; page = "trailer" }
    var enableAutoplay by mutableStateOf(store.enableAutoplay)
        private set
    var enableSkipCredits by mutableStateOf(store.enableSkipCredits)
        private set
    var enableAutoSkipSegments by mutableStateOf(store.enableAutoSkipSegments)
        private set
    var subtitleFontSize by mutableIntStateOf(store.subtitleFontSize)
        private set
    var subtitleColor by mutableStateOf(store.subtitleColor)
        private set
    var subtitleBackgroundOpacity by mutableIntStateOf(store.subtitleBackgroundOpacity)
        private set
    var subtitleBackgroundBlurEnabled by mutableStateOf(store.subtitleBackgroundBlurEnabled)
        private set
    var subtitleFontStyle by mutableStateOf(store.subtitleFontStyle)
        private set
    var subtitleBold by mutableStateOf(store.subtitleBold)
        private set
    var subtitleVerticalPosition by mutableIntStateOf(store.subtitleVerticalPosition)
        private set
    var torrentCacheSize by mutableStateOf(store.torrentCacheSize)
        private set
    var torrentProfile by mutableStateOf(store.torrentProfile)
        private set

    fun toggleAutoplay() {
        enableAutoplay = !enableAutoplay
        store.enableAutoplay = enableAutoplay
    }

    fun toggleSkipCredits() {
        enableSkipCredits = !enableSkipCredits
        store.enableSkipCredits = enableSkipCredits
    }

    fun toggleAutoSkipSegments() {
        enableAutoSkipSegments = !enableAutoSkipSegments
        store.enableAutoSkipSegments = enableAutoSkipSegments
    }

    fun updateSubtitleFontSize(size: Int) {
        subtitleFontSize = size
        store.subtitleFontSize = size
        player.command("set", "sub-font-size", (55 * size / 100).toString())
    }

    fun updateSubtitleColor(color: String) {
        subtitleColor = color
        store.subtitleColor = color
        player.command("set", "sub-color", color)
    }

    fun updateSubtitleBackgroundOpacity(opacity: Int) {
        subtitleBackgroundOpacity = opacity
        store.subtitleBackgroundOpacity = opacity
        val alpha = (opacity * 255 / 100).toString()
        player.command("set", "sub-back-color", "0/0/0/$alpha")
    }

    fun toggleSubtitleBackgroundBlur() {
        subtitleBackgroundBlurEnabled = !subtitleBackgroundBlurEnabled
        store.subtitleBackgroundBlurEnabled = subtitleBackgroundBlurEnabled
    }

    fun updateSubtitleFontStyle(style: String) {
        subtitleFontStyle = style
        store.subtitleFontStyle = style
    }

    fun toggleSubtitleBold() {
        subtitleBold = !subtitleBold
        store.subtitleBold = subtitleBold
        player.command("set", "sub-bold", if (subtitleBold) "yes" else "no")
    }

    fun updateSubtitleVerticalPosition(pos: Int) {
        subtitleVerticalPosition = pos
        store.subtitleVerticalPosition = pos
    }

    fun resetSubtitleStyling() {
        updateSubtitleFontSize(100)
        updateSubtitleColor("#FFFFFF")
        updateSubtitleBackgroundOpacity(50)
        subtitleBackgroundBlurEnabled = false
        store.subtitleBackgroundBlurEnabled = false
        updateSubtitleFontStyle("default")
        if (subtitleBold) toggleSubtitleBold()
        updateSubtitleVerticalPosition(1)
    }

    fun updateTorrentCacheSize(size: String) {
        torrentCacheSize = size
        store.torrentCacheSize = size
    }

    fun updateTorrentProfile(profile: String) {
        torrentProfile = profile
        store.torrentProfile = profile
    }

    fun removeBookmark(item: Media) {
        if (store.userId == null) return
        if (!savingBookmarks.add(item.id)) return
        runTask {
            try {
                backend.bookmark(item, remove = true)
                bookmarks = bookmarks.filterNot { it.id == item.id }
                refreshUserData()
                if (filter.category in listOf("movie", "tv")) refreshDiscover()
            } finally { savingBookmarks.remove(item.id) }
        }
    }

    fun removeHistory(item: Media) {
        if (store.userId == null) return
        runTask {
            backend.removeHistory(item.id)
            history = history.filterNot { it.media.id == item.id }
        }
    }

    fun clearHistory() {
        if (store.userId == null) return
        runTask {
            history.map { it.media.id }.distinct().forEach { id ->
                runCatching { backend.removeHistory(id) }
            }
            history = emptyList()
        }
    }

    fun toggleAddon(addon: Addon) = runTask {
        addons.toggleEnabled(addon.manifestUrl)
        installed = addons.list()
        addonCatalog = addons.catalog()
    }

    fun chooseSource(source: Stream) { playing = source; page = "player" }
    fun installAddon() = runTask { addons.install(addonUrl); installed = addons.list(); addonCatalog = addons.catalog(); addonUrl = "" }
    fun removeAddon(addon: Addon) = runTask { addons.remove(addon.manifestUrl); installed = addons.list(); addonCatalog = addons.catalog() }
    fun updateTheme(name: String) { theme = name; store.theme = name }
    fun updateCustomPart(part: String, name: String) {
        require(name in themeNames && name != "custom")
        when (part) {
            "primary" -> { customPrimary = name; store.customPrimary = name }
            "secondary" -> { customSecondary = name; store.customSecondary = name }
            "tertiary" -> { customTertiary = name; store.customTertiary = name }
        }
    }
    fun openLogin() {
        if (isLoggedIn) {
            page = "settings"
            return
        }
        if (page != "login") {
            loginReturnPage = page
            page = "login"
        }
    }
    fun openFeedback() { if (page != "feedback") { feedbackReturnPage = page; page = "feedback" } }
    fun completeAuthSuccess() {
        syncUserProfile()
        val target = if (loginReturnPage == "login" || loginReturnPage.isBlank()) "discover" else loginReturnPage
        loginReturnPage = "discover"
        page = target
        loginPassword = ""
        scope.launch {
            installed = addons.list()
            runCatching { refreshUserData() }
            syncUserProfile()
            refreshDiscover()
        }
    }
    fun login() = runTask {
        try {
            backend.login(loginName, loginPassword)
            syncUserProfile()
            installed = addons.list()
            refreshUserData()
            page = loginReturnPage
            loginPassword = ""
            refreshDiscover()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = getFriendlyLoginError(e, i18n)
        }
    }
    fun logout() {
        val currentSessionId = store.userSessionId
        if (!currentSessionId.isNullOrBlank()) {
            scope.launch { runCatching { backend.removeSession(currentSessionId) } }
        }
        store.clearSession()
        store.clearLocalProgress()
        syncUserProfile()
        library = emptyList()
        history = emptyList()
        progress = emptyList()
        bookmarks = emptyList()
        bookmarkDetails = emptyList()
        bookmarkGroups = emptyList()
        page = "discover"
        refreshDiscover()
    }
    fun resume(item: Media, target: Episode?): Double {
        val saved = progress.firstOrNull { it.media.id == item.id && it.season == target?.season && it.episode == target?.number }?.position ?: 0.0
        return recentResume?.takeIf { it.first == item.id && it.second == target }?.third ?: saved
    }
    fun stopped(item: Media, target: Episode?, position: Double) {
        recentResume = Triple(item.id, target, position)
        if (position > 20) {
            val duration = episodes.firstOrNull { it.season == target?.season && it.number == target?.number }?.let { 2400.0 } ?: 7200.0
            val newItem = LibraryItem(item, position, duration, target?.season, target?.number)
            progress = (listOf(newItem) + progress.filter { it.media.id != item.id }).take(30)
            backend.saveLocalProgress(item, position, duration, target)
        }
    }
    fun back() {
        page = when (page) {
            "player" -> "sources"
            "sources" -> "details"
            "trailer" -> "details"
            "details" -> {
                seasonJob?.cancel()
                val previous = detailsStack.removeLastOrNull()
                if (previous != null) {
                    selected = previous.media; seasons = previous.seasons; episodes = previous.episodes; addonEpisodes = previous.addonEpisodes
                    selectedSeason = previous.selectedSeason
                    "details"
                } else {
                    if (detailsReturnPage in listOf("discover-more", "search")) focusReturnMediaId = selected?.let { "${it.type}:${it.id}:${it.addonManifest}" }
                    if (detailsReturnPage == "discover") focusReturnSection = sections.entries.firstOrNull { entry ->
                        entry.value.any { it.id == selected?.id && it.type == selected?.type }
                    }?.key ?: addonCatalog.firstOrNull { it.manifestUrl == selected?.addonManifest && it.type == if (selected?.type == "show") "series" else "movie" }?.key
                    detailsReturnPage
                }
            }
            "discover-more" -> { moreJob?.cancel(); focusReturnSection = moreSection; moreReturnPage }
            "discover-lists" -> { allListsJob?.cancel(); curatedJobs.values.forEach { it.cancel() }; "discover" }
            "login" -> loginReturnPage
            "feedback" -> feedbackReturnPage
            else -> "discover"
        }
    }
}

internal fun getFriendlyLoginError(error: Throwable?, i18n: I18n): String {
    if (error == null) return i18n.t("auth.login.failedToReachServer")
    val message = (error.message ?: "").lowercase()
    if (message.contains("no backend url")) {
        return i18n.t("auth.login.noBackendUrl")
    }
    if (message.contains("400") ||
        message.contains("401") ||
        message.contains("403") ||
        message.contains("404") ||
        message.contains("user cannot be found") ||
        message.contains("user not found") ||
        message.contains("invalid signature") ||
        message.contains("invalid challenge") ||
        message.contains("challenge code expired") ||
        message.contains("invalid request body") ||
        message.contains("unauthorized") ||
        message.contains("forbidden") ||
        message.contains("incorrect") ||
        message.contains("failed to authenticate") ||
        message.contains("notallowederror")
    ) {
        return i18n.t("auth.login.validationError")
    }
    return i18n.t("auth.login.failedToReachServer")
}
