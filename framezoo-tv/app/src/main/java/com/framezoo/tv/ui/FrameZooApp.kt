package com.framezoo.tv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.onPreviewKeyEvent
import android.view.KeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape
import com.framezoo.tv.MainActivity
import coil.compose.AsyncImage
import kotlinx.coroutines.launch

@Composable
internal fun tvFieldColors(): TextFieldColors {
    val colors = LocalFrameZooColors.current
    return OutlinedTextFieldDefaults.colors(
        focusedTextColor = colors["search.text"], unfocusedTextColor = colors["search.text"],
        focusedContainerColor = colors["search.focused"], unfocusedContainerColor = colors["search.background"],
        focusedBorderColor = colors["type.logo"], unfocusedBorderColor = colors["authentication.border"],
        focusedLabelColor = colors["type.logo"], unfocusedLabelColor = colors["search.placeholder"],
        cursorColor = colors["type.logo"],
    )
}

@Composable
internal fun FrameZooApp() {
    val context = LocalContext.current
    val activity = context as MainActivity
    var focusedTextAction by remember { mutableStateOf<FocusRequester?>(null) }
    val discoverAction = remember { FocusRequester() }
    val discoverListState = rememberLazyListState()
    val allListsState = rememberLazyListState()
    val moreGridState = rememberLazyGridState()
    val searchGridState = rememberLazyGridState()
    val searchAction = remember { FocusRequester() }
    val addonAction = remember { FocusRequester() }
    val backendAction = remember { FocusRequester() }
    val passwordField = remember { FocusRequester() }
    val loginAction = remember { FocusRequester() }
    fun downTo(target: FocusRequester) = Modifier
        .onFocusChanged { if (it.hasFocus) focusedTextAction = target else if (focusedTextAction === target) focusedTextAction = null }
        .focusProperties { down = target }
    DisposableEffect(activity) {
        activity.moveDownFromText = {
            focusedTextAction?.let { it.requestFocus(); true } ?: false
        }
        onDispose { activity.moveDownFromText = null }
    }
    val scope = rememberCoroutineScope()
    val state = remember(context) { FrameZooState(context, scope) }
    var renderedMoreGeneration by remember { mutableStateOf(0) }
    LaunchedEffect(state) { state.initialize() }
    LaunchedEffect(state.moreGeneration) {
        if (renderedMoreGeneration != state.moreGeneration) { moreGridState.scrollToItem(0); renderedMoreGeneration = state.moreGeneration }
    }
    BackHandler(state.page != "discover") { state.back() }

    with(state) {
        FrameZooTheme(theme, customPrimary, customSecondary, customTertiary) {
            val colors = LocalFrameZooColors.current
            Surface(color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground) {
                Box(Modifier.fillMaxSize()) {
                Column(Modifier.fillMaxSize().then(if (page in listOf("discover", "details", "player", "trailer")) Modifier else Modifier.padding(horizontal = 48.dp, vertical = 32.dp))) {
                    if (page !in listOf("player", "discover", "details", "trailer")) {
                        DiscoverHeader(state)
                        Spacer(Modifier.height(28.dp))
                    }
                    if (busy && page != "details") CircularProgressIndicator(Modifier.size(26.dp))
                    if (error.isNotBlank() && page != "details") Text(error, color = colors["type.danger"], modifier = Modifier.padding(vertical = 10.dp))
                    when (page) {
                        "discover" -> DiscoverScreen(state, discoverAction, discoverListState)
                        "discover-more" -> DiscoverMoreScreen(state, moreGridState)
                        "discover-lists" -> DiscoverListsScreen(state, allListsState)
                        "search" -> SearchScreen(state, searchGridState, searchAction, downTo(searchAction))
                        "details" -> selected?.let { item -> DetailsScreen(state, item) }
                        "trailer" -> TrailerScreen(state)
                        "feedback" -> FeedbackScreen(state)
                        "sources" -> LazyColumn(verticalArrangement = Arrangement.spacedBy(15.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 30.dp)) {
                            item { Text("Nguồn phát · ${selected?.title.orEmpty()}", style = MaterialTheme.typography.headlineLarge) }
                            item { TvButton("Quay lại", icon = com.framezoo.tv.R.drawable.desktop_chevron_left) { back() } }
                            if (sources.isEmpty()) item { Text("Không có nguồn. Cài addon hỗ trợ stream trong mục Addon.") }
                            items(sources) { source -> TvButton(source.name + if (source.infoHash != null || source.url.startsWith("magnet:")) " · Torrent" else " · HTTP") {
                                chooseSource(source)
                            } }
                        }
                        "player" -> selected?.let { item -> playing?.let { stream ->

                            PlayerScreen(player, item, episode, stream, subtitles, backend, resume(item, episode),
                                onStopped = { pos -> stopped(item, episode, pos) }) { page = "sources" }
                        } }
                        "library" -> MediaGrid("Thư viện", bookmarks.distinctBy { it.id }, ::openDetails, bookmarks = bookmarks.map { it.id }.toSet(), onBookmark = ::bookmark, qualityLoader = backend::releaseQuality)
                        "history" -> MediaGrid("Lịch sử xem", history.map { it.media }.distinctBy { "${it.type}:${it.id}" }, ::openDetails,
                            history.filter { it.duration > 0 }.associate { it.media.id to (it.position / it.duration).toFloat().coerceIn(0f, 1f) })
                        "addons" -> Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            Text("Addon", style = MaterialTheme.typography.headlineLarge)
                            OutlinedTextField(addonUrl, { addonUrl = it }, label = { Text("URL manifest") }, singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                                keyboardActions = KeyboardActions(onDone = { addonAction.requestFocus() }),
                                colors = tvFieldColors(), shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.fillMaxWidth(0.7f).then(downTo(addonAction)))
                            TvButton("Cài addon", modifier = Modifier.focusRequester(addonAction), primary = true) { installAddon() }
                            installed.forEach { addon -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                                Text("${addon.name} · ${addon.resources.joinToString()}", modifier = Modifier.weight(1f))
                                TvButton("Gỡ") { removeAddon(addon) }
                            } }
                        }
                        "settings" -> LazyColumn(verticalArrangement = Arrangement.spacedBy(18.dp)) {
                            item { Text("Cài đặt", style = MaterialTheme.typography.headlineLarge) }
                            item { OutlinedTextField(backendUrl, { backendUrl = it }, label = { Text("Backend URL") }, singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                                keyboardActions = KeyboardActions(onDone = { backendAction.requestFocus() }),
                                colors = tvFieldColors(), shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.fillMaxWidth(0.7f).then(downTo(backendAction))) }
                            item { TvButton("Lưu backend", modifier = Modifier.focusRequester(backendAction), primary = true) { saveBackend() } }
                            item { Text("Giao diện", fontSize = 27.sp, fontWeight = FontWeight.Bold) }
                            items(themeNames.chunked(5)) { names ->
                                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    names.forEach { name -> TvThemePreview(name, selected = theme.equals(name, true)) { updateTheme(name) } }
                                }
                            }
                            if (theme == "custom") {
                                listOf(
                                    Triple("primary", "Màu nhấn", customPrimary),
                                    Triple("secondary", "Chữ và điều khiển", customSecondary),
                                    Triple("tertiary", "Màu nền", customTertiary),
                                ).forEach { (part, label, value) ->
                                    item { Text(label, fontSize = 21.sp, fontWeight = FontWeight.Bold) }
                                    item { LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                        items(themeNames.filter { it != "custom" }) { name ->
                                            TvThemePreview(name, selected = value == name) { updateCustomPart(part, name) }
                                        }
                                    } }
                                }
                            }
                            item { Text("Bộ đệm torrent: RAM tối đa 128 MiB; dừng phát sẽ giải phóng.", color = colors["type.secondary"]) }
                        }
                        "login" -> Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
                            Text(if (store.userId == null) "Đăng nhập" else "Tài khoản", style = MaterialTheme.typography.headlineLarge)
                            if (store.userId != null) {
                                Text("Đã đăng nhập: ${store.userId}")
                                TvButton("Đăng xuất") { logout() }
                            } else {
                                OutlinedTextField(loginName, { loginName = it }, label = { Text("Tên đăng nhập hoặc email") }, singleLine = true,
                                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                    keyboardActions = KeyboardActions(onNext = { passwordField.requestFocus() }),
                                    colors = tvFieldColors(), shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier.fillMaxWidth(0.6f).then(downTo(passwordField)))
                                OutlinedTextField(loginPassword, { loginPassword = it }, label = { Text("Mật khẩu") },
                                    singleLine = true, visualTransformation = PasswordVisualTransformation(),
                                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                                    keyboardActions = KeyboardActions(onDone = { loginAction.requestFocus() }),
                                    colors = tvFieldColors(), shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier.fillMaxWidth(0.6f).focusRequester(passwordField).then(downTo(loginAction)))
                                TvButton("Đăng nhập", modifier = Modifier.focusRequester(loginAction), primary = true) { login() }
                            }
                        }
                    }
                }
                if (page == "discover") DiscoverHeader(state, Modifier.align(Alignment.TopCenter).padding(horizontal = 24.dp, vertical = 20.dp)
                    .onPreviewKeyEvent { event ->
                        if (event.nativeKeyEvent.action == KeyEvent.ACTION_DOWN && event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_UP &&
                            (discoverListState.firstVisibleItemIndex > 0 || discoverListState.firstVisibleItemScrollOffset > 0)) {
                            scope.launch { discoverListState.animateScrollToItem(0) }
                            true
                        } else false
                    }
                    .then(if (discover.isNotEmpty() && discoverListState.firstVisibleItemIndex == 0) Modifier.focusProperties { down = discoverAction } else Modifier))
                }
            }
        }
    }
}
