package com.framezoo.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import androidx.compose.foundation.Image
import com.framezoo.tv.R
import com.framezoo.tv.model.DiscoverOption
import com.framezoo.tv.model.Media
import kotlinx.coroutines.delay
import java.time.Year

@Composable
internal fun DiscoverHeader(state: FrameZooState, modifier: Modifier = Modifier) {
    val colors = LocalFrameZooColors.current
    var expanded by remember { mutableStateOf(false) }
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.clip(RoundedCornerShape(50)).background(colors["pill.background"]).clickable { state.page = "discover" }
            .padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Image(painterResource(R.drawable.framezoo_logo), "FrameZoo", Modifier.size(30.dp).clip(RoundedCornerShape(7.dp)))
            Spacer(Modifier.width(9.dp))
            Text("FrameZoo", color = colors["type.emphasis"], fontWeight = FontWeight.Black, fontSize = 20.sp)
        }
        HeaderButton(if (expanded) "×" else "☰", "Menu", false) { expanded = !expanded }
        if (expanded) {
            listOf(Triple("⌕", "Tìm kiếm", "search"), Triple("▣", "Thư viện", "library"),
                Triple("◇", "Addon", "addons"), Triple("⚙", "Cài đặt", "settings")).forEach { (icon, label, destination) ->
                HeaderButton(icon, label, state.page == destination) {
                    when (destination) { "library" -> state.openLibrary(); "addons" -> state.openAddons(); else -> state.page = destination }
                }
            }
        }
        Spacer(Modifier.weight(1f))
        TvButton(if (state.store.userId == null) "Đăng nhập" else "Tài khoản", selected = state.page == "login", navigation = true) { state.page = "login" }
    }
}

@Composable
private fun HeaderButton(icon: String, label: String, selected: Boolean, onClick: () -> Unit) {
    val colors = LocalFrameZooColors.current
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(50)
    Box(Modifier.size(46.dp).onFocusChanged { focused = it.isFocused }.clip(shape)
        .background(if (selected || focused) colors["pill.activeBackground"] else colors["pill.background"])
        .then(if (focused) Modifier.border(BorderStroke(2.dp, colors["type.logo"]), shape) else Modifier)
        .semantics { contentDescription = label }.clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Text(icon, color = if (selected) colors["type.logo"] else colors["type.emphasis"], fontSize = 23.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
internal fun DiscoverScreen(state: FrameZooState) {
    val colors = LocalFrameZooColors.current
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val heroHeight = maxHeight - 16.dp
        LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(26.dp), contentPadding = PaddingValues(bottom = 48.dp)) {
            item {
                if (state.discover.isNotEmpty()) FeaturedCarousel(state.discover.take(15), heroHeight,
                    onLogo = state.backend::logo, onOpen = state::openDetails, onPlay = { if (it.type == "movie") state.loadSources(it, null) else state.openDetails(it) })
                else Box(Modifier.fillMaxWidth().height(heroHeight).background(colors["background.secondary"]), contentAlignment = Alignment.Center) {
                    Text(if (state.error.isNotBlank()) state.error else "Đang tải nội dung...", color = colors["type.text"])
                }
            }
            val watching = state.library.filter { it.duration > 0 && it.position > 0 }
            if (watching.isNotEmpty()) item { Box(Modifier.padding(horizontal = 38.dp)) {
                MediaGrid("Đang xem", watching.map { it.media }, state::openDetails, watching.associate { it.media.id to (it.position / it.duration).toFloat().coerceIn(0f, 1f) })
            } }
            item { Column(Modifier.padding(horizontal = 38.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    LazyRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        items(listOf(DiscoverOption("all", "Tất cả"), DiscoverOption("tv", "Phim truyền hình"), DiscoverOption("movie", "Phim điện ảnh")) +
                            state.genres.map { DiscoverOption("genre:${it.id}", it.name) }) { option ->
                            if (option.id.startsWith("genre:")) TvButton(option.name, selected = state.filter.category == option.id, navigation = true) { state.updateFilter(state.filter.copy(category = option.id)) }
                            else CategoryTab(option.name, state.filter.category == option.id) { state.updateFilter(state.filter.copy(category = option.id)) }
                        }
                    }
                    FilterMenu("Quốc gia", state.filter.country, state.countries) { state.updateFilter(state.filter.copy(country = it)) }
                    FilterMenu("Năm", state.filter.year, (Year.now().value downTo 1950).map { DiscoverOption(it.toString(), it.toString()) }) { state.updateFilter(state.filter.copy(year = it)) }
                }
            } }
            if (state.discoverError.isNotBlank()) item { Row(Modifier.padding(horizontal = 38.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(state.discoverError, color = colors["type.danger"]); TvButton("Thử lại") { state.refreshDiscover() }
            } }
            if (state.discoverLoading) item { Text("Đang tải nội dung...", Modifier.padding(horizontal = 38.dp), color = colors["type.secondary"]) }
            item { Row(Modifier.padding(horizontal = 38.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Xu hướng", color = colors["type.emphasis"], fontSize = 27.sp, fontWeight = FontWeight.Bold)
                TvButton("Hôm nay", selected = state.filter.window == "day", navigation = true) { state.updateFilter(state.filter.copy(window = "day")) }
                TvButton("Tuần này", selected = state.filter.window == "week", navigation = true) { state.updateFilter(state.filter.copy(window = "week")) }
            } }
            listOf("trending" to "", "popular" to "Phổ biến nhất", "netflix" to "Netflix", "top" to "Đánh giá cao").forEach { (key, title) ->
                state.sections[key]?.let { media -> item { Box(Modifier.padding(horizontal = 38.dp)) { MediaGrid(title, media, state::openDetails) } } }
            }
            if (state.addonCatalog.isNotEmpty()) item { Box(Modifier.padding(horizontal = 38.dp)) { MediaGrid("Từ addon", state.addonCatalog, state::openDetails) } }
        }
    }
}

@Composable
private fun CategoryTab(label: String, selected: Boolean, onClick: () -> Unit) {
    val colors = LocalFrameZooColors.current
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(8.dp)
    Box(Modifier.onFocusChanged { focused = it.isFocused }.clip(shape)
        .then(if (focused) Modifier.border(BorderStroke(2.dp, colors["type.logo"]), shape) else Modifier)
        .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 12.dp)) {
        Text(label, color = if (selected) colors["type.logo"] else colors["type.secondary"], fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

@Composable
private fun FilterMenu(label: String, selected: String, options: List<DiscoverOption>, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        TvButton((options.firstOrNull { it.id == selected }?.name ?: label) + " ▾", navigation = true) { expanded = true }
        DropdownMenu(expanded, { expanded = false }, Modifier.heightIn(max = 350.dp).background(LocalFrameZooColors.current["pill.background"])) {
            DropdownMenuItem(text = { Text("Tất cả $label", color = LocalFrameZooColors.current["type.text"]) }, onClick = { onSelect(""); expanded = false })
            options.forEach { option -> DropdownMenuItem(text = { Text(option.name, color = LocalFrameZooColors.current["type.text"]) }, onClick = { onSelect(option.id); expanded = false }) }
        }
    }
}

@Composable
private fun FeaturedCarousel(items: List<Media>, height: androidx.compose.ui.unit.Dp, onLogo: suspend (Media) -> String?, onOpen: (Media) -> Unit, onPlay: (Media) -> Unit) {
    val colors = LocalFrameZooColors.current
    var index by remember(items) { mutableIntStateOf(0) }
    LaunchedEffect(items, index) { delay(8000); index = (index + 1) % items.size }
    val item = items[index]
    var logo by remember(item.id, item.type) { mutableStateOf<String?>(null) }
    LaunchedEffect(item.id, item.type) {
        try { logo = onLogo(item) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { logo = null }
    }
    Box(Modifier.fillMaxWidth().height(height).padding(8.dp).clip(RoundedCornerShape(18.dp)).background(colors["background.secondary"])) {
        if (!item.backdrop.isNullOrBlank()) AsyncImage(item.backdrop, item.title, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = .24f), Color.Transparent, Color.Black.copy(alpha = .95f)))))
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(listOf(Color.Black.copy(alpha = .65f), Color.Transparent))))
        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth(.58f).padding(start = 40.dp, bottom = 60.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (logo != null) AsyncImage(logo, item.title, Modifier.widthIn(max = 350.dp).heightIn(max = 100.dp), contentScale = ContentScale.Fit)
            else Text(item.title, color = Color.White, fontSize = 40.sp, fontWeight = FontWeight.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(item.rating.takeIf { it > 0 }?.let { "★ %.1f".format(it) }, item.year.takeIf { it.isNotBlank() }, if (item.type == "show") "Phim truyền hình" else "Phim điện ảnh").joinToString("  ·  "), color = Color.White, fontSize = 16.sp)
            if (item.description.isNotBlank()) Text(item.description, color = Color.White.copy(alpha = .9f), maxLines = 3, overflow = TextOverflow.Ellipsis, fontSize = 16.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TvButton("▶  Phát", accent = true) { onPlay(item) }
                TvButton("ⓘ  Thông tin thêm") { onOpen(item) }
            }
        }
        Box(Modifier.align(Alignment.CenterStart).padding(start = 12.dp)) {
            HeaderButton("‹", "Phim trước", false) { index = (index - 1 + items.size) % items.size }
        }
        Box(Modifier.align(Alignment.CenterEnd).padding(end = 12.dp)) {
            HeaderButton("›", "Phim tiếp theo", false) { index = (index + 1) % items.size }
        }
        Row(Modifier.align(Alignment.BottomCenter).padding(bottom = 18.dp), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            items.indices.forEach { dot ->
                Box(Modifier.size(if (dot == index) 9.dp else 7.dp).clip(RoundedCornerShape(50))
                    .background(if (dot == index) Color.White else Color.White.copy(alpha = .45f)))
            }
        }
    }
}
