package com.framezoo.tv.di

import android.content.Context
import com.framezoo.tv.api.Addons
import com.framezoo.tv.api.Backend
import com.framezoo.tv.data.repository.*
import com.framezoo.tv.player.PlayerController
import com.framezoo.tv.storage.SecureStore
import com.framezoo.tv.ui.I18n

import androidx.compose.runtime.compositionLocalOf

val LocalAppContainer = compositionLocalOf<AppContainer> {
    error("AppContainer not provided")
}

class AppContainer(val context: Context) {
    val store by lazy { SecureStore(context) }
    val backend by lazy { Backend(store) }
    val addons by lazy { Addons(context, backend, store) }
    val player by lazy { PlayerController(context) }
    val i18n by lazy { I18n(context, store.language) }

    val settingsRepository by lazy { SettingsRepository(store) }
    val authRepository by lazy { AuthRepository(store, backend) }
    val bookmarksRepository by lazy { BookmarksRepository(backend, store) }
    val historyRepository by lazy { HistoryRepository(backend, store) }
    val addonsRepository by lazy { AddonsRepository(addons) }
    val mediaRepository by lazy { MediaRepository(context, backend) }
    val feedbackRepository by lazy { FeedbackRepository(backend) }
}
