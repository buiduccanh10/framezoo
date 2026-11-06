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
import androidx.compose.ui.focus.FocusRequester
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
        scale = TvCardDefaults.scale(focusedScale = 1.02f),
        border = TvCardDefaults.border(focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = shape))) { content() }
}

private fun formattedDate(value: String): String = try {
    LocalDate.parse(value).format(DateTimeFormatter.ofPattern("dd/MM/yyyy"))
} catch (_: Exception) { value }

@Composable
internal fun DetailsScreen(state: FrameZooState, item: Media) {
    val colors = LocalFrameZooColors.current
    val context = LocalContext.current
    val firstAction = remember(item.id, item.type) { FocusRequester() }
    val seasonFocus = remember(item.id, item.type) { FocusRequester() }
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
        catch (_: ActivityNotFoundException) { state.error = "Không có ứng dụng mở liên kết" }
    }
    LaunchedEffect(showFavorites, favoriteIds, state.seasons) {
        if (showFavorites) {
            if (favoriteIds.isEmpty()) { showFavorites = false; favoriteEpisodes = emptyList() }
            else {
                favoritesLoading = true
                try {
                    favoriteEpisodes = coroutineScope { state.seasons.map { season -> async { state.backend.episodes(item.id, season) } }.awaitAll().flatten() }
                        .filter { it.id in favoriteIds }
                } catch (e: CancellationException) { throw e } catch (e: Exception) { state.error = e.message ?: "Không tải được tập yêu thích"; favoriteEpisodes = emptyList() }
                finally { favoritesLoading = false }
            }
        }
    }
    LaunchedEffect(copied) { if (copied) { delay(2500); copied = false } }
    LaunchedEffect(item.id, item.type) {
        firstAction.requestFocus()
        withFrameNanos { }
        listState.scrollToItem(0)
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
                catch (e: CancellationException) { throw e } catch (e: Exception) { collectionError = e.message ?: "Không tải được bộ sưu tập" }
            }
        }
    }
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .94f)), contentAlignment = Alignment.Center) {
      Box(Modifier.fillMaxWidth(.94f).fillMaxHeight(.94f).widthIn(max = 1200.dp).clip(RoundedCornerShape(22.dp)).background(colors["background.main"])) {
        LazyColumn(state = listState, contentPadding = PaddingValues(bottom = 32.dp)) {
            item {
                Box(Modifier.fillMaxWidth().height(340.dp).background(colors["background.secondary"])) {
                    AsyncImage(item.backdrop, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                    if (trailerEnabled && selectedTrailer == null && trailers.isNotEmpty()) TrailerBackground(trailers.first().key, trailerMuted, Modifier.fillMaxSize())
                    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = .12f), Color.Transparent, colors["background.main"]))))
                    if (!logoReady) Text(item.title, Modifier.align(Alignment.BottomStart).padding(start = 26.dp, bottom = 42.dp), color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.Bold)
                    if (logo != null) AsyncImage(logo, item.title, Modifier.align(Alignment.BottomStart).padding(start = 26.dp, bottom = 42.dp).widthIn(max = 330.dp).heightIn(max = 95.dp), contentScale = ContentScale.Fit, onSuccess = { logoReady = true }, onError = { logoReady = false })
                    if (trailers.isNotEmpty()) Row(Modifier.align(Alignment.BottomEnd).padding(end = 22.dp, bottom = 24.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        HeaderButton(if (trailerEnabled) R.drawable.desktop_image else R.drawable.desktop_video, if (trailerEnabled) "Hiện ảnh" else "Hiện trailer", trailerEnabled) { state.toggleTrailer() }
                        HeaderButton(if (trailerMuted) R.drawable.desktop_volume_x else R.drawable.desktop_volume, if (trailerMuted) "Bật tiếng trailer" else "Tắt tiếng trailer", !trailerMuted) { state.toggleTrailerAudio() }
                    }
                }
            }
            item {
                Column(Modifier.padding(horizontal = 26.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (item.type == "movie" && quality != null) Text(if (quality == "CAM") "Đang chiếu" else quality!!, Modifier.clip(RoundedCornerShape(5.dp)).background(colors["background.secondary"]).padding(horizontal = 8.dp, vertical = 4.dp), color = colors["type.emphasis"], fontSize = 13.sp)
                        if (item.rating > 0) {
                            Image(painterResource(R.drawable.desktop_tmdb), "TMDB", Modifier.width(28.dp).height(16.dp))
                            Text("%.1f".format(item.rating) + if (item.voteCount > 0) " (%,d)".format(item.voteCount) else "", color = colors["type.text"], fontSize = 14.sp)
                        }
                        ratings.imdbRating?.let { rating ->
                            RatingIcon("imdb.svg", "IMDb"); Text("%.1f".format(rating) + (ratings.imdbVotes?.let { " (%,d)".format(it) } ?: ""), color = colors["type.text"], fontSize = 14.sp)
                        }
                        ratings.tomatoScore?.let { score ->
                            RatingIcon(when (ratings.tomatoIcon) { "certified_fresh" -> "Certified_Fresh.svg"; "fresh" -> "Fresh.svg"; else -> "Rotten.svg" }, "Rotten Tomatoes"); Text("$score%", color = colors["type.text"], fontSize = 14.sp)
                        }
                        ratings.audienceScore?.let { score ->
                            RatingIcon(when (ratings.audienceIcon) { "upright" -> "Popcorn_Fresh.svg"; "spilled" -> "Popcorn_Rotten.svg"; else -> "Popcorn_Empty.svg" }, "Điểm khán giả"); Text("$score%", color = colors["type.text"], fontSize = 14.sp)
                        }
                        if (item.year.isNotBlank()) Text("·  ${item.year}", color = colors["type.secondary"], fontSize = 14.sp)
                        if (item.type == "show" && state.seasons.isNotEmpty()) Text("·  ${state.seasons.size} mùa", color = colors["type.secondary"], fontSize = 14.sp)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        val playLabel = if (item.type == "movie" && (item.releaseDate.isBlank() || runCatching { LocalDate.parse(item.releaseDate).isAfter(LocalDate.now()) }.getOrDefault(false))) "Chưa phát hành" else if (saved == null) "Phát" else if (item.type == "show" && saved.season != null && saved.episode != null) "Tiếp tục S${saved.season}:E${saved.episode}" else "Tiếp tục"
                        TvButton(playLabel, modifier = Modifier.focusRequester(firstAction), accent = true, icon = R.drawable.desktop_play) {
                            if (item.addonManifest != null) {
                                if (item.type == "movie") state.loadSources(item, null)
                                else state.episodes.firstOrNull()?.let { state.loadSources(item, it) } ?: run { state.error = "Không có tập phim" }
                            } else state.playFeatured(item)
                        }
                        if (item.id.isNotBlank() && item.id.all(Char::isDigit)) {
                            val bookmarked = state.bookmarks.any { it.id == item.id }
                            HeaderButton(if (bookmarked) R.drawable.desktop_bookmark_filled else R.drawable.desktop_bookmark, if (bookmarked) "Bỏ lưu" else "Lưu phim", bookmarked) { state.bookmark(item) }
                            HeaderButton(R.drawable.desktop_share, "Sao chép liên kết", false) {
                                val kind = if (item.type == "show") "tv" else "movie"
                                val link = "https://framezoo.top/discover?detail=tmdb-$kind-${item.id}-media"
                                (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(item.title, link))
                                copied = true
                            }
                            TvButton("Nhóm", trailingIcon = R.drawable.desktop_chevron_down) {
                                if (state.store.userId == null) state.openLogin() else {
                                    selectedGroups = state.bookmarkDetails.firstOrNull { it.media.id == item.id }?.groups.orEmpty()
                                    newGroup = ""; groupsOpen = true
                                }
                            }
                            if (copied) Text("Đã sao chép liên kết", color = colors["type.secondary"], fontSize = 13.sp)
                        }
                    }
                    if (state.busy) CircularProgressIndicator(Modifier.size(22.dp))
                    if (state.error.isNotBlank()) Text(state.error, color = colors["type.danger"], fontSize = 13.sp)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                        Column(Modifier.weight(2f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            if (item.description.isNotBlank()) Text(item.description, color = colors["type.text"], fontSize = 15.sp, lineHeight = 22.sp)
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                androidx.compose.foundation.layout.FlowRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    item.genres.forEach { genre -> Text(genre, Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = .2f)).padding(horizontal = 9.dp, vertical = 4.dp), color = colors["type.text"], fontSize = 12.sp) }
                                }
                                if (item.type == "movie" && item.addonManifest == null) {
                                    val watched = state.history.any { it.media.id == item.id && it.duration > 0 && it.position / it.duration > .9 }
                                    HeaderButton(if (watched) R.drawable.desktop_eye_slash else R.drawable.desktop_eye, if (watched) "Đánh dấu chưa xem" else "Đánh dấu đã xem", watched) { state.markMovieWatched(item, !watched) }
                                }
                            }
                            cast.firstOrNull { it.role == "Đạo diễn" }?.let { Text("Đạo diễn: ${it.name}", color = colors["type.secondary"], fontSize = 13.sp) }
                            val actors = cast.filter { it.role != "Đạo diễn" }.take(6).joinToString(", ") { it.name }
                            if (actors.isNotBlank()) Text("Diễn viên: $actors", color = colors["type.secondary"], fontSize = 13.sp)
                        }
                        Column(Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(colors["background.secondary"].copy(alpha = .5f)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                            if (item.runtime > 0) Text("Thời lượng: " + (if (item.runtime >= 60) "${item.runtime / 60} giờ " else "") + "${item.runtime % 60} phút", color = colors["type.text"], fontSize = 13.sp)
                            if (item.type == "movie" && item.runtime > 0) Text("Kết thúc lúc: ${LocalTime.now().plusMinutes(item.runtime.toLong()).format(DateTimeFormatter.ofPattern("HH:mm"))}", color = colors["type.secondary"], fontSize = 13.sp)
                            if (item.language.isNotBlank()) Text("Ngôn ngữ: ${item.language.uppercase()}", color = colors["type.text"], fontSize = 13.sp)
                            if (item.releaseDate.isNotBlank()) Text("Ngày phát hành: ${formattedDate(item.releaseDate)}", color = colors["type.text"], fontSize = 13.sp)
                            if (item.certification.isNotBlank()) Text("Phân loại: ${item.certification}", color = colors["type.text"], fontSize = 13.sp)
                            if (item.collectionId != null) TvButton(item.collectionName ?: "Bộ sưu tập", trailingIcon = R.drawable.desktop_chevron_right) { collectionOpen = true }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                provider?.let { name ->
                                    val key = detailProviderAsset(name)
                                    if (key.matches(Regex("[a-z0-9]+")) && remember(key) { runCatching { context.assets.open("platforms/$key.png").close(); true }.getOrDefault(false) })
                                        AsyncImage("file:///android_asset/platforms/$key.png", name, Modifier.size(32.dp).clip(RoundedCornerShape(6.dp)), contentScale = ContentScale.Fit)
                                }
                                if (item.id.isNotBlank() && item.id.all(Char::isDigit)) DetailsRatingButton("TMDB", null, Color(0xff0d253f), R.drawable.desktop_tmdb) { openUrl("https://www.themoviedb.org/${if (item.type == "show") "tv" else "movie"}/${item.id}") }
                                if (!item.imdbId.isNullOrBlank()) DetailsRatingButton("IMDb", "imdb.svg", Color(0xffeab308), null) { openUrl("https://www.imdb.com/title/${item.imdbId}") }
                                listOf(Triple("Rotten Tomatoes", ratings.tomatoUrl, when (ratings.tomatoIcon) { "certified_fresh" -> "Certified_Fresh.svg"; "fresh" -> "Fresh.svg"; else -> "Rotten.svg" }), Triple("Điểm khán giả", ratings.audienceUrl ?: ratings.tomatoUrl, when (ratings.audienceIcon) { "upright" -> "Popcorn_Fresh.svg"; "spilled" -> "Popcorn_Rotten.svg"; else -> "Popcorn_Empty.svg" })).forEach { (label, url, asset) ->
                                    if ((label != "Điểm khán giả" || ratings.audienceScore != null) && url != null && try { val uri = Uri.parse(url); uri.scheme == "https" && (uri.host == "rottentomatoes.com" || uri.host?.endsWith(".rottentomatoes.com") == true) } catch (_: Exception) { false }) DetailsRatingButton(label, asset, Color.Transparent, null) { openUrl(url) }
                                }
                            }
                        }
                    }
                }
            }
            if (item.type == "show" && state.seasons.isNotEmpty()) item {
                Column(Modifier.padding(start = 26.dp, end = 26.dp, top = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Tập phim", color = colors["type.emphasis"], fontSize = 21.sp, fontWeight = FontWeight.Bold)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (!showFavorites && eligibleEpisodes.isNotEmpty()) HeaderButton(R.drawable.desktop_eye, if (seasonWatched) "Đánh dấu cả mùa chưa xem" else "Đánh dấu cả mùa đã xem", seasonWatched) {
                                if (state.store.userId == null) state.openLogin() else confirmSeasonWatched = true
                            }
                            TvButton(if (showFavorites) "Yêu thích (${favoriteIds.size})" else "Mùa ${state.selectedSeason ?: state.seasons.first()}", modifier = Modifier.focusRequester(seasonFocus), trailingIcon = R.drawable.desktop_chevron_down) { seasonOpen = true }
                        }
                    }
                    val shownEpisodes = if (showFavorites) favoriteEpisodes else state.episodes
                    if (if (showFavorites) favoritesLoading else state.episodesLoading) Text("Đang tải tập phim...", color = colors["type.secondary"])
                    else if (shownEpisodes.isEmpty()) Text(if (showFavorites) "Chưa có tập yêu thích" else "Chưa có tập phim", color = colors["type.secondary"])
                    else LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(vertical = 5.dp)) {
                        items(shownEpisodes, key = { "${it.season}:${it.number}" }) { episode ->
                            val progress = state.progress.firstOrNull { it.media.id == item.id && it.season == episode.season && it.episode == episode.number }
                            val watched = (state.history + listOfNotNull(progress)).any { it.media.id == item.id && it.season == episode.season && it.episode == episode.number && it.duration > 0 && it.position / it.duration > .9 }
                            val favorite = state.bookmarkDetails.firstOrNull { it.media.id == item.id }?.favoriteEpisodes?.contains(episode.id) == true
                            DetailsEpisodeCard(episode, progress, seasonFocus, favorite, watched,
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
                                AsyncImage(person.image, person.name, Modifier.size(100.dp).clip(CircleShape), contentScale = ContentScale.Crop)
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
                    Text("Trailer", color = colors["type.emphasis"], fontSize = 21.sp, fontWeight = FontWeight.SemiBold)
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
            if (similar.isNotEmpty()) item { Box(Modifier.padding(start = 26.dp, top = 28.dp, end = 26.dp)) { MediaGrid("Nội dung tương tự", similar, state::openDetails, bookmarks = state.bookmarks.map { it.id }.toSet(), onBookmark = state::bookmark, qualityLoader = state.backend::releaseQuality) } }
        }
        Box(Modifier.align(Alignment.TopEnd).padding(14.dp)) { HeaderButton(R.drawable.desktop_close, "Đóng chi tiết", false) { state.back() } }
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
                Text("Tập ${episode.number}: ${episode.title}", color = colors["type.emphasis"], fontSize = 20.sp, fontWeight = FontWeight.Bold)
                LazyColumn(Modifier.heightIn(max = 300.dp)) { item { Text(episode.overview, color = colors["type.text"], fontSize = 15.sp, lineHeight = 22.sp) } }
                TvButton("Thu gọn") { expandedEpisode = null }
            }
        }
    }
    if (confirmSeasonWatched) Dialog(onDismissRequest = { confirmSeasonWatched = false }) {
        Column(Modifier.widthIn(min = 320.dp, max = 500.dp).clip(RoundedCornerShape(14.dp)).background(colors["background.main"]).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(if (seasonWatched) "Đánh dấu các tập đã phát sóng là chưa xem?" else "Đánh dấu các tập đã phát sóng là đã xem?", color = colors["type.emphasis"], fontSize = 18.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TvButton("Xác nhận", accent = true) {
                    val targets = eligibleEpisodes.filter { episode ->
                        (state.history + state.progress).any { it.media.id == item.id && it.season == episode.season && it.episode == episode.number && it.duration > 0 && it.position / it.duration > .9 } == seasonWatched
                    }
                    confirmSeasonWatched = false; state.markSeasonWatched(item, targets, !seasonWatched)
                }
                TvButton("Hủy") { confirmSeasonWatched = false }
            }
        }
    }
    if (groupsOpen) Dialog(onDismissRequest = { groupsOpen = false }) {
        Column(Modifier.widthIn(min = 300.dp, max = 440.dp).heightIn(max = 500.dp).clip(RoundedCornerShape(14.dp)).background(colors["background.main"]).padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Nhóm đã lưu", color = colors["type.emphasis"], fontSize = 20.sp, fontWeight = FontWeight.Bold)
            LazyColumn(Modifier.heightIn(max = 190.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                items((state.bookmarkGroups + selectedGroups).distinct()) { group ->
                    TvButton(group, selected = group in selectedGroups, navigation = true) {
                        selectedGroups = if (group in selectedGroups) selectedGroups - group else selectedGroups + group
                    }
                }
            }
            OutlinedTextField(newGroup, { newGroup = it }, singleLine = true, label = { Text("Nhóm mới") }, colors = tvFieldColors())
            TvButton("Thêm nhóm") { newGroup.trim().takeIf { it.isNotEmpty() }?.let { selectedGroups = (selectedGroups + it).distinct(); newGroup = "" } }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TvButton("Lưu", accent = true) { groupsOpen = false; state.updateBookmarkGroups(item, selectedGroups) }
                TvButton("Hủy") { groupsOpen = false }
            }
        }
    }
    if (seasonOpen) Dialog(onDismissRequest = { seasonOpen = false }) {
        Column(Modifier.widthIn(min = 230.dp, max = 360.dp).heightIn(max = 480.dp).clip(RoundedCornerShape(14.dp)).background(colors["background.main"]).padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Chọn mùa", color = colors["type.emphasis"], fontSize = 20.sp, fontWeight = FontWeight.Bold)
            LazyColumn(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                if (favoriteIds.isNotEmpty() && item.addonManifest == null) item { TvButton("Yêu thích (${favoriteIds.size})", selected = showFavorites, navigation = true) { seasonOpen = false; showFavorites = true } }
                items(state.seasons) { season ->
                    TvButton("Mùa $season", selected = !showFavorites && season == state.selectedSeason, navigation = true) { seasonOpen = false; showFavorites = false; state.chooseSeason(item, season) }
                }
            }
        }
    }
    if (collectionOpen) Dialog(onDismissRequest = { collectionOpen = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxWidth(.9f).widthIn(max = 1100.dp).clip(RoundedCornerShape(18.dp)).background(colors["background.main"]).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Column { Text(item.collectionName ?: "Bộ sưu tập", color = colors["type.emphasis"], fontSize = 25.sp, fontWeight = FontWeight.Bold); collection?.let { Text("${it.parts.size} phim", color = colors["type.secondary"]) } }
                HeaderButton(R.drawable.desktop_close, "Đóng bộ sưu tập", false) { collectionOpen = false }
            }
            collection?.overview?.takeIf { it.isNotBlank() }?.let { Text(it, color = colors["type.text"], fontSize = 14.sp) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!collection?.parts.isNullOrEmpty()) TvButton("Lưu cả bộ", icon = R.drawable.desktop_bookmark) {
                    if (state.store.userId == null) { collectionOpen = false; state.openLogin() }
                    else state.bookmarkCollection(collection!!.parts, item.collectionName ?: "Bộ sưu tập")
                }
                TvButton("Ngày phát hành", selected = !collectionSort, navigation = true) { collectionSort = false }
                TvButton("Đánh giá", selected = collectionSort, navigation = true) { collectionSort = true }
            }
            if (state.busy) CircularProgressIndicator(Modifier.size(22.dp))
            if (state.error.isNotBlank()) Text(state.error, color = colors["type.danger"], fontSize = 13.sp)
            when {
                collectionError.isNotBlank() -> Text(collectionError, color = colors["type.danger"])
                collection == null -> Text("Đang tải...", color = colors["type.secondary"])
                collection!!.parts.isEmpty() -> Text("Chưa có nội dung", color = colors["type.secondary"])
                else -> MediaGrid("", if (collectionSort) collection!!.parts.sortedByDescending { it.rating } else collection!!.parts, { collectionOpen = false; state.openDetails(it) }, bookmarks = state.bookmarks.map { it.id }.toSet(), onBookmark = state::bookmark, qualityLoader = state.backend::releaseQuality)
            }
        }
    }
}

@Composable
private fun DetailsEpisodeCard(episode: Episode, progress: com.framezoo.tv.model.LibraryItem?, seasonFocus: FocusRequester,
    favorite: Boolean, watched: Boolean, onFavorite: () -> Unit, onWatched: () -> Unit, onOverview: () -> Unit, onClick: () -> Unit) {
    val colors = LocalFrameZooColors.current
    val unaired = episode.id.isNotBlank() && !detailEpisodeAired(episode.airDate)
    val cardFocus = remember { FocusRequester() }
    val favoriteFocus = remember { FocusRequester() }
    var active by remember { mutableStateOf(false) }
    var actionFocused by remember { mutableStateOf(false) }
    val hasActions = !unaired && episode.id.isNotBlank() && episode.seasonId.isNotBlank()
    val hasToolbar = hasActions || episode.overview.isNotBlank()
    Box(Modifier.width(225.dp).zIndex(if (active || actionFocused) 1f else 0f)) {
      DetailsCard(onClick, Modifier.width(225.dp).alpha(if (unaired) .6f else 1f).focusRequester(cardFocus)
          .focusProperties { up = if (hasToolbar) favoriteFocus else seasonFocus }.onFocusChanged { active = it.hasFocus }) {
        Column(Modifier.fillMaxWidth().height(255.dp)) {
            Box(Modifier.fillMaxWidth().height(135.dp).background(colors["background.secondary"])) {
                if (!episode.still.isNullOrBlank()) AsyncImage(episode.still, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                else Image(painterResource(R.drawable.desktop_placeholder), null, Modifier.align(Alignment.Center).size(48.dp))
                Text("Tập ${episode.number}" + if (unaired && episode.airDate.isBlank()) "  ·  Chưa rõ lịch chiếu" else if (unaired) "  ·  Sắp chiếu" else "", Modifier.align(Alignment.TopStart).padding(8.dp).clip(RoundedCornerShape(4.dp)).background(Color.Black.copy(alpha = .7f)).padding(horizontal = 7.dp, vertical = 3.dp), color = Color.White, fontSize = 12.sp)
            }
            Column(Modifier.weight(1f).padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(episode.title, color = colors["type.emphasis"], fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 14.sp)
                Text(if (episode.airDate.isBlank()) "Chưa có ngày phát hành" else formattedDate(episode.airDate), color = colors["type.secondary"], fontSize = 12.sp)
                if (episode.overview.isNotBlank()) Text(episode.overview, color = colors["type.text"], maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 13.sp, lineHeight = 17.sp)
            }
            if (progress != null && progress.duration > 0) Box(Modifier.fillMaxWidth().height(4.dp).background(colors["mediaCard.barColor"])) {
                Box(Modifier.fillMaxWidth((progress.position / progress.duration).toFloat().coerceIn(0f, 1f)).fillMaxHeight().background(colors["mediaCard.barFillColor"]))
            }
        }
      }
      if (hasToolbar) Row(Modifier.align(Alignment.TopEnd).padding(7.dp).onFocusChanged { actionFocused = it.hasFocus }.alpha(if (active || actionFocused) 1f else 0f)) {
          val shape = CircleShape
          val buttonColors = TvIconButtonDefaults.colors(containerColor = Color.Black.copy(alpha = .65f), focusedContainerColor = colors["pill.activeBackground"])
          val border = TvIconButtonDefaults.border(focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = shape))
          if (episode.overview.isNotBlank()) TvIconButton(onClick = onOverview, modifier = Modifier.size(36.dp).focusRequester(favoriteFocus)
              .focusProperties { up = seasonFocus; down = cardFocus; canFocus = active || actionFocused }
              .semantics { contentDescription = "Xem mô tả tập ${episode.number}" }, shape = TvIconButtonDefaults.shape(shape), colors = buttonColors, border = border, scale = TvIconButtonDefaults.scale(focusedScale = 1f)) {
              Icon(painterResource(R.drawable.desktop_chevron_down), null, Modifier.size(17.dp), tint = Color.White)
          }
          if (hasActions) TvIconButton(onClick = onFavorite, modifier = Modifier.size(36.dp).then(if (episode.overview.isBlank()) Modifier.focusRequester(favoriteFocus) else Modifier)
              .focusProperties { up = seasonFocus; down = cardFocus; canFocus = active || actionFocused }
              .semantics { contentDescription = if (favorite) "Bỏ yêu thích tập ${episode.number}" else "Yêu thích tập ${episode.number}" },
              shape = TvIconButtonDefaults.shape(shape), colors = buttonColors, border = border, scale = TvIconButtonDefaults.scale(focusedScale = 1f)) {
              Icon(painterResource(if (favorite) R.drawable.desktop_bookmark_filled else R.drawable.desktop_bookmark), null, Modifier.size(15.dp), tint = Color.White)
          }
          if (hasActions) TvIconButton(onClick = onWatched, modifier = Modifier.size(36.dp)
              .focusProperties { up = seasonFocus; down = cardFocus; canFocus = active || actionFocused }
              .semantics { contentDescription = if (watched) "Đánh dấu chưa xem tập ${episode.number}" else "Đánh dấu đã xem tập ${episode.number}" },
              shape = TvIconButtonDefaults.shape(shape), colors = buttonColors, border = border, scale = TvIconButtonDefaults.scale(focusedScale = 1f)) {
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
    var muted by remember(key) { mutableStateOf(false) }
    var paused by remember(key) { mutableStateOf(false) }
    var status by remember(key) { mutableStateOf("loading") }
    val context = LocalContext.current
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (isImdb) ImdbTrailerPlayer(key, muted, paused, Modifier.fillMaxSize()) { status = it } else TrailerBackground(key, muted, Modifier.fillMaxSize(), paused) { status = it }
        if (status != "playing") Text(if (status == "error") "Không thể phát trailer" else "Đang tải trailer...", color = Color.White, modifier = Modifier.align(Alignment.Center))
        Row(Modifier.align(Alignment.BottomStart).padding(20.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            TvButton("Đóng", modifier = Modifier.focusRequester(focus), icon = R.drawable.desktop_close) { onClose() }
            TvButton(if (paused) "Tiếp tục" else "Tạm dừng") { paused = !paused }
            TvButton(if (muted) "Bật tiếng" else "Tắt tiếng", icon = if (muted) R.drawable.desktop_volume_x else R.drawable.desktop_volume) { muted = !muted }
            if (status == "error" && !isImdb) TvButton("Mở YouTube") {
                try { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/watch?v=$key"))) }
                catch (_: ActivityNotFoundException) { onError("Không có ứng dụng mở liên kết") }
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
