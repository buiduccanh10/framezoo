package com.framezoo.tv.data.repository

import com.framezoo.tv.api.Addons
import com.framezoo.tv.model.Addon
import com.framezoo.tv.model.AddonCatalog
import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.Media
import com.framezoo.tv.model.Stream
import com.framezoo.tv.model.Subtitle
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class AddonsRepository(
    private val addons: Addons
) {
    private val mutex = Mutex()

    private val _installedAddons = MutableStateFlow<List<Addon>>(emptyList())
    val installedAddons: StateFlow<List<Addon>> = _installedAddons.asStateFlow()

    private val _addonCatalog = MutableStateFlow<List<AddonCatalog>>(emptyList())
    val addonCatalog: StateFlow<List<AddonCatalog>> = _addonCatalog.asStateFlow()

    suspend fun load() = mutex.withLock {
        _installedAddons.value = addons.list()
        _addonCatalog.value = addons.catalog()
    }

    suspend fun install(manifestUrl: String) = mutex.withLock {
        addons.install(manifestUrl)
        _installedAddons.value = addons.list()
        _addonCatalog.value = addons.catalog()
    }

    suspend fun remove(manifestUrl: String) = mutex.withLock {
        addons.remove(manifestUrl)
        _installedAddons.value = addons.list()
        _addonCatalog.value = addons.catalog()
    }

    suspend fun toggle(manifestUrl: String) = mutex.withLock {
        addons.toggleEnabled(manifestUrl)
        _installedAddons.value = addons.list()
        _addonCatalog.value = addons.catalog()
    }

    suspend fun resolveStreams(media: Media, episode: Episode?): List<Stream> {
        return addons.streams(media, episode)
    }

    suspend fun resolveSubtitles(media: Media, episode: Episode?): List<Subtitle> {
        return addons.subtitles(media, episode)
    }
}
