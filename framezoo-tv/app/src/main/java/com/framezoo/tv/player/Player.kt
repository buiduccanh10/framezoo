package com.framezoo.tv.player

import com.framezoo.tv.api.Addons
import com.framezoo.tv.model.Stream

import android.content.Context
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.os.Build
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject

data class TorrentLiveStats(
    val state: String = "opening",
    val peers: Int = 0,
    val seeds: Int = 0,
    val downloadRate: Long = 0L,
    val progress: Double = 0.0,
    val downloadedBytes: Long = 0L,
    val totalBytes: Long = 0L
)

data class AudioTrack(val id: String, val language: String, val title: String, val selected: Boolean)
data class VideoTrack(val id: String, val width: Int, val height: Int, val bitrate: Long, val selected: Boolean)
data class SubtitleTrack(val id: String, val language: String, val title: String, val externalFilename: String?, val selected: Boolean)

internal fun readAudioTracks(property: (String) -> String?): List<AudioTrack> {
    val count = property("track-list/count")?.toIntOrNull()?.coerceIn(0, 256) ?: return emptyList()
    return (0 until count).mapNotNull { index ->
        val prefix = "track-list/$index"
        if (property("$prefix/type") != "audio") return@mapNotNull null
        val id = property("$prefix/id") ?: return@mapNotNull null
        AudioTrack(id, property("$prefix/lang").orEmpty(), property("$prefix/title").orEmpty(), property("$prefix/selected") == "yes")
    }
}

internal fun readVideoTracks(property: (String) -> String?): List<VideoTrack> {
    val count = property("track-list/count")?.toIntOrNull()?.coerceIn(0, 256) ?: return emptyList()
    return (0 until count).mapNotNull { index ->
        val prefix = "track-list/$index"
        if (property("$prefix/type") != "video" || property("$prefix/albumart") == "yes" || property("$prefix/image") == "yes") return@mapNotNull null
        val id = property("$prefix/id") ?: return@mapNotNull null
        VideoTrack(id, property("$prefix/demux-w")?.toIntOrNull() ?: 0,
            property("$prefix/demux-h")?.toIntOrNull() ?: 0,
            property("$prefix/hls-bitrate")?.toLongOrNull() ?: 0, property("$prefix/selected") == "yes")
    }
}

internal fun readSubtitleTracks(property: (String) -> String?): List<SubtitleTrack> {
    val count = property("track-list/count")?.toIntOrNull()?.coerceIn(0, 256) ?: return emptyList()
    return (0 until count).mapNotNull { index ->
        val prefix = "track-list/$index"
        if (property("$prefix/type") != "sub") return@mapNotNull null
        val id = property("$prefix/id") ?: return@mapNotNull null
        SubtitleTrack(id, property("$prefix/lang").orEmpty(), property("$prefix/title").orEmpty(),
            property("$prefix/external-filename"), property("$prefix/selected") == "yes")
    }
}

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
    external fun hasVideoFrame(handle: Long): Boolean
    external fun propertyDouble(handle: Long, name: String): Double
    external fun propertyString(handle: Long, name: String): String?
    external fun addTorrentPeer(handle: Long, host: String, port: Int)
    external fun torrentStats(handle: Long): String?
}

internal fun parseCompactPeersFromBencode(payload: ByteArray): List<Pair<String, Int>> {
    val result = mutableListOf<Pair<String, Int>>()
    val marker = "5:peers".toByteArray(Charsets.ISO_8859_1)
    var idx = 0
    while (idx <= payload.size - marker.size) {
        var match = true
        for (j in marker.indices) {
            if (payload[idx + j] != marker[j]) {
                match = false
                break
            }
        }
        if (match) {
            var pos = idx + marker.size
            var len = 0
            var hasDigits = false
            while (pos < payload.size && payload[pos].toInt().toChar().isDigit()) {
                len = len * 10 + (payload[pos].toInt() - '0'.code)
                pos++
                hasDigits = true
            }
            if (hasDigits && pos < payload.size && payload[pos] == ':'.code.toByte()) {
                pos++
                if (len > 0 && len % 6 == 0 && pos + len <= payload.size) {
                    var offset = pos
                    val end = pos + len
                    while (offset + 6 <= end) {
                        val b0 = payload[offset].toInt() and 0xFF
                        val b1 = payload[offset + 1].toInt() and 0xFF
                        val b2 = payload[offset + 2].toInt() and 0xFF
                        val b3 = payload[offset + 3].toInt() and 0xFF
                        val port = ((payload[offset + 4].toInt() and 0xFF) shl 8) or (payload[offset + 5].toInt() and 0xFF)
                        if (port in 1..65535 && b0 != 0 && b0 != 127) {
                            result += "$b0.$b1.$b2.$b3" to port
                        }
                        offset += 6
                    }
                }
            }
        }
        idx++
    }
    return result.distinct()
}

internal fun hexInfoHashToUrlEncodedBytes(infoHash: String): String? {
    val clean = infoHash.trim().lowercase()
    if (clean.length != 40 || !clean.all { it in '0'..'9' || it in 'a'..'f' }) return null
    val sb = StringBuilder(120)
    for (i in 0 until 40 step 2) {
        sb.append('%').append(clean[i]).append(clean[i + 1])
    }
    return sb.toString()
}

class PlayerController(private val context: Context) {
    private val lock = Any()
    private var handle = 0L
    private var opening = 0L
    private var generation = 0
    private var subtitleRevision = 0
    private val subtitleFiles = mutableMapOf<String, File>()
    @Volatile private var surface: Surface? = null
    private var surfaceWidth = 0
    private var surfaceHeight = 0

    /** Read-only native state is available while a source is still opening. */
    private fun currentReadHandleLocked(): Long = if (handle != 0L) handle else opening

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

    /** TextureView keeps Compose loading and control layers above the video surface. */
    fun bindTextureSurface(value: Surface, width: Int, height: Int) {
        synchronized(lock) {
            surface = value
            surfaceWidth = width
            surfaceHeight = height
            val current = if (handle != 0L) handle else opening
            if (current != 0L) {
                NativePlayer.attachSurface(current, value)
                NativePlayer.surfaceSize(current, width, height)
            }
        }
    }

    fun unbindTextureSurface(value: Surface) {
        synchronized(lock) {
            if (surface !== value) return
            val current = if (handle != 0L) handle else opening
            if (current != 0L) NativePlayer.detachSurface(current)
            surface = null
            surfaceWidth = 0
            surfaceHeight = 0
        }
        value.release()
    }

    private fun announceHttpTracker(trackerUrl: String, encodedInfoHash: String, peerId: String): List<Pair<String, Int>> {
        return try {
            val sep = if ('?' in trackerUrl) "&" else "?"
            val fullUrl = "${trackerUrl}${sep}numwant=50&uploaded=0&downloaded=0&left=1073741824&event=started&compact=1&info_hash=$encodedInfoHash&peer_id=$peerId&port=6881"
            val conn = (URL(fullUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 3000
                readTimeout = 3000
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", "Framezoo/1.1 torrent-discovery")
                setRequestProperty("Accept", "text/plain, application/octet-stream")
            }
            try {
                if (conn.responseCode !in 200..299) return emptyList()
                val bytes = conn.inputStream.use { it.readBytes() }
                parseCompactPeersFromBencode(bytes)
            } finally {
                conn.disconnect()
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private suspend fun discoverHttpPeersLoop(targetHandle: Long, ticket: Int, infoHash: String) = coroutineScope {
        val encodedHash = hexInfoHashToUrlEncodedBytes(infoHash) ?: return@coroutineScope
        val peerId = "-FZ1100-" + (1..12).map { "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".random() }.joinToString("")
        val httpTrackers = Addons.DEFAULT_TRACKERS.filter { it.startsWith("http://") || it.startsWith("https://") }
        val injected = mutableSetOf<Pair<String, Int>>()

        // Give libtorrent 200ms to create the TorrentStream object inside playTorrent
        delay(200)
        for (round in 0 until 4) {
            val stillValid = synchronized(lock) { ticket == generation && (opening == targetHandle || handle == targetHandle) }
            if (!stillValid || !isActive) break

            val discovered = httpTrackers.map { tracker ->
                async(Dispatchers.IO) { announceHttpTracker(tracker, encodedHash, peerId) }
            }.awaitAll().flatten().distinct()

            for (peer in discovered) {
                val activeNow = synchronized(lock) { ticket == generation && (opening == targetHandle || handle == targetHandle) }
                if (!activeNow) break
                if (injected.add(peer)) {
                    NativePlayer.addTorrentPeer(targetHandle, peer.first, peer.second)
                }
            }
            if (injected.size >= 80) break
            delay(4000)
        }
    }

    suspend fun play(stream: Stream, startAtSeconds: Double = 0.0, initialHlsBitrate: Long = 0L) {
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
            val local = NativePlayer.create(
                Build.PRODUCT.startsWith("sdk") || Build.HARDWARE == "ranchu" || Build.FINGERPRINT.contains("generic"),
                fontsDir.absolutePath,
                systemFont?.second ?: "sans-serif"
            )
            check(local != 0L) { "Không khởi tạo được libmpv" }
            val discoveryScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
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

                val hash = stream.infoHash ?: stream.url.substringAfter("btih:", "").substringBefore("&").takeIf { it.length == 40 }
                if (stream.url.startsWith("magnet:") && hash != null) {
                    discoveryScope.launch {
                        discoverHttpPeersLoop(local, ticket, hash)
                    }
                }

                if (initialHlsBitrate > 0) NativePlayer.command(local, arrayOf("set", "hls-bitrate", initialHlsBitrate.coerceAtMost(Int.MAX_VALUE.toLong()).toString()))
                val error = if (stream.url.startsWith("magnet:"))
                    NativePlayer.playTorrent(local, stream.url, stream.fileIdx ?: -1)
                else NativePlayer.playUrl(local, stream.url, stream.headers.map { "${it.key}: ${it.value}" }.toTypedArray())
                if (error != null) throw IllegalStateException(error)
                check(NativePlayer.waitLoaded(local, 120_000)) { "Hết thời gian mở nguồn phát" }
                synchronized(lock) {
                    if (ticket == generation) {
                        opening = 0L
                        handle = local
                        if (surface?.isValid != true) NativePlayer.detachSurface(local)
                        if (startAtSeconds > 1.0) {
                            NativePlayer.command(local, arrayOf("seek", startAtSeconds.toString(), "absolute"))
                        }
                    }
                }
            } finally {
                discoveryScope.coroutineContext[kotlinx.coroutines.Job]?.cancel()
                val owned = synchronized(lock) {
                    if (opening == local) opening = 0L
                    handle != local
                }
                if (owned) NativePlayer.destroy(local)
            }
        }
    }

    fun torrentStats(): TorrentLiveStats? {
        val raw = synchronized(lock) {
            val current = if (handle != 0L) handle else opening
            if (current == 0L) null else NativePlayer.torrentStats(current)
        } ?: return null
        return runCatching {
            val obj = JSONObject(raw)
            TorrentLiveStats(
                state = obj.optString("state", "opening"),
                peers = obj.optInt("peers", 0),
                seeds = obj.optInt("seeds", 0),
                downloadRate = obj.optLong("downloadRate", 0L),
                progress = obj.optDouble("progress", 0.0),
                downloadedBytes = obj.optLong("downloadedBytes", 0L),
                totalBytes = obj.optLong("totalBytes", 0L)
            )
        }.getOrNull()
    }

    fun command(vararg args: String) = synchronized(lock) { if (handle != 0L) NativePlayer.command(handle, args.toList().toTypedArray()) else -1 }
    fun hasVideoFrame(): Boolean = synchronized(lock) {
        val current = currentReadHandleLocked()
        current != 0L && NativePlayer.hasVideoFrame(current)
    }
    fun position(): Double = synchronized(lock) {
        val current = currentReadHandleLocked()
        if (current == 0L) 0.0 else NativePlayer.propertyDouble(current, "time-pos")
    }
    fun duration(): Double = synchronized(lock) {
        val current = currentReadHandleLocked()
        if (current == 0L) 0.0 else NativePlayer.propertyDouble(current, "duration")
    }
    fun paused(): Boolean = synchronized(lock) {
        val current = currentReadHandleLocked()
        current != 0L && NativePlayer.propertyString(current, "pause") == "yes"
    }
    fun propertyString(name: String): String? = synchronized(lock) {
        val current = currentReadHandleLocked()
        if (current == 0L) null else NativePlayer.propertyString(current, name)
    }
    fun audioTracks(): List<AudioTrack> = synchronized(lock) {
        val current = currentReadHandleLocked()
        if (current == 0L) emptyList() else readAudioTracks { NativePlayer.propertyString(current, it) }
    }
    fun videoTracks(): List<VideoTrack> = synchronized(lock) {
        val current = currentReadHandleLocked()
        if (current == 0L) emptyList() else readVideoTracks { NativePlayer.propertyString(current, it) }
    }
    fun subtitleTracks(): List<SubtitleTrack> = synchronized(lock) {
        val current = currentReadHandleLocked()
        if (current == 0L) emptyList() else readSubtitleTracks { NativePlayer.propertyString(current, it) }.map { track ->
            track.copy(externalFilename = subtitleFiles.entries.firstOrNull { it.value.absolutePath == track.externalFilename }?.key ?: track.externalFilename)
        }
    }
    // Read on Dispatchers.IO. The cached file is owned by the current player generation.
    internal fun transcript(url: String): List<TranscriptCue> {
        val file = synchronized(lock) { subtitleFiles[url] } ?: return emptyList()
        return runCatching {
            val bytes = file.readBytes()
            val charset = when {
                bytes.size >= 2 && bytes[0] == 0xff.toByte() && bytes[1] == 0xfe.toByte() -> Charsets.UTF_16LE
                bytes.size >= 2 && bytes[0] == 0xfe.toByte() && bytes[1] == 0xff.toByte() -> Charsets.UTF_16BE
                else -> Charsets.UTF_8
            }
            parseSubtitleTranscript(bytes.toString(charset))
        }.onFailure { Log.w("FrameZooTV", "Không đọc được danh sách thoại", it) }.getOrDefault(emptyList())
    }
    fun subtitleToken(): Pair<Int, Int>? = synchronized(lock) {
        if (handle == 0L) null else generation to subtitleRevision
    }
    fun markSubtitleChanged() = synchronized(lock) { subtitleRevision++ }
    // Call on Dispatchers.IO: remote downloads must never hold the player lock.
    fun selectSubtitle(token: Pair<Int, Int>, id: String?, url: String?, title: String, language: String,
                       secondary: Boolean, headers: Map<String, String>, mediaUrl: String): Int {
        var downloaded: File? = null
        val existing = synchronized(lock) {
            if (handle == 0L || token != (generation to subtitleRevision)) return -1
            url?.let { subtitleFiles[it] }
        }
        val local = if (id == null && url != null && existing == null) {
            try {
                downloadSubtitle(url, context.cacheDir, headers, mediaUrl).also { downloaded = it }
            } catch (error: Exception) {
                Log.w("FrameZooTV", "Không tải được phụ đề", error)
                return -1
            }
        } else existing
        try {
            return synchronized(lock) {
                if (handle == 0L || token != (generation to subtitleRevision)) return@synchronized -1
                val property = if (secondary) "secondary-sid" else "sid"
                val other = if (secondary) "sid" else "secondary-sid"
                val previous = NativePlayer.propertyString(handle, property)
                var trackId = id
                if (trackId == null && url != null && local != null) {
                    val cached = subtitleFiles[url]
                    val file = cached ?: local
                    trackId = readSubtitleTracks { NativePlayer.propertyString(handle, it) }
                        .firstOrNull { it.externalFilename == file.absolutePath }?.id
                    if (trackId == null) {
                        if (NativePlayer.command(handle, arrayOf("sub-add", file.absolutePath, "auto", title, language)) < 0) return@synchronized -1
                        trackId = readSubtitleTracks { NativePlayer.propertyString(handle, it) }
                            .firstOrNull { it.externalFilename == file.absolutePath }?.id
                    }
                    if (trackId != null && cached == null) {
                        subtitleFiles[url] = file
                        downloaded = null
                    }
                }
                if (trackId == null) return@synchronized -1
                if (trackId == NativePlayer.propertyString(handle, other)) return@synchronized -2
                val result = NativePlayer.command(handle, arrayOf("set", property, trackId))
                if (result < 0 || NativePlayer.propertyString(handle, property) != trackId) -1 else {
                    if (previous != trackId) NativePlayer.command(handle, arrayOf("set", if (secondary) "secondary-sub-delay" else "sub-delay", "0"))
                    result
                }
            }
        } finally {
            downloaded?.delete()
        }
    }
    fun propertyDouble(name: String): Double = synchronized(lock) {
        val current = currentReadHandleLocked()
        if (current == 0L) 0.0 else NativePlayer.propertyDouble(current, name)
    }
    fun stop() {
        val (old, files) = synchronized(lock) {
            generation++
            if (opening != 0L) NativePlayer.cancel(opening)
            val old = handle
            handle = 0L
            val files = subtitleFiles.values.toList()
            subtitleFiles.clear()
            old to files
        }
        if (old != 0L) NativePlayer.destroy(old)
        files.forEach { it.delete() }
    }
}
