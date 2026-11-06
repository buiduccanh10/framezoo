package com.framezoo.tv.data.repository

import com.framezoo.tv.api.Backend
import com.framezoo.tv.model.BookmarkDetails
import com.framezoo.tv.model.Media
import com.framezoo.tv.storage.SecureStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class BookmarksRepository(
    private val backend: Backend,
    private val store: SecureStore
) {
    private val mutex = Mutex()

    private val _bookmarks = MutableStateFlow<List<Media>>(emptyList())
    val bookmarks: StateFlow<List<Media>> = _bookmarks.asStateFlow()

    private val _bookmarkDetails = MutableStateFlow<List<BookmarkDetails>>(emptyList())
    val bookmarkDetails: StateFlow<List<BookmarkDetails>> = _bookmarkDetails.asStateFlow()

    private val _bookmarkGroups = MutableStateFlow<List<String>>(emptyList())
    val bookmarkGroups: StateFlow<List<String>> = _bookmarkGroups.asStateFlow()

    fun isBookmarked(id: String): Boolean = _bookmarks.value.any { it.id == id }

    suspend fun refresh() = mutex.withLock {
        if (store.userId == null) return
        try {
            val details: List<BookmarkDetails> = backend.bookmarkDetails()
            _bookmarkDetails.value = details
            _bookmarks.value = details.map { it.media }
            _bookmarkGroups.value = details.flatMap { it.groups }.distinct().sorted()
        } catch (_: Exception) {}
    }

    suspend fun toggleBookmark(media: Media): Boolean = mutex.withLock {
        val exists = _bookmarks.value.any { it.id == media.id }
        if (exists) {
            _bookmarks.value = _bookmarks.value.filter { it.id != media.id }
            _bookmarkDetails.value = _bookmarkDetails.value.filter { it.media.id != media.id }
            if (store.userId != null) {
                try { backend.bookmark(media, remove = true) } catch (_: Exception) {}
            }
            false
        } else {
            val entry = BookmarkDetails(media, emptyList(), emptyList())
            _bookmarks.value = listOf(media) + _bookmarks.value
            _bookmarkDetails.value = listOf(entry) + _bookmarkDetails.value
            if (store.userId != null) {
                try { backend.bookmark(media, remove = false) } catch (_: Exception) {}
            }
            true
        }
    }

    suspend fun removeBookmark(mediaId: String) = mutex.withLock {
        val media = _bookmarks.value.firstOrNull { it.id == mediaId }
        _bookmarks.value = _bookmarks.value.filter { it.id != mediaId }
        _bookmarkDetails.value = _bookmarkDetails.value.filter { it.media.id != mediaId }
        if (store.userId != null && media != null) {
            try { backend.bookmark(media, remove = true) } catch (_: Exception) {}
        }
    }

    suspend fun addGroup(media: Media, group: String) = mutex.withLock {
        val trimmed = group.trim()
        if (trimmed.isBlank()) return
        val current = _bookmarkDetails.value.firstOrNull { it.media.id == media.id }
        val updatedGroups = ((current?.groups ?: emptyList()) + trimmed).distinct()
        val updatedDetails = BookmarkDetails(media, updatedGroups, current?.favoriteEpisodes ?: emptyList())
        _bookmarkDetails.value = _bookmarkDetails.value.filter { it.media.id != media.id } + updatedDetails
        _bookmarkGroups.value = (_bookmarkGroups.value + trimmed).distinct().sorted()
        if (store.userId != null) {
            try { backend.saveBookmarkDetails(media, updatedGroups, current?.favoriteEpisodes ?: emptyList()) } catch (_: Exception) {}
        }
    }

    suspend fun toggleEpisodeFavorite(media: Media, episodeId: String) = mutex.withLock {
        val current = _bookmarkDetails.value.firstOrNull { it.media.id == media.id } ?: BookmarkDetails(media, emptyList(), emptyList())
        val favs = if (episodeId in current.favoriteEpisodes) current.favoriteEpisodes - episodeId else current.favoriteEpisodes + episodeId
        val updated = BookmarkDetails(media, current.groups, favs)
        _bookmarkDetails.value = _bookmarkDetails.value.filter { it.media.id != media.id } + updated
        if (store.userId != null) {
            try { backend.saveBookmarkDetails(media, current.groups, favs) } catch (_: Exception) {}
        }
    }
}
