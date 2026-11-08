package com.framezoo.tv.ui

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.Icon
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import android.view.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.focus.FocusRequester
import kotlinx.coroutines.launch
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.zIndex
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.tv.material3.Border as TvBorder
import androidx.tv.material3.Card as TvCard
import androidx.tv.material3.CardDefaults as TvCardDefaults
import androidx.tv.material3.IconButton as TvIconButton
import androidx.tv.material3.IconButtonDefaults as TvIconButtonDefaults
import coil.compose.AsyncImage
import coil.compose.SubcomposeAsyncImage
import com.framezoo.tv.R
import com.framezoo.tv.model.CastMember
import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.FeaturedRatings
import com.framezoo.tv.model.Media
import com.framezoo.tv.model.MediaCollection
import com.framezoo.tv.model.Trailer
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

@Composable
private fun DetailsCard(onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val colors = LocalFrameZooColors.current
    val shape = RoundedCornerShape(8.dp)
    TvCard(onClick = onClick, modifier = modifier, shape = TvCardDefaults.shape(shape),
        colors = TvCardDefaults.colors(containerColor = Color.Transparent, focusedContainerColor = colors["mediaCard.hoverBackground"]),
        scale = TvCardDefaults.scale(focusedScale = 1.04f),
        border = TvCardDefaults.border(focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = shape))) { content() }
}

private fun formattedDate(value: String): String = try {
    LocalDate.parse(value).format(DateTimeFormatter.ofPattern("dd/MM/yyyy"))
} catch (_: Exception) { value }

@Composable
internal fun DetailsScreen(state: FrameZooState, item: Media) {
    val colors = LocalFrameZooColors.current
    val i18n = LocalI18n.current
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val firstAction = remember(item.id, item.type) { FocusRequester() }
    val seasonFocus = remember(item.id, item.type) { FocusRequester() }
    val closeFocus = remember(item.id, item.type) { FocusRequester() }
    val trailerFocus = remember(item.id, item.type) { FocusRequester() }
    val listState = rememberLazyListState()
    var logo by remember(item.id, item.type) { mutableStateOf<String?>(null) }
    var logoReady by remember(item.id, item.type) { mutableStateOf(false) }
    var ratings by remember(item.id, item.type) { mutableStateOf(FeaturedRatings()) }
    var cast by remember(item.id, item.type) { mutableStateOf<List<CastMember>>(emptyList()) }
    var trailers by remember(item.id, item.type) { mutableStateOf<List<Trailer>>(emptyList()) }
    var selectedTrailer by remember(item.id, item.type) { mutableStateOf<Trailer?>(null) }
    var similar by remember(item.id, item.type) { mutableStateOf<List<Media>>(emptyList()) }
    var collection by remember(item.id, item.type) { mutableStateOf<MediaCollection?>(null) }
    var provider by remember(item.id, item.type) { mutableStateOf<String?>(null) }
    var expandedEpisode by remember(item.id, item.type) { mutableStateOf<Episode?>(null) }
    var collectionOpen by remember(item.id, item.type) { mutableStateOf(false) }
    var collectionError by remember(item.id, item.type) { mutableStateOf("") }
    var collectionSort by remember(item.id, item.type) { mutableStateOf(false) }
    var seasonOpen by remember(item.id, item.type) { mutableStateOf(false) }
    var confirmSeasonWatched by remember(item.id, item.type) { mutableStateOf(false) }
    var showFavorites by remember(item.id, item.type) { mutableStateOf(false) }
    var favoriteEpisodes by remember(item.id, item.type) { mutableStateOf<List<Episode>>(emptyList()) }
    var favoritesLoading by remember(item.id, item.type) { mutableStateOf(false) }
    var copied by remember(item.id, item.type) { mutableStateOf(false) }
    var groupsOpen by remember(item.id, item.type) { mutableStateOf(false) }
    var selectedGroups by remember(item.id, item.type) { mutableStateOf<List<String>>(emptyList()) }
    var newGroup by remember(item.id, item.type) { mutableStateOf("") }
    var quality by remember(item.id, item.type) { mutableStateOf(item.releaseQuality) }
    val trailerEnabled = state.trailerEnabled
    val trailerMuted = state.trailerMuted
    val eligibleEpisodes = state.episodes.filter { it.id.isNotBlank() && it.seasonId.isNotBlank() && detailEpisodeAired(it.airDate) }
    val seasonWatched = eligibleEpisodes.isNotEmpty() && eligibleEpisodes.all { episode ->
        (state.history + state.progress).any { it.media.id == item.id && it.season == episode.season && it.episode == episode.number && it.duration > 0 && it.position / it.duration > .9 }
    }
    val favoriteIds = state.bookmarkDetails.firstOrNull { it.media.id == item.id }?.favoriteEpisodes.orEmpty()
    val saved = state.progress.firstOrNull { it.media.id == item.id && it.media.type == item.type && it.position > 0 }
    fun openUrl(url: String) {
        try { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        catch (_: ActivityNotFoundException) { state.error = "No browser found" }
    }
    LaunchedEffect(showFavorites, favoriteIds, state.seasons) {
        if (showFavorites) {
            if (favoriteIds.isEmpty()) { showFavorites = false; favoriteEpisodes = emptyList() }
            else {
                favoritesLoading = true
                try {
                    favoriteEpisodes = coroutineScope { state.seasons.map { season -> async { state.backend.episodes(item.id, season) } }.awaitAll().flatten() }
                        .filter { it.id in favoriteIds }
                } catch (e: CancellationException) { throw e } catch (e: Exception) { state.error = e.message ?: i18n.t("auth.login.failedToReachServer"); favoriteEpisodes = emptyList() }
                finally { favoritesLoading = false }
            }
        }
    }
    LaunchedEffect(copied) { if (copied) { delay(2500); copied = false } }
    LaunchedEffect(item.id, item.type) {
        listState.scrollToItem(0)
        delay(50)
        runCatching { firstAction.requestFocus() }
        delay(100)
        runCatching { firstAction.requestFocus() }
        if (item.type == "show" && state.episodes.isEmpty()) {
            initialDetailSeason(state.seasons, state.selectedSeason, saved?.season)?.let { state.chooseSeason(item, it) }
        }
    }
    if (item.addonManifest == null) {
        LaunchedEffect(item.id, item.type) { try { quality = state.backend.releaseQuality(item) } catch (e: CancellationException) { throw e } catch (_: Exception) { } }
        LaunchedEffect(item.id, item.type) { try { logo = state.backend.logo(item) } catch (e: CancellationException) { throw e } catch (_: Exception) { } }
        LaunchedEffect(item.id, item.type) { try { ratings = state.backend.featuredRatings(item) } catch (e: CancellationException) { throw e } catch (_: Exception) { } }
        LaunchedEffect(item.id, item.type) { try { provider = state.backend.provider(item) } catch (e: CancellationException) { throw e } catch (_: Exception) { } }
        LaunchedEffect(item.id, item.type) { try { cast = state.backend.cast(item) } catch (e: CancellationException) { throw e } catch (_: Exception) { } }
        LaunchedEffect(item.id, item.type) { try { trailers = state.backend.trailers(item) } catch (e: CancellationException) { throw e } catch (_: Exception) { } }
        LaunchedEffect(item.id, item.type) { try { similar = state.backend.similar(item) } catch (e: CancellationException) { throw e } catch (_: Exception) { } }
        LaunchedEffect(collectionOpen, item.collectionId) {
            if (collectionOpen && collection == null && item.collectionId != null) {
                collectionError = ""
                try { collection = state.backend.collection(item.collectionId) }
                catch (e: CancellationException) { throw e } catch (e: Exception) { collectionError = e.message ?: i18n.t("auth.login.failedToReachServer") }
            }
        }
    }
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .94f)), contentAlignment = Alignment.Center) {
      Box(Modifier.fillMaxWidth(.94f).fillMaxHeight(.94f).widthIn(max = 1120.dp).clip(RoundedCornerShape(20.dp)).background(colors["background.main"])) {
        LazyColumn(state = listState, contentPadding = PaddingValues(bottom = 32.dp)) {
            item {
                Box(Modifier.fillMaxWidth().height(380.dp).background(colors["background.secondary"])) {
                    AsyncImage(
                        model = item.backdrop,
                        contentDescription = null,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop,
                        alignment = Alignment.TopCenter
                    )
                    if (trailerEnabled && selectedTrailer == null && trailers.isNotEmpty()) {
                        TrailerBackground(trailers.first().key, trailerMuted, Modifier.fillMaxSize())
                    }
                    Box(
                        Modifier
                            .fillMaxSize()
                            .background(
                                Brush.verticalGradient(
                                    colorStops = arrayOf(
                                        0.0f to Color.Black.copy(alpha = 0.25f),
                                        0.35f to Color.Transparent,
                                        0.60f to Color.Transparent,
                                        0.78f to colors["background.main"].copy(alpha = 0.65f),
                                        0.90f to colors["background.main"].copy(alpha = 0.95f),
                                        1.0f to colors["background.main"]
                                    )
                                )
                            )
                    )

                    // Bottom Content overlay on Backdrop: Title/Logo + Badges & Trailer Controls
                    Column(
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .fillMaxWidth()
                            .padding(start = 28.dp, end = 24.dp, bottom = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        // Title or Logo
                        Box {
                            if (logo != null) {
                                AsyncImage(
                                    model = logo,
                                    contentDescription = item.title,
                                    modifier = Modifier
                                        .widthIn(max = 320.dp)
                                        .heightIn(max = 80.dp),
                                    contentScale = ContentScale.Fit,
                                    onSuccess = { logoReady = true },
                                    onError = { logoReady = false }
                                )
                            }
                            if (!logoReady || logo == null) {
                                Text(
                                    text = item.title,
                                    color = Color.White,
                                    fontSize = 32.sp,
                                    fontWeight = FontWeight.Bold,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }

                        // Badges line + Trailer controls on the same row!
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            // Badges row
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                if (item.type == "movie" && quality != null) {
                                    val isCinema = quality == "CAM"
                                    Text(
                                        text = if (isCinema) t("media.inCinema") else quality!!,
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(4.dp))
                                            .background(if (isCinema) Color(0xfff59e0b).copy(alpha = 0.25f) else colors["background.secondary"])
                                            .padding(horizontal = 8.dp, vertical = 3.dp),
                                        color = if (isCinema) Color(0xfffbbf24) else colors["type.emphasis"],
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                    Text("•", color = colors["type.secondary"], fontSize = 12.sp)
                                }
                                if (item.rating > 0) {
                                    Image(painterResource(R.drawable.desktop_tmdb), "TMDB", Modifier.width(28.dp).height(16.dp))
                                    Text("%.1f".format(item.rating) + if (item.voteCount > 0) " (%,d)".format(item.voteCount) else "", color = colors["type.emphasis"], fontSize = 13.5.sp)
                                }
                                ratings.imdbRating?.let { rating ->
                                    Text("•", color = colors["type.secondary"], fontSize = 12.sp)
                                    RatingIcon("imdb.svg", "IMDb")
                                    Text("%.1f".format(rating) + (ratings.imdbVotes?.let { " (%,d)".format(it) } ?: ""), color = colors["type.emphasis"], fontSize = 13.5.sp)
                                }
                                ratings.tomatoScore?.let { score ->
                                    Text("•", color = colors["type.secondary"], fontSize = 12.sp)
                                    RatingIcon(when (ratings.tomatoIcon) { "certified_fresh" -> "Certified_Fresh.svg"; "fresh" -> "Fresh.svg"; else -> "Rotten.svg" }, "Rotten Tomatoes")
                                    Text("$score%", color = colors["type.emphasis"], fontSize = 13.5.sp)
                                }
                                ratings.audienceScore?.let { score ->
                                    Text("•", color = colors["type.secondary"], fontSize = 12.sp)
                                    RatingIcon(when (ratings.audienceIcon) { "upright" -> "Popcorn_Fresh.svg"; "spilled" -> "Popcorn_Rotten.svg"; else -> "Popcorn_Empty.svg" }, "Popcornmeter")
                                    Text("$score%", color = colors["type.emphasis"], fontSize = 13.5.sp)
                                }
                                if (item.year.isNotBlank()) {
                                    Text("•", color = colors["type.secondary"], fontSize = 12.sp)
                                    Text(item.year, color = colors["type.secondary"], fontSize = 13.5.sp)
                                }
                                if (item.type == "show" && state.seasons.isNotEmpty()) {
                                    Text("•", color = colors["type.secondary"], fontSize = 12.sp)
                                    Text("${state.seasons.size} " + t("details.seasons"), color = colors["type.secondary"], fontSize = 13.5.sp)
                                }
                            }

                            // Trailer Buttons on the right
                            if (trailers.isNotEmpty()) {
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    HeaderButton(
                                        icon = if (trailerMuted) R.drawable.desktop_volume_x else R.drawable.desktop_volume,
                                        label = if (trailerMuted) "Unmute trailer" else "Mute trailer",
                                        selected = !trailerMuted,
                                        modifier = Modifier.focusProperties {
                                            up = closeFocus
                                            down = firstAction
                                        }
                                    ) { state.toggleTrailerAudio() }
                                    HeaderButton(
                                        icon = if (trailerEnabled) R.drawable.desktop_image else R.drawable.desktop_video,
                                        label = if (trailerEnabled) "Show image" else "Show trailer",
                                        selected = trailerEnabled,
                                        modifier = Modifier
                                            .focusRequester(trailerFocus)
                                            .focusProperties {
                                                up = closeFocus
                                                down = firstAction
                                            }
                                    ) { state.toggleTrailer() }
                                }
                            }
                        }
                    }
                }
            }
            item {
                Column(
                    modifier = Modifier
                        .padding(horizontal = 28.dp)
                        .padding(top = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            val playLabel = if (item.type == "movie" && (item.releaseDate.isBlank() || runCatching { LocalDate.parse(item.releaseDate).isAfter(LocalDate.now()) }.getOrDefault(false))) t("media.unreleased") else if (saved == null) t("details.play") else if (item.type == "show" && saved.season != null && saved.episode != null) "${t("details.resume")} S${saved.season}:E${saved.episode}" else t("details.resume")
                            TvButton(
                                playLabel,
                                modifier = Modifier
                                    .focusRequester(firstAction)
                                    .focusProperties {
                                        up = if (trailers.isNotEmpty()) trailerFocus else closeFocus
                                    },
                                accent = true,
                                loading = state.busy,
                                icon = R.drawable.desktop_play
                            ) {
                                if (item.addonManifest != null) {
                                    if (item.type == "movie") state.loadSources(item, null)
                                    else state.episodes.firstOrNull()?.let { state.loadSources(item, it) } ?: run { state.error = i18n.t("player.menus.episodes.emptyState") }
                                } else state.playFeatured(item)
                            }
                            if (item.id.isNotBlank() && item.id.all(Char::isDigit)) {
                                val bookmarked = state.bookmarks.any { it.id == item.id }
                                HeaderButton(
                                    if (bookmarked) R.drawable.desktop_bookmark_filled else R.drawable.desktop_bookmark,
                                    t("home.bookmarks.sectionTitle"),
                                    bookmarked,
                                    modifier = Modifier.focusProperties {
                                        up = if (trailers.isNotEmpty()) trailerFocus else closeFocus
                                    }
                                ) { state.bookmark(item) }
                                HeaderButton(
                                    R.drawable.desktop_share,
                                    t("actions.copy"),
                                    false,
                                    modifier = Modifier.focusProperties {
                                        up = if (trailers.isNotEmpty()) trailerFocus else closeFocus
                                    }
                                ) {
                                    val kind = if (item.type == "show") "tv" else "movie"
                                    val link = "https://framezoo.top/discover?detail=tmdb-$kind-${item.id}-media"
                                    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(item.title, link))
                                    copied = true
                                }
                            }
                        }
                        if (item.id.isNotBlank() && item.id.all(Char::isDigit)) {
                            val currentItemGroups = state.bookmarkDetails.firstOrNull { it.media.id == item.id }?.groups.orEmpty()
                            val groupLabel = if (currentItemGroups.isEmpty()) {
                                t("home.bookmarks.groups.dropdown.placeholderButton")
                            } else {
                                currentItemGroups.joinToString(", ") { g ->
                                    val match = Regex("^\\[([a-zA-Z0-9_]+)\\](.*)$").find(g)
                                    match?.groupValues?.get(2)?.trim() ?: g
                                }
                            }
                            TvButton(
                                groupLabel,
                                trailingIcon = R.drawable.desktop_chevron_down,
                                modifier = Modifier.focusProperties {
                                    up = if (trailers.isNotEmpty()) trailerFocus else closeFocus
                                }
                            ) {
                                if (!state.isLoggedIn) state.openLogin() else {
                                    selectedGroups = currentItemGroups
                                    newGroup = ""; groupsOpen = true
                                }
                            }
                        }
                    }
                    if (copied) Text(t("toasts.linkCopied"), color = colors["type.secondary"], fontSize = 13.sp)
                    if (state.error.isNotBlank()) Text(state.error, color = colors["type.danger"], fontSize = 13.sp)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                        Column(Modifier.weight(2f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            if (item.description.isNotBlank()) Text(item.description, color = colors["type.secondary"], fontSize = 14.5.sp, lineHeight = 22.sp)
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                androidx.compose.foundation.layout.FlowRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    item.genres.forEach { genre ->
                                        Text(
                                            text = genre,
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(50))
                                                .background(colors["mediaCard.hoverBackground"])
                                                .padding(horizontal = 12.dp, vertical = 5.dp),
                                            color = colors["type.secondary"],
                                            fontSize = 12.5.sp,
                                            fontWeight = FontWeight.Medium
                                        )
                                    }
                                }
                                if (item.type == "movie" && item.addonManifest == null) {
                                    val watched = state.history.any { it.media.id == item.id && it.duration > 0 && it.position / it.duration > .9 }
                                    HeaderButton(if (watched) R.drawable.desktop_eye_slash else R.drawable.desktop_eye, if (watched) t("player.menus.episodes.markAsUnwatched") else t("player.menus.episodes.markAsWatched"), watched) { state.markMovieWatched(item, !watched) }
                                }
                            }
                            cast.firstOrNull { it.role == "Director" || it.role == "Đạo diễn" }?.let { Text(it.name, color = colors["type.secondary"], fontSize = 13.sp) }
                            val actors = cast.filter { it.role != "Director" && it.role != "Đạo diễn" }.take(6).joinToString(", ") { it.name }
                            if (actors.isNotBlank()) Text(actors, color = colors["type.secondary"], fontSize = 13.sp)
                        }
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(12.dp))
                                .background(colors["background.secondary"].copy(alpha = .5f))
                                .border(BorderStroke(1.dp, Color.White.copy(alpha = 0.08f)), RoundedCornerShape(12.dp))
                                .padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            if (item.runtime > 0) {
                                val hours = item.runtime / 60
                                val minutes = item.runtime % 60
                                val runtimeText = if (hours > 0) "${hours}h ${minutes}m" else "${minutes}m"
                                val endTimeStr = LocalTime.now().plusMinutes(item.runtime.toLong()).format(DateTimeFormatter.ofPattern("h:mm a"))
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text("${t("details.runtime")} $runtimeText", color = colors["type.emphasis"], fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
                                    if (item.type == "movie") {
                                        Text("•", color = colors["type.secondary"], fontSize = 12.sp)
                                        Text(t("details.endsAt", "time" to endTimeStr), color = colors["type.secondary"], fontSize = 12.5.sp)
                                    }
                                }
                            }
                            if (item.language.isNotBlank()) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(t("details.language"), color = colors["type.secondary"], fontSize = 12.5.sp)
                                    Text(item.language.uppercase(), color = colors["type.emphasis"], fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
                                }
                            }
                            if (item.releaseDate.isNotBlank()) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(t("details.episodeReleaseDate", "date" to "").trimEnd(), color = colors["type.secondary"], fontSize = 12.5.sp)
                                    Text(formattedDate(item.releaseDate), color = colors["type.emphasis"], fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
                                }
                            }
                            if (item.id.isNotBlank()) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text("ID:", color = colors["type.secondary"], fontSize = 12.5.sp)
                                    Text(item.id, color = colors["type.emphasis"], fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
                                }
                            }
                            if (item.certification.isNotBlank()) {
                                Text("${t("details.rating")} ${item.certification}", color = colors["type.secondary"], fontSize = 12.5.sp)
                            }
                            if (item.collectionId != null) TvButton(item.collectionName ?: t("lists.page.eyebrow"), trailingIcon = R.drawable.desktop_chevron_right) { collectionOpen = true }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                provider?.let { name ->
                                    val key = detailProviderAsset(name)
                                    if (key.matches(Regex("[a-z0-9]+")) && remember(key) { runCatching { context.assets.open("platforms/$key.png").close(); true }.getOrDefault(false) })
                                        AsyncImage("file:///android_asset/platforms/$key.png", name, Modifier.size(32.dp).clip(RoundedCornerShape(6.dp)), contentScale = ContentScale.Fit)
                                }
                                if (item.id.isNotBlank() && item.id.all(Char::isDigit)) DetailsRatingButton("TMDB", null, Color(0xff0d253f), R.drawable.desktop_tmdb) { openUrl("https://www.themoviedb.org/${if (item.type == "show") "tv" else "movie"}/${item.id}") }
                                if (!item.imdbId.isNullOrBlank()) DetailsRatingButton("IMDb", "imdb.svg", Color(0xfff5c518), null) { openUrl("https://www.imdb.com/title/${item.imdbId}") }
                                listOf(Triple("Rotten Tomatoes", ratings.tomatoUrl, when (ratings.tomatoIcon) { "certified_fresh" -> "Certified_Fresh.svg"; "fresh" -> "Fresh.svg"; else -> "Rotten.svg" }), Triple("Popcornmeter", ratings.audienceUrl ?: ratings.tomatoUrl, when (ratings.audienceIcon) { "upright" -> "Popcorn_Fresh.svg"; "spilled" -> "Popcorn_Rotten.svg"; else -> "Popcorn_Empty.svg" })).forEach { (label, url, asset) ->
                                    if ((label != "Popcornmeter" || ratings.audienceScore != null) && url != null && try { val uri = Uri.parse(url); uri.scheme == "https" && (uri.host == "rottentomatoes.com" || uri.host?.endsWith(".rottentomatoes.com") == true) } catch (_: Exception) { false }) DetailsRatingButton(label, asset, Color.Transparent, null) { openUrl(url) }
                                }
                            }
                        }
                    }
                }
            }
            if (item.type == "show" && state.seasons.isNotEmpty()) item {
                Column(Modifier.padding(start = 26.dp, end = 26.dp, top = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(t("details.episodes"), color = colors["type.emphasis"], fontSize = 21.sp, fontWeight = FontWeight.Bold)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (!showFavorites && eligibleEpisodes.isNotEmpty()) HeaderButton(R.drawable.desktop_eye, if (seasonWatched) t("media.seasonUnwatched") else t("media.seasonWatched"), seasonWatched) {
                                if (!state.isLoggedIn) state.openLogin() else confirmSeasonWatched = true
                            }
                            TvButton(if (showFavorites) "${t("player.menus.episodes.favorites")} (${favoriteIds.size})" else "${t("details.season")} ${state.selectedSeason ?: state.seasons.first()}", modifier = Modifier.focusRequester(seasonFocus), trailingIcon = R.drawable.desktop_chevron_down) { seasonOpen = true }
                        }
                    }
                    val shownEpisodes = if (showFavorites) favoriteEpisodes else state.episodes
                    if (if (showFavorites) favoritesLoading else state.episodesLoading) {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(vertical = 5.dp)) {
                            items(4) { DetailsEpisodeSkeleton() }
                        }
                    } else if (shownEpisodes.isEmpty()) Text(if (showFavorites) t("player.menus.episodes.noFavorites") else t("player.menus.episodes.emptyState"), color = colors["type.secondary"])
                    else LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(vertical = 5.dp)) {
                        items(shownEpisodes, key = { "${it.season}:${it.number}" }) { episode ->
                            val progress = state.progress.firstOrNull { it.media.id == item.id && it.season == episode.season && it.episode == episode.number }
                            val watched = (state.history + listOfNotNull(progress)).any { it.media.id == item.id && it.season == episode.season && it.episode == episode.number && it.duration > 0 && it.position / it.duration > .9 }
                            val favorite = state.bookmarkDetails.firstOrNull { it.media.id == item.id }?.favoriteEpisodes?.contains(episode.id) == true
                            DetailsEpisodeCard(episode, progress, seasonFocus, favorite, watched, showFavorites,
                                onFavorite = { state.toggleFavoriteEpisode(item, episode) }, onWatched = { state.markEpisodeWatched(item, episode, !watched) }, onOverview = { expandedEpisode = episode }) { state.loadSources(item, episode) }
                        }
                    }
                }
            }
            if (cast.isNotEmpty()) item {
                LazyRow(Modifier.padding(start = 26.dp, top = 28.dp, end = 26.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(vertical = 5.dp)) {
                    items(cast.filter { !it.image.isNullOrBlank() }, key = { "${it.id}:${it.role}" }) { person ->
                        DetailsCard({ openUrl("https://www.themoviedb.org/person/${person.id}") }, Modifier.width(120.dp)) {
                            Column(Modifier.fillMaxWidth().padding(5.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                SubcomposeAsyncImage(
                                    model = person.image,
                                    contentDescription = person.name,
                                    modifier = Modifier.size(100.dp).clip(CircleShape),
                                    contentScale = ContentScale.Crop,
                                    loading = { Box(Modifier.fillMaxSize().skeletonShimmer()) },
                                    error = {
                                        Box(Modifier.fillMaxSize().background(colors["background.secondary"]), contentAlignment = Alignment.Center) {
                                            Icon(painterResource(R.drawable.desktop_user), null, tint = colors["type.secondary"], modifier = Modifier.size(36.dp))
                                        }
                                    }
                                )
                                Text(person.name, color = colors["type.emphasis"], maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 14.sp)
                                Text(person.role, color = colors["type.secondary"], maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp)
                            }
                        }
                    }
                }
            }
            val allTrailers = trailers + listOfNotNull(ratings.trailerUrl?.let { Trailer(it, "IMDb Trailer", true, ratings.trailerThumbnail) })
            if (allTrailers.isNotEmpty()) item {
                Column(Modifier.padding(start = 26.dp, top = 28.dp, end = 26.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(t("details.trailers"), color = colors["type.emphasis"], fontSize = 21.sp, fontWeight = FontWeight.SemiBold)
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(vertical = 5.dp)) { items(allTrailers, key = { it.key }) { trailer ->
                        DetailsCard({ selectedTrailer = trailer }, Modifier.width(300.dp)) {
                            Box(Modifier.fillMaxWidth().height(164.dp)) {
                                AsyncImage(if (trailer.isImdb) trailer.thumbnail else "https://i.ytimg.com/vi/${trailer.key}/hqdefault.jpg", trailer.name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, placeholder = painterResource(R.drawable.desktop_trailer_placeholder), error = painterResource(R.drawable.desktop_trailer_placeholder))
                                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = .7f), Color.Transparent))))
                                Text(trailer.name, Modifier.align(Alignment.TopStart).padding(12.dp), color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    } }
                }
            }
            if (similar.isNotEmpty()) item { Box(Modifier.padding(start = 26.dp, top = 28.dp, end = 26.dp)) { MediaGrid(t("details.similar"), similar, state::openDetails, bookmarks = state.bookmarks.map { it.id }.toSet(), onBookmark = state::bookmark, qualityLoader = state.backend::releaseQuality) } }
        }
        Box(Modifier.align(Alignment.TopEnd).padding(16.dp)) {
            var closeFocused by remember { mutableStateOf(false) }
            TvIconButton(
                onClick = { state.back() },
                modifier = Modifier
                    .size(38.dp)
                    .focusRequester(closeFocus)
                    .focusProperties {
                        down = if (trailers.isNotEmpty() && listState.firstVisibleItemIndex == 0) trailerFocus else firstAction
                        left = firstAction
                    }
                    .onFocusChanged { closeFocused = it.isFocused }
                    .onPreviewKeyEvent { event ->
                        if (event.nativeKeyEvent.action == android.view.KeyEvent.ACTION_DOWN) {
                            when (event.nativeKeyEvent.keyCode) {
                                android.view.KeyEvent.KEYCODE_DPAD_UP -> {
                                    if (listState.firstVisibleItemIndex > 0 || listState.firstVisibleItemScrollOffset > 0) {
                                        coroutineScope.launch {
                                            listState.animateScrollToItem(0)
                                        }
                                        true
                                    } else false
                                }
                                android.view.KeyEvent.KEYCODE_DPAD_DOWN,
                                android.view.KeyEvent.KEYCODE_DPAD_LEFT -> {
                                    coroutineScope.launch {
                                        if (listState.firstVisibleItemIndex > 0 || listState.firstVisibleItemScrollOffset > 0) {
                                            listState.scrollToItem(0)
                                        }
                                        val target = if (event.nativeKeyEvent.keyCode == android.view.KeyEvent.KEYCODE_DPAD_DOWN && trailers.isNotEmpty()) trailerFocus else firstAction
                                        target.requestFocus()
                                    }
                                    true
                                }
                                else -> false
                            }
                        } else false
                    }
                    .semantics { contentDescription = i18n.t("overlays.close") },
                shape = TvIconButtonDefaults.shape(CircleShape),
                colors = TvIconButtonDefaults.colors(
                    containerColor = Color.Black.copy(alpha = 0.5f),
                    focusedContainerColor = Color.Black.copy(alpha = 0.75f)
                ),
                scale = TvIconButtonDefaults.scale(focusedScale = 1.08f),
                border = TvIconButtonDefaults.border(
                    focusedBorder = TvBorder(BorderStroke(2.dp, Color.White), shape = CircleShape)
                )
            ) {
                Icon(
                    painter = painterResource(R.drawable.desktop_close),
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(16.dp)
                )
            }
        }
      }
    }
    selectedTrailer?.let { trailer ->
        Dialog(onDismissRequest = { selectedTrailer = null }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxWidth(.9f).widthIn(max = 1150.dp).aspectRatio(16f / 9f)) {
                DetailsTrailerPlayer(trailer.key, trailer.name, { selectedTrailer = null }, trailer.isImdb) { state.error = it }
            }
        }
    }
    expandedEpisode?.let { episode ->
        Dialog(onDismissRequest = { expandedEpisode = null }) {
            Column(Modifier.widthIn(max = 550.dp).clip(RoundedCornerShape(14.dp)).background(colors["background.main"]).padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("${t("details.episode")} ${episode.number}: ${episode.title}", color = colors["type.emphasis"], fontSize = 20.sp, fontWeight = FontWeight.Bold)
                LazyColumn(Modifier.heightIn(max = 300.dp)) { item { Text(episode.overview, color = colors["type.text"], fontSize = 15.sp, lineHeight = 22.sp) } }
                TvButton(t("player.menus.episodes.showLess")) { expandedEpisode = null }
            }
        }
    }
    if (confirmSeasonWatched) Dialog(onDismissRequest = { confirmSeasonWatched = false }) {
        Column(Modifier.widthIn(min = 320.dp, max = 500.dp).clip(RoundedCornerShape(14.dp)).background(colors["background.main"]).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(if (seasonWatched) t("media.seasonUnwatched") else t("media.seasonWatched"), color = colors["type.emphasis"], fontSize = 18.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TvButton(t("actions.confirm"), accent = true) {
                    val targets = eligibleEpisodes.filter { episode ->
                        (state.history + state.progress).any { it.media.id == item.id && it.season == episode.season && it.episode == episode.number && it.duration > 0 && it.position / it.duration > .9 } == seasonWatched
                    }
                    confirmSeasonWatched = false; state.markSeasonWatched(item, targets, !seasonWatched)
                }
                TvButton(t("actions.cancel")) { confirmSeasonWatched = false }
            }
        }
    }
    if (groupsOpen) Dialog(onDismissRequest = { groupsOpen = false }) {
        Column(
            Modifier
                .widthIn(min = 360.dp, max = 480.dp)
                .heightIn(max = 520.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(colors["background.main"])
                .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(18.dp))
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text(
                t("home.bookmarks.groups.dropdown.placeholderButton"),
                color = colors["type.emphasis"],
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold
            )
            val allAvailableGroups = (state.bookmarkGroups + selectedGroups).distinct()
            if (allAvailableGroups.isEmpty()) {
                Text(
                    t("home.bookmarks.groups.dropdown.empty"),
                    color = colors["type.secondary"],
                    fontSize = 14.sp
                )
            } else {
                LazyColumn(
                    Modifier.heightIn(max = 220.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(allAvailableGroups) { group ->
                        val isChecked = group in selectedGroups
                        val cleanName = Regex("^\\[([a-zA-Z0-9_]+)\\](.*)$").find(group)?.groupValues?.get(2)?.trim() ?: group
                        TvCard(
                            onClick = {
                                selectedGroups = if (isChecked) selectedGroups - group else selectedGroups + group
                            },
                            shape = TvCardDefaults.shape(RoundedCornerShape(10.dp)),
                            colors = TvCardDefaults.colors(
                                containerColor = if (isChecked) colors["pill.activeBackground"] else colors["background.secondary"].copy(alpha = 0.5f),
                                focusedContainerColor = colors["pill.activeBackground"]
                            ),
                            border = TvCardDefaults.border(
                                focusedBorder = TvBorder(BorderStroke(2.dp, if (isChecked) Color.White else colors["type.logo"]), shape = RoundedCornerShape(10.dp))
                            ),
                            scale = TvCardDefaults.scale(focusedScale = 1.04f),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 14.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(20.dp)
                                        .clip(RoundedCornerShape(4.dp))
                                        .background(if (isChecked) colors["buttons.purple"] ?: colors["type.logo"] else Color.Transparent)
                                        .border(BorderStroke(1.5.dp, if (isChecked) colors["buttons.purple"] ?: colors["type.logo"] else colors["type.secondary"]), RoundedCornerShape(4.dp)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    if (isChecked) {
                                        Icon(painterResource(R.drawable.desktop_checkmark), null, tint = Color.White, modifier = Modifier.size(13.dp))
                                    }
                                }
                                Text(cleanName, color = colors["type.emphasis"], fontSize = 14.sp, fontWeight = FontWeight.Medium)
                            }
                        }
                    }
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = newGroup,
                    onValueChange = { newGroup = it },
                    singleLine = true,
                    placeholder = { Text(t("home.bookmarks.groups.dropdown.namePlaceholder")) },
                    colors = tvFieldColors(),
                    modifier = Modifier.weight(1f)
                )
                TvButton(
                    label = "",
                    icon = R.drawable.desktop_plus,
                    accent = true
                ) {
                    newGroup.trim().takeIf { it.isNotEmpty() }?.let {
                        selectedGroups = (selectedGroups + it).distinct()
                        newGroup = ""
                    }
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                TvButton(t("settings.save"), accent = true, modifier = Modifier.weight(1f)) {
                    groupsOpen = false
                    state.updateBookmarkGroups(item, selectedGroups)
                }
                TvButton(t("actions.cancel"), modifier = Modifier.weight(1f)) {
                    groupsOpen = false
                }
            }
        }
    }
    if (seasonOpen) Dialog(onDismissRequest = { seasonOpen = false }) {
        Column(Modifier.widthIn(min = 230.dp, max = 360.dp).heightIn(max = 480.dp).clip(RoundedCornerShape(14.dp)).background(colors["background.main"]).padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(t("details.season"), color = colors["type.emphasis"], fontSize = 20.sp, fontWeight = FontWeight.Bold)
            LazyColumn(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                if (favoriteIds.isNotEmpty() && item.addonManifest == null) item { TvButton("${t("player.menus.episodes.favorites")} (${favoriteIds.size})", selected = showFavorites, navigation = true) { seasonOpen = false; showFavorites = true } }
                items(state.seasons) { season ->
                    TvButton("${t("details.season")} $season", selected = !showFavorites && season == state.selectedSeason, navigation = true) { seasonOpen = false; showFavorites = false; state.chooseSeason(item, season) }
                }
            }
        }
    }
    if (collectionOpen) Dialog(onDismissRequest = { collectionOpen = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxWidth(.9f).widthIn(max = 1100.dp).clip(RoundedCornerShape(18.dp)).background(colors["background.main"]).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Column { Text(item.collectionName ?: t("lists.page.eyebrow"), color = colors["type.emphasis"], fontSize = 25.sp, fontWeight = FontWeight.Bold); collection?.let { Text("${it.parts.size} ${t("details.collection.movies")}", color = colors["type.secondary"]) } }
                HeaderButton(R.drawable.desktop_close, t("overlays.close"), false) { collectionOpen = false }
            }
            collection?.overview?.takeIf { it.isNotBlank() }?.let { Text(it, color = colors["type.text"], fontSize = 14.sp) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!collection?.parts.isNullOrEmpty()) TvButton(t("details.collection.bookmarkAll"), icon = R.drawable.desktop_bookmark) {
                    if (!state.isLoggedIn) { collectionOpen = false; state.openLogin() }
                    else state.bookmarkCollection(collection!!.parts, item.collectionName ?: i18n.t("lists.page.eyebrow"))
                }
                TvButton(t("details.collection.releaseDate"), selected = !collectionSort, navigation = true) { collectionSort = false }
                TvButton(t("details.collection.rating"), selected = collectionSort, navigation = true) { collectionSort = true }
            }
            if (state.busy) CircularProgressIndicator(Modifier.size(22.dp))
            if (state.error.isNotBlank()) Text(state.error, color = colors["type.danger"], fontSize = 13.sp)
            when {
                collectionError.isNotBlank() -> Text(collectionError, color = colors["type.danger"])
                collection == null -> CircularProgressIndicator(Modifier.size(24.dp).padding(4.dp))
                collection!!.parts.isEmpty() -> Text(t("home.search.empty.default"), color = colors["type.secondary"])
                else -> MediaGrid("", if (collectionSort) collection!!.parts.sortedByDescending { it.rating } else collection!!.parts, { collectionOpen = false; state.openDetails(it) }, bookmarks = state.bookmarks.map { it.id }.toSet(), onBookmark = state::bookmark, qualityLoader = state.backend::releaseQuality)
            }
        }
    }
}

@Composable
private fun DetailsEpisodeCard(
    episode: Episode,
    progress: com.framezoo.tv.model.LibraryItem?,
    seasonFocus: FocusRequester,
    favorite: Boolean,
    watched: Boolean,
    showFavorites: Boolean,
    onFavorite: () -> Unit,
    onWatched: () -> Unit,
    onOverview: () -> Unit,
    onClick: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val i18n = LocalI18n.current
    val unaired = episode.id.isNotBlank() && !detailEpisodeAired(episode.airDate)
    val cardFocus = remember { FocusRequester() }
    val favoriteFocus = remember { FocusRequester() }
    var active by remember { mutableStateOf(false) }
    var actionFocused by remember { mutableStateOf(false) }
    val hasActions = !unaired && episode.id.isNotBlank() && episode.seasonId.isNotBlank()
    val hasToolbar = hasActions || episode.overview.isNotBlank()
    val episodeBadgeLabel = if (showFavorites) {
        t("media.episodeDisplay", "season" to episode.season.toString(), "episode" to episode.number.toString())
    } else {
        t("player.menus.episodes.episodeBadge", "episode" to episode.number.toString())
    }

    Box(Modifier.width(235.dp).zIndex(if (active || actionFocused) 1f else 0f)) {
      DetailsCard(
          onClick = onClick,
          modifier = Modifier
              .width(235.dp)
              .alpha(if (unaired) .65f else 1f)
              .focusRequester(cardFocus)
              .focusProperties { up = if (hasToolbar) favoriteFocus else seasonFocus }
              .onFocusChanged { active = it.hasFocus }
      ) {
        Column(Modifier.fillMaxWidth().height(265.dp)) {
            Box(Modifier.fillMaxWidth().height(140.dp).background(colors["background.secondary"])) {
                if (!episode.still.isNullOrBlank()) {
                    SubcomposeAsyncImage(
                        model = episode.still,
                        contentDescription = null,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop,
                        loading = {
                            Box(Modifier.fillMaxSize().skeletonShimmer())
                        },
                        error = {
                            Box(Modifier.fillMaxSize().background(colors["background.secondary"]), contentAlignment = Alignment.Center) {
                                Image(painterResource(R.drawable.desktop_placeholder), null, Modifier.size(44.dp).alpha(0.75f))
                            }
                        }
                    )
                } else {
                    Box(Modifier.fillMaxSize().background(colors["background.secondary"]), contentAlignment = Alignment.Center) {
                        Image(painterResource(R.drawable.desktop_placeholder), null, Modifier.size(44.dp).alpha(0.75f))
                    }
                }

                // Episode Number Badge & Unaired Tag matching desktop
                Row(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(
                        text = episodeBadgeLabel,
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color.Black.copy(alpha = .75f))
                            .padding(horizontal = 7.dp, vertical = 3.dp),
                        color = Color.White,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold
                    )
                    if (unaired) {
                        Text(
                            text = t("media.unreleased"),
                            modifier = Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(Color(0xFFE5A00D).copy(alpha = 0.85f))
                                .padding(horizontal = 6.dp, vertical = 3.dp),
                            color = Color.Black,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

                // Progress Bar at bottom of thumbnail matching Desktop
                if (progress != null && progress.duration > 0) {
                    Box(
                        Modifier
                            .align(Alignment.BottomCenter)
                            .fillMaxWidth()
                            .height(4.dp)
                            .background(colors["mediaCard.barColor"])
                    ) {
                        Box(
                            Modifier
                                .fillMaxWidth((progress.position / progress.duration).toFloat().coerceIn(0f, 1f))
                                .fillMaxHeight()
                                .background(colors["mediaCard.barFillColor"])
                        )
                    }
                }
            }
            Column(Modifier.weight(1f).padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(episode.title, color = colors["type.emphasis"], fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 14.sp)
                Text(if (episode.airDate.isBlank()) t("details.episodeReleaseDateUnknown") else formattedDate(episode.airDate), color = colors["type.secondary"], fontSize = 12.sp)
                if (episode.overview.isNotBlank()) Text(episode.overview, color = colors["type.text"], maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 13.sp, lineHeight = 17.sp)
            }
        }
      }
      if (hasToolbar) Row(Modifier.align(Alignment.TopEnd).padding(7.dp).onFocusChanged { actionFocused = it.hasFocus }.alpha(if (active || actionFocused) 1f else 0f)) {
          val shape = CircleShape
          val buttonColors = TvIconButtonDefaults.colors(containerColor = Color.Black.copy(alpha = .65f), focusedContainerColor = colors["pill.activeBackground"])
          if (episode.overview.isNotBlank()) TvIconButton(onClick = onOverview, modifier = Modifier.size(36.dp).focusRequester(favoriteFocus)
              .focusProperties { up = seasonFocus; down = cardFocus; canFocus = active || actionFocused }
              .semantics { contentDescription = i18n.t("player.menus.episodes.showMore") }, shape = TvIconButtonDefaults.shape(shape), colors = buttonColors,
              border = TvIconButtonDefaults.border(focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = shape)),
              scale = TvIconButtonDefaults.scale(focusedScale = 1.08f)) {
              Icon(painterResource(R.drawable.desktop_chevron_down), null, Modifier.size(17.dp), tint = Color.White)
          }
          if (hasActions) TvIconButton(onClick = onFavorite, modifier = Modifier.size(36.dp).then(if (episode.overview.isBlank()) Modifier.focusRequester(favoriteFocus) else Modifier)
              .focusProperties { up = seasonFocus; down = cardFocus; canFocus = active || actionFocused }
              .semantics { contentDescription = i18n.t("player.menus.episodes.markAsFavorite") },
              shape = TvIconButtonDefaults.shape(shape), colors = buttonColors,
              border = TvIconButtonDefaults.border(focusedBorder = TvBorder(BorderStroke(2.dp, if (favorite) Color.White else colors["type.logo"]), shape = shape)),
              scale = TvIconButtonDefaults.scale(focusedScale = 1.08f)) {
              Icon(painterResource(if (favorite) R.drawable.desktop_bookmark_filled else R.drawable.desktop_bookmark), null, Modifier.size(15.dp), tint = Color.White)
          }
          if (hasActions) TvIconButton(onClick = onWatched, modifier = Modifier.size(36.dp)
              .focusProperties { up = seasonFocus; down = cardFocus; canFocus = active || actionFocused }
              .semantics { contentDescription = if (watched) i18n.t("player.menus.episodes.markAsUnwatched") else i18n.t("player.menus.episodes.markAsWatched") },
              shape = TvIconButtonDefaults.shape(shape), colors = buttonColors,
              border = TvIconButtonDefaults.border(focusedBorder = TvBorder(BorderStroke(2.dp, if (watched) Color.White else colors["type.logo"]), shape = shape)),
              scale = TvIconButtonDefaults.scale(focusedScale = 1.08f)) {
              Icon(painterResource(if (watched) R.drawable.desktop_eye_slash else R.drawable.desktop_eye), null, Modifier.size(17.dp), tint = if (watched) colors["type.logo"] else Color.White)
          }
      }
    }
}

@Composable
internal fun TrailerScreen(state: FrameZooState) {
    DetailsTrailerPlayer(state.trailerKey, state.trailerTitle, state::back) { state.error = it }
}

@Composable
private fun DetailsTrailerPlayer(key: String, title: String, onClose: () -> Unit, isImdb: Boolean = false, onError: (String) -> Unit) {
    val i18n = LocalI18n.current
    var muted by remember(key) { mutableStateOf(false) }
    var paused by remember(key) { mutableStateOf(false) }
    var status by remember(key) { mutableStateOf("loading") }
    val context = LocalContext.current
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (isImdb) ImdbTrailerPlayer(key, muted, paused, Modifier.fillMaxSize()) { status = it } else TrailerBackground(key, muted, Modifier.fillMaxSize(), paused) { status = it }
        if (status != "playing") {
            if (status == "loading") CircularProgressIndicator(Modifier.align(Alignment.Center).size(32.dp))
            else Text(t("player.playbackError.title"), color = Color.White, modifier = Modifier.align(Alignment.Center))
        }
        Row(Modifier.align(Alignment.BottomStart).padding(20.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            TvButton(t("overlays.close"), modifier = Modifier.focusRequester(focus), icon = R.drawable.desktop_close) { onClose() }
            TvButton(if (paused) t("details.play") else t("global.keyboardShortcuts.shortcuts.playPauseAlt"), icon = if (paused) R.drawable.desktop_play else R.drawable.desktop_pause) { paused = !paused }
            TvButton(if (muted) "Unmute" else "Mute", icon = if (muted) R.drawable.desktop_volume_x else R.drawable.desktop_volume) { muted = !muted }
            if (status == "error" && !isImdb) TvButton(t("details.trailers")) {
                try { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/watch?v=$key"))) }
                catch (_: ActivityNotFoundException) { onError("No browser found") }
            }
            Text(title, color = Color.White, modifier = Modifier.align(Alignment.CenterVertically), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun DetailsRatingButton(label: String, asset: String?, background: Color, drawable: Int?, onClick: () -> Unit) {
    val colors = LocalFrameZooColors.current
    val shape = RoundedCornerShape(6.dp)
    val context = LocalContext.current
    val loader = remember(context) { coil.ImageLoader.Builder(context).components { add(coil.decode.SvgDecoder.Factory()) }.build() }
    TvIconButton(onClick = onClick, modifier = Modifier.size(36.dp).semantics { contentDescription = label },
        shape = TvIconButtonDefaults.shape(shape),
        colors = TvIconButtonDefaults.colors(containerColor = background, focusedContainerColor = background),
        border = TvIconButtonDefaults.border(focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = shape)),
        scale = TvIconButtonDefaults.scale(focusedScale = 1.1f)) {
        if (drawable != null) Image(painterResource(drawable), null, Modifier.size(28.dp), contentScale = ContentScale.Fit)
        else if (asset != null) AsyncImage(model = "file:///android_asset/ratings/$asset", contentDescription = null, modifier = Modifier.size(30.dp), imageLoader = loader,
            colorFilter = if (label == "IMDb") androidx.compose.ui.graphics.ColorFilter.tint(Color.Black) else null, contentScale = ContentScale.Fit)
    }
}

@Composable
internal fun DetailsEpisodeSkeleton() {
    val colors = LocalFrameZooColors.current
    val shape = RoundedCornerShape(12.dp)
    Box(
        modifier = Modifier
            .width(235.dp)
            .height(265.dp)
            .clip(shape)
            .background(colors["background.secondary"].copy(alpha = 0.5f))
            .padding(10.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(140.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .skeletonShimmer()
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth(0.75f)
                    .height(16.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .skeletonShimmer()
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth(0.5f)
                    .height(12.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .skeletonShimmer()
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth(0.9f)
                    .height(12.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .skeletonShimmer()
            )
        }
    }
}

@Composable
private fun ImdbTrailerPlayer(url: String, muted: Boolean, paused: Boolean, modifier: Modifier = Modifier, onStatus: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    var player by remember(url) { mutableStateOf<android.media.MediaPlayer?>(null) }
    val view = remember(url) {
        android.widget.VideoView(context).apply {
            isFocusable = false
            setOnPreparedListener { media -> player = media; media.setVolume(if (muted) 0f else 1f, if (muted) 0f else 1f); start(); onStatus("playing") }
            setOnErrorListener { _, _, _ -> onStatus("error"); true }
            setVideoURI(Uri.parse(url))
        }
    }
    LaunchedEffect(muted, player) { player?.setVolume(if (muted) 0f else 1f, if (muted) 0f else 1f) }
    LaunchedEffect(paused, player) { if (player != null) { if (paused) view.pause() else view.start() } }
    DisposableEffect(view, lifecycle, paused) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            when (event) {
                androidx.lifecycle.Lifecycle.Event.ON_PAUSE -> view.pause()
                androidx.lifecycle.Lifecycle.Event.ON_RESUME -> if (player != null && !paused) view.start()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    DisposableEffect(view) { onDispose { view.stopPlayback(); player = null } }
    androidx.compose.ui.viewinterop.AndroidView(factory = { view }, modifier = modifier)
}
