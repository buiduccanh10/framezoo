package com.framezoo.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.framezoo.tv.model.Media

@Composable
internal fun TvButton(label: String, selected: Boolean = false, modifier: Modifier = Modifier, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val active = focused || selected
    Card(shape = RoundedCornerShape(9.dp), border = BorderStroke(if (active) 2.dp else 1.dp, if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline),
        colors = CardDefaults.cardColors(containerColor = if (active) MaterialTheme.colorScheme.primary.copy(alpha = 0.18f) else MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface)) {
        Box(Modifier.then(modifier).onFocusChanged { focused = it.isFocused }.clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 11.dp)) {
            Text(label, fontSize = 17.sp, fontWeight = if (active) FontWeight.Bold else FontWeight.Medium)
        }
    }
}

@Composable
internal fun MediaGrid(title: String, items: List<Media>, onOpen: (Media) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Text(title, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        if (items.isEmpty()) Text("Chưa có nội dung")
        LazyRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            items(items) { item ->
                var focused by remember { mutableStateOf(false) }
                Column(Modifier.width(160.dp).onFocusChanged { focused = it.isFocused }.clickable { onOpen(item) }) {
                    Card(border = if (focused) BorderStroke(3.dp, MaterialTheme.colorScheme.primary) else null,
                        shape = RoundedCornerShape(10.dp)) {
                        AsyncImage(item.poster, item.title, Modifier.width(160.dp).height(230.dp))
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(item.title, maxLines = 2, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                    Text(item.year, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

