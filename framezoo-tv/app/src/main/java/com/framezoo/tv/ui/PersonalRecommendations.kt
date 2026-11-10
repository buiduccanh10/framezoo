package com.framezoo.tv.ui

import com.framezoo.tv.model.LibraryItem
import com.framezoo.tv.model.Media

internal fun personalSources(type: String, history: List<LibraryItem>, progress: List<LibraryItem>, bookmarks: List<Media>): List<Media> {
    fun valid(item: Media) = item.type == type && item.id.isNotEmpty() && item.id.all(Char::isDigit)
    return (history.sortedByDescending { it.watchedAt }.map { it.media }.filter(::valid).distinctBy { it.id }.take(5) +
        progress.map { it.media }.filter(::valid).take(2) + bookmarks.filter(::valid).take(1)).distinctBy { it.id }
}
