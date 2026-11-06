package com.framezoo.tv.data.repository

import com.framezoo.tv.api.Backend
import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.LibraryItem
import com.framezoo.tv.model.Media
import com.framezoo.tv.storage.SecureStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class HistoryRepository(
    private val backend: Backend,
    private val store: SecureStore
) {
    private val mutex = Mutex()

    private val _history = MutableStateFlow<List<LibraryItem>>(emptyList())
    val history: StateFlow<List<LibraryItem>> = _history.asStateFlow()

    private val _progress = MutableStateFlow<List<LibraryItem>>(emptyList())
    val progress: StateFlow<List<LibraryItem>> = _progress.asStateFlow()

    private var recentResume: Triple<String, Episode?, Double>? = null

    suspend fun refresh() = mutex.withLock {
        if (store.userId == null) return
        try {
            val h = backend.watchHistory()
            val p = backend.watchProgress()
            _history.value = h
            _progress.value = p
        } catch (_: Exception) {}
    }

    suspend fun recordProgress(media: Media, episode: Episode?, position: Double, duration: Double) = mutex.withLock {
        recentResume = Triple(media.id, episode, position)
        if (store.userId != null) {
            try {
                backend.progress(media, position, duration, episode)
                _progress.value = backend.watchProgress()
            } catch (_: Exception) {}
        }
    }

    suspend fun markWatched(media: Media, episode: Episode?, watched: Boolean) = mutex.withLock {
        if (watched) {
            val item = LibraryItem(media = media, season = episode?.season, episode = episode?.number, episodeId = episode?.id.orEmpty())
            _history.value = listOf(item) + _history.value.filter { it.media.id != media.id || it.episodeId != episode?.id.orEmpty() }
        } else {
            _history.value = _history.value.filter { it.media.id != media.id || (episode != null && it.episodeId != episode.id) }
        }
        if (store.userId != null) {
            try {
                if (episode != null) {
                    val existing = _history.value.firstOrNull { it.media.id == media.id && it.episodeId == episode.id }
                    backend.markEpisodeWatched(media, episode, watched, existing)
                } else {
                    backend.markMovieWatched(media, watched)
                }
            } catch (_: Exception) {}
        }
    }

    suspend fun deleteItem(item: LibraryItem) = mutex.withLock {
        _history.value = _history.value.filter { it != item }
        _progress.value = _progress.value.filter { it != item }
        if (store.userId != null) {
            try { backend.removeHistory(item.media.id) } catch (_: Exception) {}
        }
    }

    suspend fun clearAll() = mutex.withLock {
        val current = _history.value
        _history.value = emptyList()
        _progress.value = emptyList()
        if (store.userId != null) {
            current.forEach { item ->
                try { backend.removeHistory(item.media.id) } catch (_: Exception) {}
            }
        }
    }

    fun getResume(media: Media, episode: Episode?): Double {
        if (recentResume?.first == media.id && recentResume?.second?.id == episode?.id) {
            return recentResume?.third ?: 0.0
        }
        val match = _progress.value.firstOrNull { it.media.id == media.id && (episode == null || it.episodeId == episode.id) }
        return match?.position ?: 0.0
    }
}
