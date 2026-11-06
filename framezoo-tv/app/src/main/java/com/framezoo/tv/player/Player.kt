package com.framezoo.tv.player

import com.framezoo.tv.model.Stream
import com.framezoo.tv.model.Subtitle

import android.content.Context
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.os.Build
import android.util.Log
import java.io.File
import java.nio.file.Files
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

object NativePlayer {
    init { System.loadLibrary("framezoo_native") }
    external fun create(emulator: Boolean, fontsDir: String, fontFamily: String): Long
    external fun destroy(handle: Long)
    external fun cancel(handle: Long)
    external fun attachSurface(handle: Long, surface: Surface)
    external fun surfaceSize(handle: Long, width: Int, height: Int)
    external fun detachSurface(handle: Long)
    external fun playUrl(handle: Long, url: String, headers: Array<String>): String?
    external fun playTorrent(handle: Long, magnet: String, fileIdx: Int): String?
    external fun waitLoaded(handle: Long, timeoutMs: Int): Boolean
    external fun command(handle: Long, args: Array<String>): Int
    external fun propertyDouble(handle: Long, name: String): Double
    external fun propertyString(handle: Long, name: String): String?
}

class PlayerController(private val context: Context) {
    private val lock = Any()
    private var handle = 0L
    private var opening = 0L
    private var generation = 0
    @Volatile private var surface: Surface? = null
    private var surfaceWidth = 0
    private var surfaceHeight = 0

    val surfaceCallback = object : SurfaceHolder.Callback {
        override fun surfaceCreated(holder: SurfaceHolder) {
            synchronized(lock) {
                surface = holder.surface
                val current = if (handle != 0L) handle else opening
                if (current != 0L) {
                    NativePlayer.attachSurface(current, holder.surface)
                    if (surfaceWidth > 0) NativePlayer.surfaceSize(current, surfaceWidth, surfaceHeight)
                }
            }
        }
        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            synchronized(lock) {
                surfaceWidth = width
                surfaceHeight = height
                val current = if (handle != 0L) handle else opening
                if (current != 0L) NativePlayer.surfaceSize(current, width, height)
            }
        }
        override fun surfaceDestroyed(holder: SurfaceHolder) {
            synchronized(lock) {
                val current = if (handle != 0L) handle else opening
                if (current != 0L) NativePlayer.detachSurface(current)
                surface = null
                surfaceWidth = 0
                surfaceHeight = 0
            }
        }
    }

    fun bind(view: SurfaceView) { view.holder.addCallback(surfaceCallback) }

    suspend fun play(stream: Stream, subtitles: List<Subtitle>) {
        stop()
        val ticket = synchronized(lock) { generation }
        withContext(Dispatchers.IO) {
        withTimeout(10_000) {
            while (synchronized(lock) { surface?.isValid != true || surfaceWidth <= 0 || surfaceHeight <= 0 }) delay(50)
        }
        val fontsDir = File(context.filesDir, "fonts").apply { mkdirs() }
        val systemFont = listOf("Roboto-Regular.ttf" to "Roboto", "NotoSans-Regular.ttf" to "Noto Sans", "DroidSans.ttf" to "Droid Sans")
            .firstOrNull { (file, _) -> Files.isReadable(File("/system/fonts", file).toPath()) }
        if (systemFont != null) {
            val fallback = File(fontsDir, systemFont.first).toPath()
            if (!Files.isRegularFile(fallback)) runCatching { Files.copy(File("/system/fonts", systemFont.first).toPath(), fallback) }
                .onFailure { error -> Log.w("FrameZooTV", "Không tạo được font phụ đề", error) }
        }
        val local = NativePlayer.create(Build.PRODUCT.startsWith("sdk") || Build.HARDWARE == "ranchu" || Build.FINGERPRINT.contains("generic"), fontsDir.absolutePath, systemFont?.second ?: "sans-serif")
        check(local != 0L) { "Không khởi tạo được libmpv" }
        try {
            val active = synchronized(lock) {
                if (ticket != generation) false else {
                    opening = local
                    surface?.let {
                        NativePlayer.attachSurface(local, it)
                        if (surfaceWidth > 0) NativePlayer.surfaceSize(local, surfaceWidth, surfaceHeight)
                    }
                    true
                }
            }
            if (!active) return@withContext
            val error = if (stream.url.startsWith("magnet:"))
                NativePlayer.playTorrent(local, stream.url, stream.fileIdx ?: -1)
            else NativePlayer.playUrl(local, stream.url, stream.headers.map { "${it.key}: ${it.value}" }.toTypedArray())
            if (error != null) throw IllegalStateException(error)
            check(NativePlayer.waitLoaded(local, 60_000)) { "Hết thời gian mở nguồn phát" }
            synchronized(lock) {
                if (ticket == generation) {
                    opening = 0L
                    handle = local
                    if (surface?.isValid != true) NativePlayer.detachSurface(local)
                    for (subtitle in (stream.subtitles + subtitles).distinctBy { it.url }) {
                        val status = NativePlayer.command(local, arrayOf("sub-add", subtitle.url, "select", subtitle.label.ifBlank { subtitle.language }))
                        if (status < 0) Log.w("FrameZooTV", "Không thêm được phụ đề: ${subtitle.url}, libmpv=$status")
                    }
                }
            }
        } finally {
            val owned = synchronized(lock) {
                if (opening == local) opening = 0L
                handle != local
            }
            if (owned) NativePlayer.destroy(local)
        }
        }
    }

    fun command(vararg args: String) = synchronized(lock) { if (handle != 0L) NativePlayer.command(handle, args.toList().toTypedArray()) }
    fun position(): Double = synchronized(lock) { if (handle == 0L) 0.0 else NativePlayer.propertyDouble(handle, "time-pos") }
    fun duration(): Double = synchronized(lock) { if (handle == 0L) 0.0 else NativePlayer.propertyDouble(handle, "duration") }
    fun paused(): Boolean = synchronized(lock) { handle != 0L && NativePlayer.propertyString(handle, "pause") == "yes" }
    fun stop() {
        val old = synchronized(lock) {
            generation++
            if (opening != 0L) NativePlayer.cancel(opening)
            handle.also { handle = 0L }
        }
        if (old != 0L) NativePlayer.destroy(old)
    }
}
