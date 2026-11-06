package com.framezoo.tv

import android.app.Application
import com.framezoo.tv.di.AppContainer

class FrameZooApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
