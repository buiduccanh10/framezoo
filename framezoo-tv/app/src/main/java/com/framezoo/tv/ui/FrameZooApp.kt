package com.framezoo.tv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.framezoo.tv.MainActivity
import coil.compose.AsyncImage

@Composable
internal fun FrameZooApp() {
    val context = LocalContext.current
    val activity = context as MainActivity
    var focusedTextAction by remember { mutableStateOf<FocusRequester?>(null) }
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
    LaunchedEffect(state) { state.initialize() }
    BackHandler(state.page != "discover") { state.back() }

    with(state) {
        FrameZooTheme(theme) {
            Surface(color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground) {
                Column(Modifier.fillMaxSize().padding(horizontal = 48.dp, vertical = 32.dp)) {
                    if (page != "player") {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(26.dp)) {
                            Text("FRAMEZOO", fontSize = 25.sp, fontWeight = FontWeight.Black, color = MaterialTheme.colorScheme.primary)
                            listOf("discover" to "Khám phá", "search" to "Tìm kiếm", "library" to "Thư viện", "addons" to "Addon", "settings" to "Cài đặt").forEach { (destination, label) ->
                                TvButton(label, selected = page == destination) {
                                    when (destination) {
                                        "library" -> openLibrary()
                                        "addons" -> openAddons()
                                        else -> page = destination
                                    }
                                }
                            }
                            Spacer(Modifier.weight(1f))
                            TvButton(if (store.userId == null) "Đăng nhập" else "Tài khoản") { page = "login" }
                        }
                        Spacer(Modifier.height(28.dp))
                    }
                    if (busy) CircularProgressIndicator(Modifier.size(26.dp))
                    if (error.isNotBlank()) Text(error, color = Color(0xFFFF8D83), modifier = Modifier.padding(vertical = 10.dp))
                    when (page) {
                        "discover" -> LazyColumn(verticalArrangement = Arrangement.spacedBy(25.dp)) {
                            item { MediaGrid("Đang thịnh hành", discover, ::openDetails) }
                            if (addonCatalog.isNotEmpty()) item { MediaGrid("Từ addon", addonCatalog, ::openDetails) }
                        }
                        "search" -> Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
                            Text("Tìm kiếm", style = MaterialTheme.typography.headlineLarge)
                            OutlinedTextField(query, { query = it }, label = { Text("Tên phim hoặc series") }, singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                                keyboardActions = KeyboardActions(onSearch = { searchAction.requestFocus(); search() }),
                                modifier = Modifier.fillMaxWidth(0.6f).then(downTo(searchAction)))
                            TvButton("Tìm", modifier = Modifier.focusRequester(searchAction)) { search() }
                            MediaGrid("Kết quả", results, ::openDetails)
                        }
                        "details" -> selected?.let { item ->
                            LazyColumn(verticalArrangement = Arrangement.spacedBy(18.dp)) {
                                item { Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                                    AsyncImage(item.poster, null, Modifier.width(190.dp).height(275.dp))
                                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                                        Text(item.title, fontSize = 35.sp, fontWeight = FontWeight.Bold)
                                        Text("${item.year} · ${if (item.type == "show") "Series" else "Phim"}")
                                        Text(item.description, maxLines = 5, overflow = TextOverflow.Ellipsis)
                                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                            if (item.type == "movie") TvButton("Chọn nguồn") { loadSources(item, null) }
                                            TvButton("Lưu vào thư viện") { bookmark(item) }
                                        }
                                    }
                                } }
                                if (item.type == "show") {
                                    item { Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { seasons.forEach { season ->
                                        TvButton("Mùa $season") { chooseSeason(item, season) }
                                    } } }
                                    items(episodes) { ep -> TvButton("Tập ${ep.number}: ${ep.title}") { loadSources(item, ep) } }
                                }
                            }
                        }
                        "sources" -> Column(verticalArrangement = Arrangement.spacedBy(15.dp)) {
                            Text("Nguồn phát · ${selected?.title.orEmpty()}", style = MaterialTheme.typography.headlineLarge)
                            if (sources.isEmpty()) Text("Không có nguồn. Cài addon hỗ trợ stream trong mục Addon.")
                            sources.forEach { source -> TvButton(source.name + if (source.infoHash != null || source.url.startsWith("magnet:")) " · Torrent" else " · HTTP") {
                                chooseSource(source)
                            } }
                        }
                        "player" -> selected?.let { item -> playing?.let { stream ->

                            PlayerScreen(player, item, episode, stream, subtitles, backend, resume(item, episode),
                                onStopped = { pos -> stopped(item, episode, pos) }) { page = "sources" }
                        } }
                        "library" -> MediaGrid("Thư viện và tiếp tục xem", library.map { it.media }.distinctBy { it.id }, ::openDetails)
                        "addons" -> Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            Text("Addon", style = MaterialTheme.typography.headlineLarge)
                            OutlinedTextField(addonUrl, { addonUrl = it }, label = { Text("URL manifest") }, singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                                keyboardActions = KeyboardActions(onDone = { addonAction.requestFocus() }),
                                modifier = Modifier.fillMaxWidth(0.7f).then(downTo(addonAction)))
                            TvButton("Cài addon", modifier = Modifier.focusRequester(addonAction)) { installAddon() }
                            installed.forEach { addon -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                                Text("${addon.name} · ${addon.resources.joinToString()}", modifier = Modifier.weight(1f))
                                TvButton("Gỡ") { removeAddon(addon) }
                            } }
                        }
                        "settings" -> Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
                            Text("Cài đặt", style = MaterialTheme.typography.headlineLarge)
                            OutlinedTextField(backendUrl, { backendUrl = it }, label = { Text("Backend URL") }, singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                                keyboardActions = KeyboardActions(onDone = { backendAction.requestFocus() }),
                                modifier = Modifier.fillMaxWidth(0.7f).then(downTo(backendAction)))
                            TvButton("Lưu backend", modifier = Modifier.focusRequester(backendAction)) { saveBackend() }
                            Text("Giao diện")
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { listOf("Ember", "Dark", "Light").forEach { name ->
                                TvButton(name, selected = theme == name) { updateTheme(name) }
                            } }
                            Text("Bộ đệm torrent: RAM tối đa 128 MiB; dừng phát sẽ giải phóng.")
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
                                    modifier = Modifier.fillMaxWidth(0.6f).then(downTo(passwordField)))
                                OutlinedTextField(loginPassword, { loginPassword = it }, label = { Text("Mật khẩu") },
                                    singleLine = true, visualTransformation = PasswordVisualTransformation(),
                                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                                    keyboardActions = KeyboardActions(onDone = { loginAction.requestFocus() }),
                                    modifier = Modifier.fillMaxWidth(0.6f).focusRequester(passwordField).then(downTo(loginAction)))
                                TvButton("Đăng nhập", modifier = Modifier.focusRequester(loginAction)) { login() }
                            }
                        }
                    }
                }
            }
        }
    }
}
