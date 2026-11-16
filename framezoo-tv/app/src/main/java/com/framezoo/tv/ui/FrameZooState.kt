package com.framezoo.tv.ui

import android.content.Context
import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import com.framezoo.tv.api.Addons
import com.framezoo.tv.api.Backend
import com.framezoo.tv.api.buildBackendSettingsJson
import com.framezoo.tv.api.isAddonDomainBlocked
import com.framezoo.tv.api.isMediaBlockedByTakedown
import com.framezoo.tv.api.parseBackendSettingsJson
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
import com.framezoo.tv.model.SkipSegment
import com.framezoo.tv.model.WatchPartyError
import com.framezoo.tv.model.WatchPartyException
import com.framezoo.tv.model.WatchPartyUser
import com.framezoo.tv.model.parseWatchPartyCode
import com.framezoo.tv.player.AudioOutputMode
import com.framezoo.tv.player.GoogleSubtitleTranslator
import com.framezoo.tv.player.PlayerController
import com.framezoo.tv.storage.SecureStore
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject

internal class FrameZooState(context: Context, private val scope: CoroutineScope) {
    val store = SecureStore(context)
    val i18n = I18n(context, store.language)
    val backend = Backend(store)
    private val addons = Addons(context, backend, store)
    val player = PlayerController(context)
    internal val subtitleTranslator = GoogleSubtitleTranslator()
    private var settingsSyncJob: Job? = null

    var hasTidbBackendSupport by mutableStateOf(false)
        private set
    var tidbKey by mutableStateOf(store.tidbKey.orEmpty())
        private set
    val canSubmitTidb: Boolean
        get() = hasTidbBackendSupport || tidbKey.isNotBlank()

    var homeSectionOrder by mutableStateOf(loadHomeSectionOrder(store.homeSectionOrderJson))
        private set
    var bookmarkGroupOrder by mutableStateOf<List<String>>(emptyList())
        private set

    init {
        player.setAudioMode(AudioOutputMode.fromWire(store.audioOutputMode))
    }

    private fun loadHomeSectionOrder(rawJson: String?): List<String> {
        val parsed = rawJson?.let {
            runCatching {
                val arr = JSONArray(it)
                (0 until arr.length()).mapNotNull { idx -> arr.optString(idx).takeIf(String::isNotBlank) }
            }.getOrNull()
        }
        return normalizeHomeSectionOrder(parsed ?: DEFAULT_HOME_SECTION_ORDER)
    }

    private fun scheduleSettingsSync() {
        if (store.userId == null) return
        settingsSyncJob?.cancel()
        settingsSyncJob = scope.launch {
            delay(400)
            runCatching {
                backend.updateSettings(
                    buildBackendSettingsJson(
                        applicationLanguage = i18n.language,
                        applicationTheme = theme,
                        defaultSubtitleLanguage = defaultSubtitleLanguage,
                        enableAutoplay = enableAutoplay,
                        enableSkipCredits = enableSkipCredits,
                        enableAutoSkipSegments = enableAutoSkipSegments,
                        customPrimary = customPrimary,
                        customSecondary = customSecondary,
                        customTertiary = customTertiary,
                    )
                )
            }
        }
    }

    fun updateTidbKey(key: String) {
        val clean = key.trim()
        tidbKey = clean
        store.tidbKey = clean.takeIf { it.isNotBlank() }
    }

    fun updateHomeSectionOrder(order: List<String>) {
        val normalized = normalizeHomeSectionOrder(order)
        homeSectionOrder = normalized
        store.homeSectionOrderJson = JSONArray(normalized).toString()
    }

    fun moveHomeSection(index: Int, delta: Int) {
        updateHomeSectionOrder(moveListItem(homeSectionOrder, index, index + delta))
    }

    fun resetHomeSectionOrder() {
        homeSectionOrder = DEFAULT_HOME_SECTION_ORDER
        store.homeSectionOrderJson = null
    }

    private fun setLanguageLocal(lang: String) {
        store.language = lang
        i18n.setLanguage(lang)
    }

    fun setLanguage(lang: String) {
        setLanguageLocal(lang)
        scheduleSettingsSync()
    }

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
    private var watchPartyJob: Job? = null
    private var watchPartyGeneration = 0
    var activeWatchParty by mutableStateOf<String?>(null)
        private set
    var watchPartyIsHost by mutableStateOf(false)
        private set
    var watchPartyUsers by mutableStateOf<List<WatchPartyUser>>(emptyList())
    var watchPartyStatusOverlay by mutableStateOf(false)
    var watchPartyNotice by mutableStateOf<String?>(null)
    var watchPartyConnected by mutableStateOf(false)

    fun hostWatchParty() {
        if (store.userId == null) { openLogin(); return }
        activeWatchParty = (100000 + java.security.SecureRandom().nextInt(900000)).toString()
        watchPartyIsHost = true; watchPartyUsers = emptyList(); watchPartyNotice = null; watchPartyConnected = false
        player.command("set", "speed", "1")
    }

    fun leaveWatchParty(notice: String? = null) {
        activeWatchParty = null; watchPartyIsHost = false; watchPartyUsers = emptyList(); watchPartyNotice = notice; watchPartyConnected = false
    }

    fun updateWatchPartyCode(code: String) {
        val value = code.trim().uppercase().take(10)
        if (watchPartyIsHost && value.isNotEmpty()) {
            activeWatchParty = value; watchPartyUsers = emptyList(); watchPartyConnected = false; watchPartyNotice = null
        }
    }

    /** Desktop `openDialog`: requires account, otherwise opens login. */
    fun openWatchParty() {
        if (store.userId == null) { openLogin(); return }
        watchPartyCodeInput = ""; watchPartyError = null; watchPartyNotice = null; watchPartyDialogOpen = true
    }
    fun closeWatchParty() {
        watchPartyGeneration++
        watchPartyJob?.cancel(); watchPartyJob = null
        watchPartyDialogOpen = false; watchPartyError = null; watchPartyLoading = false
    }

    /** Desktop `handleProtectedRoute`: history/bookmarks need login. */
    fun openProtected(open: () -> Unit) { if (store.userId == null) openLogin() else open() }

    fun submitWatchParty() {
        if (watchPartyLoading) return
        if (store.userId == null) { closeWatchParty(); openLogin(); return }
        val code = parseWatchPartyCode(watchPartyCodeInput)
        if (code == null) { watchPartyError = i18n.t("watchParty.invalidRoom"); return }
        watchPartyLoading = true; watchPartyError = null; watchPartyNotice = null
        val generation = ++watchPartyGeneration
        watchPartyJob = scope.launch {
            try {
                val host = backend.watchPartyHost(code)
                if (page == "player" && playing != null) {
                    if (selected?.id != host.tmdbId || (selected?.type == "show") != host.isShow) {
                        watchPartyError = i18n.t("watchParty.contentMismatch"); return@launch
                    }
                    if (host.isShow && (episode?.season != host.season || episode?.number != host.episode)) {
                        watchPartyError = i18n.t("watchParty.episodeMismatch"); return@launch
                    }
                } else {
                    openDetailsNow(Media(id = host.tmdbId, type = if (host.isShow) "show" else "movie", title = host.title))
                    val item = requireNotNull(selected)
                    val target = if (host.isShow && host.season != null && host.episode != null) {
                        val list = backend.episodes(item.id, host.season)
                        list.firstOrNull { it.number == host.episode } ?: throw IllegalStateException("Episode unavailable")
                    } else null
                    loadSources(item, target)
                }
                activeWatchParty = code
                watchPartyIsHost = false; watchPartyUsers = emptyList(); watchPartyNotice = null; watchPartyConnected = false
                player.command("set", "speed", "1")
                watchPartyJob = null
                closeWatchParty()
            } catch (e: CancellationException) { throw e }
            catch (e: WatchPartyException) {
                watchPartyError = i18n.t(if (e.kind == WatchPartyError.EMPTY_ROOM) "watchParty.emptyRoom" else "watchParty.noHost")
            } catch (_: Exception) {
                watchPartyError = i18n.t("watchParty.invalidRoom")
            } finally { if (generation == watchPartyGeneration) { watchPartyJob = null; watchPartyLoading = false } }
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
    var addonStreams by mutableStateOf<Map<String, List<Stream>>>(emptyMap())
    var addonLoading by mutableStateOf<Set<String>>(emptySet())
    var addonErrors by mutableStateOf<Map<String, String>>(emptyMap())
    var skipSegments by mutableStateOf<List<SkipSegment>>(emptyList())
    var skipSegmentsLoading by mutableStateOf(false)
    private var sourcesJob: Job? = null
    private var sourcesGeneration = 0
    private var autoSourceResolved = false
    /** Mirrors desktop SourceSelectPart's auto-selection gate. */
    val sourceSelectionResolved: Boolean
        get() = autoSourceResolved
    private var skipSegmentsJob: Job? = null
    private var skipSegmentsKey: String? = null
    private var playerReturnPage = "discover"
    var playing by mutableStateOf<Stream?>(null)
    var playbackReady by mutableStateOf(false)
    // Back from an active loading surface must return to the source picker.
    // The nested PlayerScreen handler clears `playing`; guard the outer app
    // handler from immediately navigating to Details during that recomposition.
    private var sourcePickerBackGuardUntil = 0L
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
        scope.launch { hasTidbBackendSupport = backend.metaTidbAvailability() }
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

    fun openDetails(item: Media) = runTask { openDetailsNow(item) }

    private suspend fun openDetailsNow(item: Media) {
        val fromPage = page
        val previous = selected?.let { DetailsSnapshot(it, seasons, episodes, addonEpisodes, selectedSeason) }
        if (item.addonManifest != null) {
            val (detail, videos) = addons.details(item)
            seasonJob?.cancel()
            selected = detail; addonEpisodes = videos; seasons = videos.map { it.season }.distinct(); episodes = emptyList()
        } else {
            val (detail, seasonList) = backend.details(item)
            seasonJob?.cancel()
            selected = detail; seasons = seasonList; episodes = emptyList(); addonEpisodes = emptyList()
        }
        if (fromPage == "details" && previous != null) detailsStack.add(previous)
        else { detailsReturnPage = fromPage; detailsStack.clear() }
        selectedSeason = null
        episode = null; page = "details"
    }

    val streamAddons: List<Addon>
        get() = installed.filter { it.enabled && "stream" in it.resources }

    fun playFeatured(item: Media) {
        if (activeWatchParty != null && (selected?.id != item.id || selected?.type != item.type)) leaveWatchParty()
        if (page != "player" && page != "sources") {
            playerReturnPage = page
            if (page != "details") { detailsReturnPage = page; detailsStack.clear() }
        }
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
        playing = null
        playbackReady = false
        sources = emptyList()
        subtitles = emptyList()
        addonStreams = emptyMap()
        addonErrors = emptyMap()
        sourcesLoading = true
        page = "player"

        val generation = ++sourcesGeneration
        autoSourceResolved = false
        sourcesJob?.cancel()
        sourcesJob = scope.launch {
            try {
                val blocklist = addons.getBlocklist()
                if (isMediaBlockedByTakedown(item.id, item.imdbId, item.type, blocklist)) {
                    if (generation == sourcesGeneration) {
                        sourcesLoading = false
                        addonLoading = emptySet()
                        error = "Nội dung này không khả dụng theo yêu cầu bản quyền / pháp lý."
                    }
                    return@launch
                }
                if (installed.isEmpty()) installed = addons.list()
                val eligible = installed.filter {
                    it.enabled && "stream" in it.resources && !isAddonDomainBlocked(it.manifestUrl, blocklist.addonDomains)
                }
                addonLoading = eligible.map { it.id }.toSet()
                val (detail, seasonList) = backend.details(item)
                if (isMediaBlockedByTakedown(detail.id, detail.imdbId, detail.type, blocklist)) {
                    if (generation == sourcesGeneration) {
                        sourcesLoading = false
                        addonLoading = emptySet()
                        error = "Nội dung này không khả dụng theo yêu cầu bản quyền / pháp lý."
                    }
                    return@launch
                }
                selected = detail
                seasons = seasonList
                val resolvedTarget = if (item.type == "show") {
                    val season = saved?.season ?: seasonList.firstOrNull()
                    season?.let { number ->
                        val eps = backend.episodes(item.id, number)
                        episodes = eps
                        selectedSeason = number
                        saved?.episode?.let { ep -> eps.firstOrNull { it.number == ep } } ?: eps.firstOrNull()
                    }
                } else null
                episode = resolvedTarget
                loadSkipSegments(detail, resolvedTarget)
                if (item.type == "show" && resolvedTarget == null) {
                    sourcesLoading = false
                    addonLoading = emptySet()
                    page = "details"
                    return@launch
                }
                coroutineScope {
                    val subDeferred = async { runCatching { addons.subtitles(detail, resolvedTarget) }.getOrDefault(emptyList()) }
                    val addonDeferreds = eligible.map { addon ->
                        async {
                            try {
                                val list = addons.streamsForAddon(addon, detail, resolvedTarget, blocklist.infohashes)
                                if (generation != sourcesGeneration) return@async
                                addonStreams = addonStreams + (addon.id to list)
                                sources = addonStreams.values.flatten()
                            } catch (e: CancellationException) {
                                throw e
                            } catch (_: Exception) {
                                if (generation != sourcesGeneration) return@async
                                addonStreams = addonStreams + (addon.id to emptyList())
                                addonErrors = addonErrors + (addon.id to "Không tải được nguồn từ addon")
                            } finally {
                                if (generation == sourcesGeneration) addonLoading = addonLoading - addon.id
                            }
                        }
                    }
                    val loadedSubtitles = subDeferred.await()
                    if (generation == sourcesGeneration) subtitles = loadedSubtitles
                    addonDeferreds.forEach { it.await() }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (generation == sourcesGeneration) error = e.message ?: "Failed to load sources"
            } finally {
                if (generation == sourcesGeneration) {
                    sourcesLoading = false
                    addonLoading = emptySet()
                }
            }
        }
    }
    fun playRandom(item: Media) = playFeatured(item)

    fun loadSources(item: Media, target: Episode?) {
        if (activeWatchParty != null && (selected?.id != item.id || selected?.type != item.type)) leaveWatchParty()
        if (page != "player" && page != "sources") {
            playerReturnPage = page
        }
        selected = item
        episode = target
        playing = null
        playbackReady = false
        sources = emptyList()
        subtitles = emptyList()
        addonStreams = emptyMap()
        addonErrors = emptyMap()
        sourcesLoading = true
        page = "player"
        loadSkipSegments(item, target)

        val generation = ++sourcesGeneration
        autoSourceResolved = false
        sourcesJob?.cancel()
        sourcesJob = scope.launch {
            try {
                val blocklist = addons.getBlocklist()
                if (isMediaBlockedByTakedown(item.id, item.imdbId, item.type, blocklist)) {
                    if (generation == sourcesGeneration) {
                        sourcesLoading = false
                        addonLoading = emptySet()
                        error = "Nội dung này không khả dụng theo yêu cầu bản quyền / pháp lý."
                    }
                    return@launch
                }
                if (installed.isEmpty()) installed = addons.list()
                val eligible = installed.filter {
                    it.enabled && "stream" in it.resources && !isAddonDomainBlocked(it.manifestUrl, blocklist.addonDomains)
                }
                addonLoading = eligible.map { it.id }.toSet()
                coroutineScope {
                    val subDeferred = async { runCatching { addons.subtitles(item, target) }.getOrDefault(emptyList()) }
                    val addonDeferreds = eligible.map { addon ->
                        async {
                            try {
                                val list = addons.streamsForAddon(addon, item, target, blocklist.infohashes)
                                if (generation != sourcesGeneration) return@async
                                addonStreams = addonStreams + (addon.id to list)
                                sources = addonStreams.values.flatten()
                            } catch (e: CancellationException) {
                                throw e
                            } catch (_: Exception) {
                                if (generation != sourcesGeneration) return@async
                                addonStreams = addonStreams + (addon.id to emptyList())
                                addonErrors = addonErrors + (addon.id to "Không tải được nguồn từ addon")
                            } finally {
                                if (generation == sourcesGeneration) addonLoading = addonLoading - addon.id
                            }
                        }
                    }
                    val loadedSubtitles = subDeferred.await()
                    if (generation == sourcesGeneration) subtitles = loadedSubtitles
                    addonDeferreds.forEach { it.await() }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (generation == sourcesGeneration) error = e.message ?: "Failed to load sources"
            } finally {
                if (generation == sourcesGeneration) {
                    sourcesLoading = false
                    addonLoading = emptySet()
                }
            }
        }
    }

    fun loadSkipSegments(item: Media, target: Episode?) {
        val key = "${item.type}:${item.id}:${target?.season ?: 0}:${target?.number ?: 0}"
        if (skipSegmentsKey == key && !skipSegmentsLoading) return
        skipSegmentsJob?.cancel()
        skipSegmentsKey = key
        skipSegments = emptyList()
        skipSegmentsLoading = true
        skipSegmentsJob = scope.launch {
            try {
                skipSegments = backend.skipSegments(item, target)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                skipSegments = emptyList()
            } finally {
                if (skipSegmentsKey == key) skipSegmentsLoading = false
            }
        }
    }

    internal suspend fun refreshUserData() = coroutineScope {
        val tidbAvailable = async { backend.metaTidbAvailability() }
        val userMe = async {
            try {
                backend.getMe()
            } catch (_: Exception) {
                null
            }
        }
        val remoteSettings = async { runCatching { backend.settings() }.getOrNull() }
        val saved = async { runCatching { backend.bookmarkDetails() }.getOrDefault(emptyList()) }
        val groups = async { runCatching { backend.bookmarkGroups() }.getOrDefault(emptyList()) }
        val watched = async { runCatching { backend.watchHistory() }.getOrDefault(emptyList()) }
        val ongoing = async { runCatching { backend.watchProgress() }.getOrDefault(emptyList()) }
        hasTidbBackendSupport = tidbAvailable.await()
        userMe.await()
        syncUserProfile()
        if (store.userId == null) {
            library = emptyList()
            history = emptyList()
            progress = backend.loadLocalProgress()
            bookmarks = emptyList()
            bookmarkDetails = emptyList()
            bookmarkGroups = emptyList()
            bookmarkGroupOrder = emptyList()
            return@coroutineScope
        }
        remoteSettings.await()?.let { rawSettings ->
            val snapshot = parseBackendSettingsJson(rawSettings, themeNames.toSet())
            snapshot.applicationTheme?.takeIf { snapshot.hasApplicationTheme }?.let {
                theme = it
                store.theme = it
            }
            snapshot.customPrimary?.let { customPrimary = it; store.customPrimary = it }
            snapshot.customSecondary?.let { customSecondary = it; store.customSecondary = it }
            snapshot.customTertiary?.let { customTertiary = it; store.customTertiary = it }
            snapshot.applicationLanguage?.let { setLanguageLocal(it) }
            snapshot.defaultSubtitleLanguage?.let {
                defaultSubtitleLanguage = it
                store.defaultSubtitleLanguage = it
            }
            snapshot.enableAutoplay?.let { enableAutoplay = it; store.enableAutoplay = it }
            snapshot.enableSkipCredits?.let { enableSkipCredits = it; store.enableSkipCredits = it }
            snapshot.enableAutoSkipSegments?.let { enableAutoSkipSegments = it; store.enableAutoSkipSegments = it }
        }
        val loadedDetails = saved.await()
        val loadedGroupOrder = groups.await()
        bookmarkDetails = loadedDetails
        bookmarks = loadedDetails.map { it.media }
        bookmarkGroupOrder = loadedGroupOrder
        bookmarkGroups = mergeAndOrderBookmarkGroups(loadedGroupOrder, loadedDetails)
        history = watched.await()
        progress = ongoing.await()
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
    fun openAddons() = runTask { installed = addons.list(); if (page == "player") leaveWatchParty(); page = "addons" }
    fun search() {
        val term = query.trim()
        searchJob?.cancel(); val generation = ++searchGeneration
        searchedQuery = term; searchGenre = ""; searchError = ""; results = emptyList()
        if (term.isEmpty()) { results = emptyList(); searchLoading = false; return }
        searchLoading = true
        searchJob = scope.launch {
            try {
                val initial = rankSearchResults(term, backend.search(term))
                if (generation != searchGeneration) return@launch
                results = initial; searchLoading = false
                val enriched = rankSearchResults(term, backend.enrichSearch(initial))
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
    fun renameBookmarkGroup(oldGroup: String, newGroup: String) {
        if (store.userId == null) { openLogin(); return }
        val (changed, nextOrder) = computeBookmarkGroupRename(bookmarkDetails, bookmarkGroupOrder, oldGroup, newGroup)
        if (changed.isEmpty()) return
        runTask {
            changed.forEach { entry ->
                backend.saveBookmarkDetails(entry.media, entry.groups, entry.favoriteEpisodes)
            }
            if (nextOrder != bookmarkGroupOrder) {
                backend.saveGroupOrder(nextOrder)
            }
            refreshUserData()
        }
    }
    fun deleteBookmarkGroup(targetGroup: String) {
        if (store.userId == null) { openLogin(); return }
        val (changed, nextOrder) = computeBookmarkGroupDelete(bookmarkDetails, bookmarkGroupOrder, targetGroup)
        if (changed.isEmpty() && targetGroup !in bookmarkGroupOrder) return
        runTask {
            changed.forEach { entry ->
                backend.saveBookmarkDetails(entry.media, entry.groups, entry.favoriteEpisodes)
            }
            if (nextOrder != bookmarkGroupOrder) {
                backend.saveGroupOrder(nextOrder)
            }
            refreshUserData()
        }
    }
    fun reorderBookmarkGroups(newOrder: List<String>) {
        if (store.userId == null) { openLogin(); return }
        val clean = newOrder.filter { it.isNotBlank() }.distinct()
        bookmarkGroupOrder = clean
        bookmarkGroups = mergeAndOrderBookmarkGroups(clean, bookmarkDetails)
        runTask {
            backend.saveGroupOrder(clean)
            refreshUserData()
        }
    }
    suspend fun submitSkipSegment(
        item: Media,
        target: Episode?,
        segmentType: String,
        startSec: Double?,
        endSec: Double?
    ): Result<Unit> = runCatching {
        backend.submitSkipSegment(item, target, segmentType, startSec, endSec)
        skipSegmentsKey = null
        loadSkipSegments(item, target)
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
    suspend fun nextEpisode(item: Media, current: Episode): Episode? {
        suspend fun seasonEpisodes(season: Int): List<Episode> = when {
            item.addonManifest != null -> addonEpisodes.filter { it.season == season }
            selectedSeason == season && !episodesLoading && episodes.isNotEmpty() -> episodes
            else -> backend.episodes(item.id, season)
        }
        return resolveNextEpisode(current, seasons, ::seasonEpisodes)
    }
    fun openTrailer(key: String, title: String) { trailerKey = key; trailerTitle = title; page = "trailer" }
    var automaticVideoQuality by mutableStateOf(store.automaticVideoQuality)
    var preferredVideoQuality by mutableStateOf(store.preferredVideoQuality)
    fun setVideoQualityPreference(value: String, bitrate: Long) {
        preferredVideoQuality = value; store.preferredVideoQuality = value; store.preferredVideoBitrate = bitrate.coerceAtLeast(0)
    }
    fun updateAutomaticVideoQuality(value: Boolean) { automaticVideoQuality = value; store.automaticVideoQuality = value }

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
    var subtitleBackgroundBlur by mutableIntStateOf(store.subtitleBackgroundBlur)
        private set
    var subtitleFontStyle by mutableStateOf(store.subtitleFontStyle)
        private set
    var subtitleBorderThickness by mutableFloatStateOf(store.subtitleBorderThickness)
        private set
    var subtitleBold by mutableStateOf(store.subtitleBold)
        private set
    var subtitleVerticalPosition by mutableIntStateOf(store.subtitleVerticalPosition)
        private set

    var secondarySubtitleFontSize by mutableIntStateOf(store.secondarySubtitleFontSize)
        private set
    var secondarySubtitleColor by mutableStateOf(store.secondarySubtitleColor)
        private set
    var secondarySubtitleBackgroundOpacity by mutableIntStateOf(store.secondarySubtitleBackgroundOpacity)
        private set
    var secondarySubtitleBackgroundBlurEnabled by mutableStateOf(store.secondarySubtitleBackgroundBlurEnabled)
        private set
    var secondarySubtitleBackgroundBlur by mutableIntStateOf(store.secondarySubtitleBackgroundBlur)
        private set
    var secondarySubtitleFontStyle by mutableStateOf(store.secondarySubtitleFontStyle)
        private set
    var secondarySubtitleBorderThickness by mutableFloatStateOf(store.secondarySubtitleBorderThickness)
        private set
    var secondarySubtitleBold by mutableStateOf(store.secondarySubtitleBold)
        private set
    var secondarySubtitleVerticalPosition by mutableIntStateOf(store.secondarySubtitleVerticalPosition)
        private set

    var defaultSubtitleLanguage by mutableStateOf(store.defaultSubtitleLanguage)
        private set
    var lastSubtitleLanguage by mutableStateOf(store.lastSubtitleLanguage)
        private set
    var audioOutputMode by mutableStateOf(AudioOutputMode.fromWire(store.audioOutputMode))
        private set

    fun updateAudioOutputMode(mode: AudioOutputMode) {
        audioOutputMode = mode
        store.audioOutputMode = mode.wireValue
        player.setAudioMode(mode)
    }

    fun updateDefaultSubtitleLanguage(lang: String?) {
        val clean = lang?.trim()?.takeIf { it.isNotBlank() }
        defaultSubtitleLanguage = clean
        store.defaultSubtitleLanguage = clean
        scheduleSettingsSync()
    }

    fun rememberLastSubtitleLanguage(lang: String?) {
        val clean = lang?.trim()?.takeIf { it.isNotBlank() && it != "und" } ?: return
        lastSubtitleLanguage = clean
        store.lastSubtitleLanguage = clean
    }

    fun toggleAutoplay() {
        enableAutoplay = !enableAutoplay
        store.enableAutoplay = enableAutoplay
        scheduleSettingsSync()
    }

    fun toggleSkipCredits() {
        enableSkipCredits = !enableSkipCredits
        store.enableSkipCredits = enableSkipCredits
        scheduleSettingsSync()
    }

    fun toggleAutoSkipSegments() {
        enableAutoSkipSegments = !enableAutoSkipSegments
        store.enableAutoSkipSegments = enableAutoSkipSegments
        scheduleSettingsSync()
    }

    fun updateSubtitleFontSize(size: Int, secondary: Boolean = false) {
        val clamped = size.coerceIn(1, 200)
        if (secondary) {
            secondarySubtitleFontSize = clamped
            store.secondarySubtitleFontSize = clamped
        } else {
            subtitleFontSize = clamped
            store.subtitleFontSize = clamped
        }
        applySubtitleStyling()
    }

    fun updateSubtitleColor(color: String, secondary: Boolean = false) {
        if (secondary) {
            secondarySubtitleColor = color
            store.secondarySubtitleColor = color
        } else {
            subtitleColor = color
            store.subtitleColor = color
        }
        applySubtitleStyling()
    }

    fun updateSubtitleBackgroundOpacity(opacity: Int, secondary: Boolean = false) {
        val clamped = opacity.coerceIn(0, 100)
        if (secondary) {
            secondarySubtitleBackgroundOpacity = clamped
            store.secondarySubtitleBackgroundOpacity = clamped
        } else {
            subtitleBackgroundOpacity = clamped
            store.subtitleBackgroundOpacity = clamped
        }
        applySubtitleStyling()
    }

    fun applySubtitleStyling(controlsShown: Boolean = false) {
        buildMpvSubtitleStyleProperties(
            fontSize = subtitleFontSize,
            color = subtitleColor,
            backgroundOpacity = subtitleBackgroundOpacity,
            backgroundBlurEnabled = subtitleBackgroundBlurEnabled,
            backgroundBlur = subtitleBackgroundBlur,
            fontStyle = subtitleFontStyle,
            borderThickness = subtitleBorderThickness,
            bold = subtitleBold,
            verticalPosition = subtitleVerticalPosition,
            secondaryVerticalPosition = secondarySubtitleVerticalPosition,
            controlsShown = controlsShown
        ).forEach { (key, value) ->
            player.command("set", key, value)
        }
    }

    fun toggleSubtitleBackgroundBlur(secondary: Boolean = false) {
        if (secondary) {
            secondarySubtitleBackgroundBlurEnabled = !secondarySubtitleBackgroundBlurEnabled
            store.secondarySubtitleBackgroundBlurEnabled = secondarySubtitleBackgroundBlurEnabled
        } else {
            subtitleBackgroundBlurEnabled = !subtitleBackgroundBlurEnabled
            store.subtitleBackgroundBlurEnabled = subtitleBackgroundBlurEnabled
        }
        applySubtitleStyling()
    }

    fun updateSubtitleBackgroundBlur(blur: Int, secondary: Boolean = false) {
        val clamped = blur.coerceIn(0, 100)
        if (secondary) {
            secondarySubtitleBackgroundBlur = clamped
            store.secondarySubtitleBackgroundBlur = clamped
        } else {
            subtitleBackgroundBlur = clamped
            store.subtitleBackgroundBlur = clamped
        }
        applySubtitleStyling()
    }

    fun updateSubtitleFontStyle(style: String, secondary: Boolean = false) {
        if (secondary) {
            secondarySubtitleFontStyle = style
            store.secondarySubtitleFontStyle = style
        } else {
            subtitleFontStyle = style
            store.subtitleFontStyle = style
        }
        applySubtitleStyling()
    }

    fun updateSubtitleBorderThickness(thickness: Float, secondary: Boolean = false) {
        val clamped = (kotlin.math.round(thickness * 10f) / 10f).coerceIn(0f, 10f)
        if (secondary) {
            secondarySubtitleBorderThickness = clamped
            store.secondarySubtitleBorderThickness = clamped
        } else {
            subtitleBorderThickness = clamped
            store.subtitleBorderThickness = clamped
        }
        applySubtitleStyling()
    }

    fun toggleSubtitleBold(secondary: Boolean = false) {
        if (secondary) {
            secondarySubtitleBold = !secondarySubtitleBold
            store.secondarySubtitleBold = secondarySubtitleBold
        } else {
            subtitleBold = !subtitleBold
            store.subtitleBold = subtitleBold
        }
        applySubtitleStyling()
    }

    fun updateSubtitleVerticalPosition(pos: Int, secondary: Boolean = false) {
        val normalized = if (pos == 3) 3 else 1
        if (secondary) {
            secondarySubtitleVerticalPosition = normalized
            store.secondarySubtitleVerticalPosition = normalized
        } else {
            subtitleVerticalPosition = normalized
            store.subtitleVerticalPosition = normalized
        }
        applySubtitleStyling()
    }

    fun resetSubtitleStyling(secondary: Boolean = false) {
        if (secondary) {
            secondarySubtitleFontSize = 100; store.secondarySubtitleFontSize = 100
            secondarySubtitleColor = "#FFFFFF"; store.secondarySubtitleColor = "#FFFFFF"
            secondarySubtitleBackgroundOpacity = 50; store.secondarySubtitleBackgroundOpacity = 50
            secondarySubtitleBackgroundBlurEnabled = false; store.secondarySubtitleBackgroundBlurEnabled = false
            secondarySubtitleBackgroundBlur = 50; store.secondarySubtitleBackgroundBlur = 50
            secondarySubtitleFontStyle = "default"; store.secondarySubtitleFontStyle = "default"
            secondarySubtitleBorderThickness = 1.0f; store.secondarySubtitleBorderThickness = 1.0f
            secondarySubtitleBold = false; store.secondarySubtitleBold = false
            secondarySubtitleVerticalPosition = 1; store.secondarySubtitleVerticalPosition = 1
        } else {
            subtitleFontSize = 100; store.subtitleFontSize = 100
            subtitleColor = "#FFFFFF"; store.subtitleColor = "#FFFFFF"
            subtitleBackgroundOpacity = 50; store.subtitleBackgroundOpacity = 50
            subtitleBackgroundBlurEnabled = false; store.subtitleBackgroundBlurEnabled = false
            subtitleBackgroundBlur = 50; store.subtitleBackgroundBlur = 50
            subtitleFontStyle = "default"; store.subtitleFontStyle = "default"
            subtitleBorderThickness = 1.0f; store.subtitleBorderThickness = 1.0f
            subtitleBold = false; store.subtitleBold = false
            subtitleVerticalPosition = 1; store.subtitleVerticalPosition = 1
        }
        applySubtitleStyling()
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

    private fun preferenceKey(item: Media) = "${item.type}:${item.id}"
    private fun episodeKey(item: Media, target: Episode?) = "${preferenceKey(item)}:${target?.season ?: 0}:${target?.number ?: 0}"

    /** Desktop source picker hint used when a saved stream cannot be auto-started. */
    fun preferredSourceHint(item: Media): StreamPreference? {
        val raw = store.playbackSelection("preference:${preferenceKey(item)}") ?: return null
        val value = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        val addonId = value.optString("addon").trim()
        if (addonId.isBlank()) return null
        val quality = when (value.optString("quality").trim().lowercase()) {
            "4k", "2160p" -> "4k"
            "1440p", "2k", "qhd" -> "1440p"
            "1080p", "1080i", "fhd" -> "1080p"
            "720p", "720i", "hd" -> "720p"
            "480p", "480i", "360p", "240p", "sd", "dvd", "cam", "ts" -> "480p"
            else -> "other"
        }
        return StreamPreference(
            addonId = addonId,
            kind = value.optString("kind"),
            quality = quality,
            name = value.optString("name"),
            title = value.optString("title"),
            bingeGroup = value.optString("bingeGroup").takeIf { it.isNotBlank() }
        )
    }

    fun chooseSource(source: Stream) {
        sourcePickerBackGuardUntil = 0L
        playbackReady = false
        autoSourceResolved = true
        selected?.let { item ->
            val now = System.currentTimeMillis()
            val preference = streamPreference(source)
            val record = JSONObject().put("addon", preference.addonId).put("kind", preference.kind)
                .put("quality", preference.quality).put("name", preference.name).put("title", preference.title)
                .put("bingeGroup", preference.bingeGroup).put("savedAt", now)
            store.savePlaybackSelection("preference:${preferenceKey(item)}", record.toString())
            if (preference.kind == "torrent") {
                val exact = JSONObject().put("addon", source.addonId).put("url", source.url).put("hash", source.infoHash)
                    .put("fileIdx", source.fileIdx).put("filename", source.filename).put("savedAt", now)
                store.savePlaybackSelection("torrent:${episodeKey(item, episode)}", exact.toString())
            }
        }
        playing = source
        page = "player"
    }

    fun returnToSourcePicker() {
        sourcePickerBackGuardUntil = SystemClock.uptimeMillis() + 500L
        playbackReady = false
        playing = null
        page = "player"
    }

    fun selectPreferredSourceWhenReady() {
        if (autoSourceResolved || playing != null || page != "player") return
        val item = selected ?: return
        val savedPreference = store.playbackSelection("preference:${preferenceKey(item)}")
        val preference = savedPreference?.let { runCatching { JSONObject(it) }.getOrNull() }
            ?: run { autoSourceResolved = true; return }
        val exact = runCatching { JSONObject(store.playbackSelection("torrent:${episodeKey(item, episode)}") ?: "") }.getOrNull()
            ?.takeIf { it.optLong("savedAt") >= preference.optLong("savedAt") }
        val addonId = exact?.optString("addon").orEmpty().ifEmpty { preference.optString("addon") }
        if (sourcesLoading && (addonId in addonLoading || addonId !in addonStreams)) return
        val candidates = addonStreams[addonId].orEmpty()
        val exactMatch = exact?.let { saved ->
            candidates.firstOrNull { source ->
                val hash = saved.optString("hash").takeIf { it.isNotBlank() }
                val sameHash = if (hash != null && !source.infoHash.isNullOrBlank()) hash.equals(source.infoHash, true)
                    else saved.optString("url") == source.url
                val index = if (saved.has("fileIdx") && !saved.isNull("fileIdx")) saved.optInt("fileIdx") else null
                val filename = saved.optString("filename").takeIf { it.isNotBlank() }
                val sameFile = if (index != null && source.fileIdx != null) index == source.fileIdx
                    else if (filename != null && source.filename != null) filename == source.filename
                    else index == source.fileIdx && filename == source.filename
                streamKind(source) == "torrent" && sameHash && sameFile
            }
        }
        val preferred = StreamPreference(preference.optString("addon"), preference.optString("kind"),
            preference.optString("quality"), preference.optString("name"), preference.optString("title"),
            preference.optString("bingeGroup").takeIf { it.isNotBlank() })
        // A stale exact selection can refer to another addon; wait for the preferred addon too.
        if (exactMatch == null && sourcesLoading && (preferred.addonId in addonLoading || preferred.addonId !in addonStreams)) return
        autoSourceResolved = true
        (exactMatch ?: findPreferredStream(addonStreams[preferred.addonId].orEmpty(), preferred))?.let(::chooseSource)
    }
    fun installAddon() = runTask { addons.install(addonUrl); installed = addons.list(); addonCatalog = addons.catalog(); addonUrl = "" }
    fun removeAddon(addon: Addon) = runTask { addons.remove(addon.manifestUrl); installed = addons.list(); addonCatalog = addons.catalog() }
    fun updateTheme(name: String) {
        theme = name
        store.theme = name
        scheduleSettingsSync()
    }
    fun updateCustomPart(part: String, name: String) {
        require(name in themeNames && name != "custom")
        when (part) {
            "primary" -> { customPrimary = name; store.customPrimary = name }
            "secondary" -> { customSecondary = name; store.customSecondary = name }
            "tertiary" -> { customTertiary = name; store.customTertiary = name }
        }
        scheduleSettingsSync()
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
        closeWatchParty()
        leaveWatchParty()
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
        bookmarkGroupOrder = emptyList()
        page = "discover"
        refreshDiscover()
    }
    fun resume(item: Media, target: Episode?): Double {
        val saved = progress.firstOrNull { it.media.id == item.id && it.season == target?.season && it.episode == target?.number }?.position ?: 0.0
        return recentResume?.takeIf { it.first == item.id && it.second == target }?.third ?: saved
    }
    fun resumeDuration(item: Media, target: Episode?): Double {
        val saved = progress.firstOrNull { it.media.id == item.id && it.season == target?.season && it.episode == target?.number }?.duration ?: 0.0
        if (saved > 0.0) return saved
        return if (item.runtime > 0) item.runtime * 60.0 else if (item.type == "show") 2400.0 else 7200.0
    }
    fun stopped(item: Media, target: Episode?, position: Double, actualDuration: Double) {
        recentResume = Triple(item.id, target, position)
        if (position > 20) {
            val duration = actualDuration.takeIf { it.isFinite() && it > 0.0 } ?: resumeDuration(item, target)
            val newItem = LibraryItem(item, position, duration, target?.season, target?.number)
            progress = (listOf(newItem) + progress.filter {
                it.media.id != item.id || it.media.type != item.type || it.season != target?.season || it.episode != target?.number
            }).take(30)
            backend.saveLocalProgress(item, position, duration, target)
        }
    }
    fun exitPlayer() {
        sourcePickerBackGuardUntil = 0L
        playbackReady = false
        leaveWatchParty()
        sourcesGeneration++
        sourcesJob?.cancel()
        skipSegmentsJob?.cancel()
        skipSegmentsKey = null
        skipSegments = emptyList()
        playing = null
        page = if (playerReturnPage in listOf("player", "sources")) "details" else playerReturnPage
    }
    fun back() {
        if (page == "player" && sourcePickerBackGuardUntil > SystemClock.uptimeMillis()) {
            sourcePickerBackGuardUntil = 0L
            return
        }
        page = when (page) {
            "player" -> {
                leaveWatchParty()
                sourcesGeneration++
                sourcesJob?.cancel()
                skipSegmentsJob?.cancel()
                skipSegmentsKey = null
                skipSegments = emptyList()
                playing = null
                playbackReady = false
                if (playerReturnPage in listOf("player", "sources")) "details" else playerReturnPage
            }
            "sources" -> {
                leaveWatchParty()
                sourcesGeneration++
                sourcesJob?.cancel()
                skipSegmentsJob?.cancel()
                skipSegmentsKey = null
                skipSegments = emptyList()
                playing = null
                playbackReady = false
                if (playerReturnPage in listOf("player", "sources")) "details" else playerReturnPage
            }
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

internal fun buildMpvSubtitleStyleProperties(
    fontSize: Int,
    color: String,
    backgroundOpacity: Int,
    backgroundBlurEnabled: Boolean,
    backgroundBlur: Int,
    fontStyle: String,
    borderThickness: Float,
    bold: Boolean,
    verticalPosition: Int,
    secondaryVerticalPosition: Int = verticalPosition,
    controlsShown: Boolean = false
): Map<String, String> {
    val opacity = backgroundOpacity.coerceIn(0, 100) / 100.0
    val backColor = String.format(Locale.US, "0/0/0/%.2f", opacity)
    val blurValue = if (backgroundBlurEnabled) {
        String.format(Locale.US, "%.2f", backgroundBlur.coerceIn(0, 100) / 25.0)
    } else "0"
    val (borderStyle, borderSize, borderColor, shadowOffset, shadowColor) = when (fontStyle) {
        "Border" -> listOf(
            "outline-and-shadow",
            String.format(Locale.US, "%.2f", borderThickness.coerceIn(0f, 10f) * 1.5f + 0.5f),
            "0/0/0/1",
            if (backgroundOpacity > 0) "2" else "0",
            "0/0/0/0.75"
        )
        "dropShadow" -> listOf("outline-and-shadow", "1", "0/0/0/0.6", "4", "0/0/0/0.9")
        "raised" -> listOf("outline-and-shadow", "1.2", "0/0/0/0.85", "3", "0/0/0/0.9")
        "depressed" -> listOf("outline-and-shadow", "1.5", "1/1/1/0.25", "2", "0/0/0/0.9")
        else -> listOf("background-box", "2", "0/0/0/0.85", "0", "0/0/0/0.6")
    }
    return linkedMapOf(
        "sub-font-size" to String.format(Locale.US, "%.1f", 55.0 * fontSize.coerceIn(1, 200) / 100.0),
        "sub-color" to color,
        "sub-bold" to if (bold) "yes" else "no",
        "sub-blur" to blurValue,
        "sub-border-style" to borderStyle,
        "sub-border-size" to borderSize,
        "sub-border-color" to borderColor,
        "sub-shadow-offset" to shadowOffset,
        "sub-shadow-color" to shadowColor,
        "sub-back-color" to backColor,
        "sub-pos" to subtitlePosition(controlsShown, verticalPosition).toString(),
        "secondary-sub-pos" to secondarySubtitlePosition(controlsShown, secondaryVerticalPosition).toString()
    )
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
