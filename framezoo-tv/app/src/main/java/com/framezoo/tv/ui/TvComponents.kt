package com.framezoo.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.framezoo.tv.model.Media

@Composable
internal fun TvButton(
    label: String,
    selected: Boolean = false,
    modifier: Modifier = Modifier,
    primary: Boolean = false,
    navigation: Boolean = false,
    accent: Boolean = false,
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
    Box(
        modifier
            .onFocusChanged { focused = it.isFocused }
            .clip(shape)
            .background(background)
            .then(if (focused) Modifier.border(BorderStroke(2.dp, colors["type.logo"]), shape) else Modifier)
            .clickable(onClick = onClick)
            .padding(horizontal = if (navigation) 14.dp else 22.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = foreground, fontSize = 16.sp, fontWeight = FontWeight.Bold,
            maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
internal fun MediaGrid(title: String, items: List<Media>, onOpen: (Media) -> Unit, progress: Map<String, Float> = emptyMap()) {
    val colors = LocalFrameZooColors.current
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        if (title.isNotBlank()) Text(title, fontSize = 27.sp, fontWeight = FontWeight.Bold, color = colors["type.emphasis"])
        if (items.isEmpty()) Text("Chưa có nội dung", color = colors["type.secondary"])
        LazyRow(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            items(items) { item ->
                var focused by remember { mutableStateOf(false) }
                Column(
                    Modifier.width(174.dp)
                        .onFocusChanged { focused = it.isFocused }
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (focused) colors["mediaCard.hoverBackground"] else colors["background.main"])
                        .then(if (focused) Modifier.border(BorderStroke(2.dp, colors["mediaCard.hoverAccent"]), RoundedCornerShape(12.dp)) else Modifier)
                        .clickable { onOpen(item) }
                        .padding(7.dp),
                ) {
                    Box(Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(10.dp))
                        .background(colors["mediaCard.hoverBackground"]), contentAlignment = Alignment.Center) {
                        Text("FRAMEZOO", color = colors["type.logo"], fontSize = 13.sp, fontWeight = FontWeight.Black)
                        if (!item.poster.isNullOrBlank()) AsyncImage(item.poster, item.title, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                    }
                    progress[item.id]?.let { value ->
                        Box(Modifier.fillMaxWidth().height(3.dp).background(colors["utils.divider"])) {
                            Box(Modifier.fillMaxWidth(value).height(3.dp).background(colors["type.logo"]))
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    Text(item.title, maxLines = 2, minLines = 2, overflow = TextOverflow.Ellipsis,
                        color = colors["type.emphasis"], fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Spacer(Modifier.height(4.dp))
                    Text("${if (item.type == "show") "Series" else "Phim"}${item.year.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""}",
                        color = colors["type.secondary"], fontSize = 13.sp)
                }
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
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(10.dp)
    Column(Modifier.width(174.dp).onFocusChanged { focused = it.isFocused }
        .clip(shape).background(preview["background.main"])
        .border(BorderStroke(if (focused || selected) 2.dp else 1.dp,
            if (focused || selected) current["type.logo"] else current["utils.divider"]), shape)
        .clickable(onClick = onClick).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Box(Modifier.width(23.dp).height(23.dp).clip(RoundedCornerShape(50)).background(preview["themePreview.primary"]))
            Box(Modifier.width(23.dp).height(23.dp).clip(RoundedCornerShape(50)).background(preview["themePreview.secondary"]))
        }
        Text(LocalFrameZooThemeLabels.current[name] ?: name, color = preview["type.emphasis"], fontWeight = FontWeight.Bold,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
