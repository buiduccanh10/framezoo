package com.framezoo.tv.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.zIndex
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import androidx.tv.material3.Border as TvBorder
import androidx.tv.material3.Button as MaterialTvButton
import androidx.tv.material3.ButtonDefaults as TvButtonDefaults
import androidx.tv.material3.Card as TvCard
import androidx.tv.material3.CardDefaults as TvCardDefaults
import androidx.tv.material3.IconButton as TvIconButton
import androidx.tv.material3.IconButtonDefaults as TvIconButtonDefaults
import com.framezoo.tv.R
import com.framezoo.tv.api.showCinemaBadge
import com.framezoo.tv.model.Media

@Composable
internal fun TvButton(
    label: String,
    selected: Boolean = false,
    modifier: Modifier = Modifier,
    primary: Boolean = false,
    navigation: Boolean = false,
    accent: Boolean = false,
    icon: Int? = null,
    trailingIcon: Int? = null,
    onClick: () -> Unit,
) {
    val colors = LocalFrameZooColors.current
    var focused by remember { mutableStateOf(false) }
    val active = focused || selected
    val shape = if (navigation) RoundedCornerShape(50) else RoundedCornerShape(8.dp)
    val background = when {
        navigation && active -> colors["pill.activeBackground"]
        navigation -> colors["pill.background"]
        accent -> colors["buttons.purple"]
        primary -> colors["buttons.primary"]
        else -> colors["buttons.secondary"]
    }
    val foreground = when {
        navigation && active -> colors["type.logo"]
        navigation -> colors["type.text"]
        accent -> Color.White
        primary -> colors["buttons.primaryText"]
        else -> colors["type.emphasis"]
    }
    val animatedBackground by animateColorAsState(background, tween(300), label = "button background")
    MaterialTvButton(
        onClick = onClick,
        modifier = modifier.onFocusChanged { focused = it.isFocused },
        shape = TvButtonDefaults.shape(shape),
        colors = TvButtonDefaults.colors(containerColor = animatedBackground, contentColor = foreground,
            focusedContainerColor = animatedBackground, focusedContentColor = foreground),
        scale = TvButtonDefaults.scale(focusedScale = 1f),
        border = TvButtonDefaults.border(focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = shape)),
        contentPadding = PaddingValues(horizontal = if (navigation) 14.dp else 22.dp, vertical = 12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            icon?.let { Icon(painterResource(it), contentDescription = null, modifier = Modifier.width(18.dp).height(18.dp), tint = foreground) }
            Text(label, color = foreground, fontSize = 16.sp, fontWeight = if (navigation) FontWeight.Medium else FontWeight.Bold,
                maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis)
            trailingIcon?.let { Icon(painterResource(it), contentDescription = null, modifier = Modifier.width(16.dp).height(16.dp), tint = foreground) }
        }
    }
}

@Composable
internal fun MediaGrid(title: String, items: List<Media>, onOpen: (Media) -> Unit, progress: Map<String, Float> = emptyMap(),
    bookmarks: Set<String> = emptySet(), onBookmark: ((Media) -> Unit)? = null, qualityLoader: (suspend (Media) -> String?)? = null) {
    val colors = LocalFrameZooColors.current
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        if (title.isNotBlank()) Text(title, fontSize = 27.sp, fontWeight = FontWeight.Bold, color = colors["type.emphasis"])
        if (items.isEmpty()) Text(t("home.search.empty.default"), color = colors["type.secondary"])
        LazyRow(horizontalArrangement = Arrangement.spacedBy(18.dp), contentPadding = PaddingValues(horizontal = 4.dp, vertical = 6.dp)) {
            items(items) { item ->
                TvMediaCard(item, onOpen, progress[item.id], item.id in bookmarks, onBookmark, qualityLoader)
            }
        }
    }
}

@Composable
internal fun TvMediaCard(item: Media, onOpen: (Media) -> Unit, progress: Float? = null,
    bookmarked: Boolean = false, onBookmark: ((Media) -> Unit)? = null, qualityLoader: (suspend (Media) -> String?)? = null,
    modifier: Modifier = Modifier) {
    val colors = LocalFrameZooColors.current
    var focused by remember { mutableStateOf(false) }
    var bookmarkFocused by remember { mutableStateOf(false) }
    val cardFocus = remember { FocusRequester() }
    val bookmarkFocus = remember { FocusRequester() }
    val hasBookmarkAction = onBookmark != null && item.id.isNotEmpty() && item.id.all(Char::isDigit)
    var quality by remember(item.id, item.type, item.releaseQuality) { mutableStateOf(item.releaseQuality) }
    LaunchedEffect(item.id, item.type, qualityLoader) {
        if (quality == null && qualityLoader != null) quality = try { qualityLoader(item) }
            catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { null }
    }
    val active = focused || bookmarkFocused
    val cardScale by animateFloatAsState(if (active) 1.03f else 1f, tween(200), label = "card scale")
    val cardBackground by animateColorAsState(if (active) colors["mediaCard.hoverBackground"] else colors["background.main"], tween(300), label = "card background")
    val shape = RoundedCornerShape(12.dp)
    Box(Modifier.wrapContentWidth(Alignment.Start).width(174.dp).zIndex(if (active) 1f else 0f).graphicsLayer { scaleX = cardScale; scaleY = cardScale }) {
    TvCard(
        onClick = { onOpen(item) },
        modifier = modifier.focusRequester(cardFocus).then(if (hasBookmarkAction) Modifier.focusProperties { up = bookmarkFocus } else Modifier)
            .width(174.dp).onFocusChanged { focused = it.hasFocus },
        shape = TvCardDefaults.shape(shape),
        colors = TvCardDefaults.colors(containerColor = cardBackground, focusedContainerColor = cardBackground),
        scale = TvCardDefaults.scale(focusedScale = 1f),
        border = TvCardDefaults.border(focusedBorder = TvBorder(BorderStroke(2.dp, colors["mediaCard.hoverAccent"]), shape = shape)),
    ) {
      Column(Modifier.padding(7.dp)) {
        Box(Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(10.dp))
            .background(colors["mediaCard.hoverBackground"]), contentAlignment = Alignment.Center) {
            androidx.compose.foundation.Image(painterResource(R.drawable.desktop_placeholder), null, Modifier.width(72.dp))
            if (!item.poster.isNullOrBlank()) AsyncImage(item.poster, item.title, Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop)
            progress?.let { value ->
                Box(Modifier.fillMaxWidth().height(48.dp).align(Alignment.BottomCenter)
                    .background(Brush.verticalGradient(listOf(Color.Transparent, colors["mediaCard.shadow"]))), contentAlignment = Alignment.BottomCenter) {
                    Box(Modifier.fillMaxWidth().padding(12.dp).height(4.dp).clip(RoundedCornerShape(50)).background(colors["mediaCard.barColor"])) {
                        Box(Modifier.fillMaxWidth(value.coerceIn(0f, 1f)).height(4.dp).background(colors["mediaCard.barFillColor"]))
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        Text(item.title, maxLines = 2, minLines = 2, overflow = TextOverflow.Ellipsis,
            color = colors["type.emphasis"], fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Spacer(Modifier.height(4.dp))
        Text("${if (item.type == "show") t("media.types.show") else t("media.types.movie")}${item.year.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""}",
            color = colors["type.secondary"], fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
      }
    }
    if (showCinemaBadge(item.type, quality)) {
        Text(t("media.inCinema"), modifier = Modifier.zIndex(1f).align(Alignment.TopEnd).padding(12.dp)
            .clip(RoundedCornerShape(6.dp)).background(Color.DarkGray.copy(alpha = .8f)).padding(horizontal = 8.dp, vertical = 5.dp),
            color = Color(0xffffd54f), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
    }
    if (hasBookmarkAction) {
        val buttonShape = RoundedCornerShape(50)
        val bookmarkDescription = t("home.bookmarks.sectionTitle")
        TvIconButton(onClick = { onBookmark(item) }, modifier = Modifier.zIndex(1f).align(Alignment.TopStart).padding(8.dp).size(42.dp)
            .alpha(if (active) 1f else 0f)
            .focusRequester(bookmarkFocus).onFocusChanged { bookmarkFocused = it.isFocused }
            .focusProperties { down = cardFocus; canFocus = focused || bookmarkFocused }
            .semantics { contentDescription = bookmarkDescription },
            shape = TvIconButtonDefaults.shape(buttonShape),
            colors = TvIconButtonDefaults.colors(containerColor = colors["pill.background"].copy(alpha = .75f), focusedContainerColor = colors["pill.background"].copy(alpha = .9f)),
            scale = TvIconButtonDefaults.scale(focusedScale = 1f),
            border = TvIconButtonDefaults.border(focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = buttonShape))) {
            Icon(painterResource(if (bookmarked) R.drawable.desktop_bookmark_filled else R.drawable.desktop_bookmark), contentDescription = null,
                modifier = Modifier.size(14.dp), tint = colors["type.emphasis"].copy(alpha = if (bookmarkFocused) 1f else .75f))
        }
    }
    }
}

internal val themeNames = listOf(
    "default", "classic", "blue", "teal", "red", "gray", "green", "forest", "autumn", "frost",
    "mocha", "pink", "noir", "ember", "acid", "spark", "cobalt", "grape", "spiderman",
    "wolverine", "hulk", "popsicle", "christmas", "custom",
)

@Composable
internal fun TvThemePreview(name: String, selected: Boolean, onClick: () -> Unit) {
    val current = LocalFrameZooColors.current
    val preview = LocalFrameZooPalettes.current.getValue(name)
    val shape = RoundedCornerShape(10.dp)
    val selectedBorder = TvBorder(BorderStroke(if (selected) 2.dp else 1.dp,
        if (selected) current["type.logo"] else current["utils.divider"]), shape = shape)
    TvCard(onClick = onClick, modifier = Modifier.width(174.dp), shape = TvCardDefaults.shape(shape),
        colors = TvCardDefaults.colors(containerColor = preview["background.main"], focusedContainerColor = preview["background.main"]),
        scale = TvCardDefaults.scale(focusedScale = 1f),
        border = TvCardDefaults.border(border = selectedBorder,
            focusedBorder = TvBorder(BorderStroke(2.dp, current["type.logo"]), shape = shape))) {
      Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Box(Modifier.width(23.dp).height(23.dp).clip(RoundedCornerShape(50)).background(preview["themePreview.primary"]))
            Box(Modifier.width(23.dp).height(23.dp).clip(RoundedCornerShape(50)).background(preview["themePreview.secondary"]))
        }
        Text(LocalFrameZooThemeLabels.current[name] ?: name, color = preview["type.emphasis"], fontWeight = FontWeight.Bold,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
    }
}
