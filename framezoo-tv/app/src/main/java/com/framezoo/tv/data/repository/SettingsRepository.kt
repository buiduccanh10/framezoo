package com.framezoo.tv.data.repository

import com.framezoo.tv.storage.SecureStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class SettingsRepository(private val store: SecureStore) {

    private val _theme = MutableStateFlow(store.theme)
    val theme: StateFlow<String> = _theme.asStateFlow()

    private val _language = MutableStateFlow(store.language)
    val language: StateFlow<String> = _language.asStateFlow()

    private val _customPrimary = MutableStateFlow(store.customPrimary)
    val customPrimary: StateFlow<String> = _customPrimary.asStateFlow()

    private val _customSecondary = MutableStateFlow(store.customSecondary)
    val customSecondary: StateFlow<String> = _customSecondary.asStateFlow()

    private val _customTertiary = MutableStateFlow(store.customTertiary)
    val customTertiary: StateFlow<String> = _customTertiary.asStateFlow()

    private val _subtitleFontSize = MutableStateFlow(store.subtitleFontSize)
    val subtitleFontSize: StateFlow<Int> = _subtitleFontSize.asStateFlow()

    private val _subtitleColor = MutableStateFlow(store.subtitleColor)
    val subtitleColor: StateFlow<String> = _subtitleColor.asStateFlow()

    private val _subtitleBackgroundOpacity = MutableStateFlow(store.subtitleBackgroundOpacity)
    val subtitleBackgroundOpacity: StateFlow<Int> = _subtitleBackgroundOpacity.asStateFlow()

    private val _torrentCacheSize = MutableStateFlow(store.torrentCacheSize)
    val torrentCacheSize: StateFlow<String> = _torrentCacheSize.asStateFlow()

    private val _trailerEnabled = MutableStateFlow(store.trailerEnabled)
    val trailerEnabled: StateFlow<Boolean> = _trailerEnabled.asStateFlow()

    private val _trailerMuted = MutableStateFlow(store.trailerMuted)
    val trailerMuted: StateFlow<Boolean> = _trailerMuted.asStateFlow()

    private val _backendUrl = MutableStateFlow(store.backendUrl)
    val backendUrl: StateFlow<String> = _backendUrl.asStateFlow()

    fun updateTheme(newTheme: String) {
        store.theme = newTheme
        _theme.value = newTheme
    }

    fun updateLanguage(newLang: String) {
        store.language = newLang
        _language.value = newLang
    }

    fun updateCustomPart(part: String, name: String) {
        when (part) {
            "primary" -> { store.customPrimary = name; _customPrimary.value = name }
            "secondary" -> { store.customSecondary = name; _customSecondary.value = name }
            "tertiary" -> { store.customTertiary = name; _customTertiary.value = name }
        }
    }

    fun updateSubtitleFontSize(size: Int) {
        val clamped = size.coerceIn(50, 200)
        store.subtitleFontSize = clamped
        _subtitleFontSize.value = clamped
    }

    fun updateSubtitleColor(color: String) {
        store.subtitleColor = color
        _subtitleColor.value = color
    }

    fun updateSubtitleBackgroundOpacity(opacity: Int) {
        val clamped = opacity.coerceIn(0, 100)
        store.subtitleBackgroundOpacity = clamped
        _subtitleBackgroundOpacity.value = clamped
    }

    fun updateTorrentCacheSize(size: String) {
        store.torrentCacheSize = size
        _torrentCacheSize.value = size
    }

    fun toggleTrailer() {
        val next = !store.trailerEnabled
        store.trailerEnabled = next
        _trailerEnabled.value = next
    }

    fun toggleTrailerAudio() {
        val next = !store.trailerMuted
        store.trailerMuted = next
        _trailerMuted.value = next
    }

    fun updateBackendUrl(url: String) {
        store.backendUrl = url
        _backendUrl.value = store.backendUrl
    }
}
