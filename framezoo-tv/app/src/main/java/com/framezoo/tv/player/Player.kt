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
import java.net.InetAddress
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
    external fun setAudioMode(handle: Long, mode: String): Int
    external fun cancelExtractAudio(handle: Long)
    external fun extractAudio(
        handle: Long,
        url: String,
        headers: Array<String>,
        startAtSec: Double,
        durationSec: Double,
        outputPath: String,
        audioTrackId: String
    ): String?
}

enum class AudioOutputMode(val wireValue: String) {
    AUTO("auto"),
    STEREO_DIALOGUE("stereo-dialogue"),
    PASSTHROUGH("passthrough");

    companion object {
        fun fromWire(value: String?): AudioOutputMode =
            entries.firstOrNull { it.wireValue == value } ?: AUTO
    }
}

private sealed interface BencodeValue {
    data class IntVal(val value: Long) : BencodeValue
    data class BytesVal(val value: ByteArray) : BencodeValue
    data class ListVal(val items: List<BencodeValue>) : BencodeValue
    data class DictVal(val entries: Map<String, BencodeValue>) : BencodeValue
}

private class BencodeDecoder(private val data: ByteArray) {
    private var pos = 0

    fun decode(): BencodeValue? {
        if (pos >= data.size) return null
        return when (data[pos].toInt().toChar()) {
            'i' -> {
                pos++
                val end = findByte('e'.code.toByte()) ?: return null
                val num = String(data, pos, end - pos, Charsets.US_ASCII).toLongOrNull() ?: return null
                pos = end + 1
                BencodeValue.IntVal(num)
            }
            'l' -> {
                pos++
                val items = mutableListOf<BencodeValue>()
                while (pos < data.size && data[pos] != 'e'.code.toByte()) {
                    items += decode() ?: return null
                }
                if (pos >= data.size) return null
                pos++
                BencodeValue.ListVal(items)
            }
            'd' -> {
                pos++
                val entries = linkedMapOf<String, BencodeValue>()
                while (pos < data.size && data[pos] != 'e'.code.toByte()) {
                    val key = (decode() as? BencodeValue.BytesVal)?.value?.toString(Charsets.UTF_8) ?: return null
                    val value = decode() ?: return null
                    entries[key] = value
                }
                if (pos >= data.size) return null
                pos++
                BencodeValue.DictVal(entries)
            }
            in '0'..'9' -> {
                val colon = findByte(':'.code.toByte()) ?: return null
                val len = String(data, pos, colon - pos, Charsets.US_ASCII).toIntOrNull() ?: return null
                val start = colon + 1
                if (len < 0 || start + len > data.size) return null
                pos = start + len
                BencodeValue.BytesVal(data.copyOfRange(start, start + len))
            }
            else -> null
        }
    }

    private fun findByte(target: Byte): Int? {
        for (i in pos until data.size) if (data[i] == target) return i
        return null
    }
}

private fun isUsablePeerHost(host: String): Boolean =
    host.isNotBlank() &&
        !host.startsWith("0.") &&
        !host.startsWith("127.") &&
        host != "::" &&
        host != "::1" &&
        host != "0:0:0:0:0:0:0:0" &&
        host != "0:0:0:0:0:0:0:1"

private fun parseCompactBlockPeers(raw: ByteArray, addrWidth: Int): List<Pair<String, Int>> {
    val stride = addrWidth + 2
    if (raw.isEmpty() || raw.size % stride != 0) return emptyList()
    val result = ArrayList<Pair<String, Int>>(raw.size / stride)
    for (offset in raw.indices step stride) {
        val port = ((raw[offset + addrWidth].toInt() and 0xFF) shl 8) or (raw[offset + addrWidth + 1].toInt() and 0xFF)
        if (port !in 1..65535) continue
        if (addrWidth == 4 && (raw[offset].toInt() and 0xFF) == 0) continue
        val addr = runCatching { InetAddress.getByAddress(raw.copyOfRange(offset, offset + addrWidth)) }.getOrNull() ?: continue
        if (addr.isAnyLocalAddress || addr.isLoopbackAddress || addr.isMulticastAddress) continue
        val host = addr.hostAddress?.substringBefore('%') ?: continue
        if (isUsablePeerHost(host)) result += host to port
    }
    return result
}

internal fun parseCompactPeersFromBencode(payload: ByteArray): List<Pair<String, Int>> {
    val root = (BencodeDecoder(payload).decode() as? BencodeValue.DictVal)?.entries ?: return emptyList()
    val peers = mutableListOf<Pair<String, Int>>()
    when (val p = root["peers"]) {
        is BencodeValue.BytesVal -> peers += parseCompactBlockPeers(p.value, 4)
        is BencodeValue.ListVal -> {
            for (item in p.items) {
                val dict = (item as? BencodeValue.DictVal)?.entries ?: continue
                val host = (dict["ip"] as? BencodeValue.BytesVal)?.value?.toString(Charsets.UTF_8)?.trim() ?: continue
                val port = (dict["port"] as? BencodeValue.IntVal)?.value?.toInt() ?: continue
                if (port in 1..65535 && isUsablePeerHost(host)) peers += host to port
            }
        }
        else -> Unit
    }
    (root["peers6"] as? BencodeValue.BytesVal)?.let { peers += parseCompactBlockPeers(it.value, 16) }
    return peers.distinct()
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
    private val handleRefCounts = mutableMapOf<Long, Int>()
    private val pendingDestroyHandles = mutableSetOf<Long>()
    private var currentAudioMode = AudioOutputMode.AUTO
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
            val fullUrl = "${trackerUrl}${sep}numwant=80&uploaded=0&downloaded=0&left=1073741824&event=started&compact=1&info_hash=$encodedInfoHash&peer_id=$peerId&port=6881"
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
            if (injected.size >= 150) break
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
                        if (currentAudioMode != AudioOutputMode.AUTO) {
                            NativePlayer.setAudioMode(local, currentAudioMode.wireValue)
                        }
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
    internal fun readSubtitleText(url: String): String? {
        val file = synchronized(lock) { subtitleFiles[url] } ?: return null
        return runCatching { decodeSubtitleFileBytes(file.readBytes()) }
            .onFailure { Log.w("FrameZooTV", "Không đọc được phụ đề", it) }
            .getOrNull()
    }

    internal fun downloadSubtitleText(url: String, headers: Map<String, String>, mediaUrl: String): String {
        readSubtitleText(url)?.let { return it }
        val temp = downloadSubtitle(url, context.cacheDir, headers, mediaUrl)
        return try {
            decodeSubtitleFileBytes(temp.readBytes())
        } finally {
            temp.delete()
        }
    }

    private fun decodeSubtitleFileBytes(bytes: ByteArray): String {
        val charset = when {
            bytes.size >= 2 && bytes[0] == 0xff.toByte() && bytes[1] == 0xfe.toByte() -> Charsets.UTF_16LE
            bytes.size >= 2 && bytes[0] == 0xfe.toByte() && bytes[1] == 0xff.toByte() -> Charsets.UTF_16BE
            else -> Charsets.UTF_8
        }
        return bytes.toString(charset)
    }

    // Read on Dispatchers.IO. The cached file is owned by the current player generation.
    internal fun transcript(url: String): List<TranscriptCue> {
        val raw = readSubtitleText(url) ?: return emptyList()
        return parseSubtitleTranscript(raw)
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
        var replaced: File? = null
        try {
            return synchronized(lock) {
                if (handle == 0L || token != (generation to subtitleRevision)) return@synchronized -1
                val (res, consumed, old) = applySubtitleSelectionLocked(id, url, local, title, language, secondary, replaceCached = false)
                if (consumed) downloaded = null
                replaced = old
                res
            }
        } finally {
            downloaded?.delete()
            replaced?.delete()
        }
    }

    // Call on Dispatchers.IO.
    fun selectSubtitleFromText(
        token: Pair<Int, Int>,
        syntheticUrl: String,
        vttText: String,
        title: String,
        language: String,
        secondary: Boolean
    ): Int {
        val file = File.createTempFile("subtitle-vtt-", ".vtt", context.cacheDir)
        var keepTemp = false
        var replaced: File? = null
        try {
            file.writeText(vttText, Charsets.UTF_8)
            return synchronized(lock) {
                if (handle == 0L || token != (generation to subtitleRevision)) return@synchronized -1
                val (res, consumed, old) = applySubtitleSelectionLocked(null, syntheticUrl, file, title, language, secondary, replaceCached = true)
                keepTemp = consumed
                replaced = old
                res
            }
        } finally {
            if (!keepTemp) file.delete()
            replaced?.delete()
        }
    }

    private fun applySubtitleSelectionLocked(
        id: String?,
        url: String?,
        local: File?,
        title: String,
        language: String,
        secondary: Boolean,
        replaceCached: Boolean
    ): Triple<Int, Boolean, File?> {
        val property = if (secondary) "secondary-sid" else "sid"
        val other = if (secondary) "sid" else "secondary-sid"
        val previous = NativePlayer.propertyString(handle, property)
        var trackId = id
        var consumedLocal = false
        var oldReplaced: File? = null
        if (trackId == null && url != null && local != null) {
            val cached = if (replaceCached) null else subtitleFiles[url]
            val file = cached ?: local
            trackId = if (replaceCached) null else readSubtitleTracks { NativePlayer.propertyString(handle, it) }
                .firstOrNull { it.externalFilename == file.absolutePath }?.id
            if (trackId == null) {
                if (NativePlayer.command(handle, arrayOf("sub-add", file.absolutePath, "auto", title, language)) < 0) {
                    return Triple(-1, false, null)
                }
                trackId = readSubtitleTracks { NativePlayer.propertyString(handle, it) }
                    .firstOrNull { it.externalFilename == file.absolutePath }?.id
            }
            if (trackId != null && (cached == null || replaceCached)) {
                oldReplaced = subtitleFiles.put(url, file)?.takeIf { it != file }
                consumedLocal = true
            }
        }
        if (trackId == null) return Triple(-1, consumedLocal, oldReplaced)
        if (trackId == NativePlayer.propertyString(handle, other)) return Triple(-2, consumedLocal, oldReplaced)
        val result = NativePlayer.command(handle, arrayOf("set", property, trackId))
        val finalResult = if (result < 0 || NativePlayer.propertyString(handle, property) != trackId) -1 else {
            if (previous != trackId) NativePlayer.command(handle, arrayOf("set", if (secondary) "secondary-sub-delay" else "sub-delay", "0"))
            result
        }
        return Triple(finalResult, consumedLocal, oldReplaced)
    }
    fun audioMode(): AudioOutputMode = synchronized(lock) { currentAudioMode }
    fun setAudioMode(mode: AudioOutputMode): Boolean = synchronized(lock) {
        currentAudioMode = mode
        val current = currentReadHandleLocked()
        current != 0L && NativePlayer.setAudioMode(current, mode.wireValue) >= 0
    }
    fun reloadAudio() { command("ao-reload") }
    fun onLifecyclePause(): Boolean {
        val wasPlaying = !paused()
        if (wasPlaying) command("set", "pause", "yes")
        return wasPlaying
    }
    fun onLifecycleResume(resumePlayback: Boolean) {
        synchronized(lock) {
            val current = currentReadHandleLocked()
            if (current == 0L) return
            NativePlayer.command(current, arrayOf("ao-reload"))
            if (currentAudioMode != AudioOutputMode.AUTO) {
                NativePlayer.setAudioMode(current, currentAudioMode.wireValue)
            }
            if (resumePlayback) NativePlayer.command(current, arrayOf("set", "pause", "no"))
        }
    }
    fun cancelExtractAudio() {
        synchronized(lock) {
            if (handle != 0L) NativePlayer.cancelExtractAudio(handle)
        }
    }
    fun extractAudio(
        stream: Stream,
        startAtSeconds: Double,
        durationSeconds: Double,
        outputFile: File,
        audioTrackId: String? = null
    ): String? {
        val activeHandle = synchronized(lock) {
            if (handle != 0L) handleRefCounts[handle] = (handleRefCounts[handle] ?: 0) + 1
            handle
        }
        if (activeHandle == 0L) return "Trình phát chưa sẵn sàng"
        return try {
            val sourceUri = if (stream.url.startsWith("magnet:")) "framezoo://video.mkv" else stream.url
            val headerArray = stream.headers.map { "${it.key}: ${it.value}" }.toTypedArray()
            NativePlayer.extractAudio(
                activeHandle,
                sourceUri,
                headerArray,
                startAtSeconds.coerceAtLeast(0.0),
                durationSeconds,
                outputFile.absolutePath,
                audioTrackId.orEmpty()
            )
        } finally {
            val shouldDestroy = synchronized(lock) {
                val remaining = (handleRefCounts[activeHandle] ?: 1) - 1
                if (remaining <= 0) handleRefCounts.remove(activeHandle) else handleRefCounts[activeHandle] = remaining
                remaining <= 0 && pendingDestroyHandles.remove(activeHandle)
            }
            if (shouldDestroy) NativePlayer.destroy(activeHandle)
        }
    }
    fun propertyDouble(name: String): Double = synchronized(lock) {
        val current = currentReadHandleLocked()
        if (current == 0L) 0.0 else NativePlayer.propertyDouble(current, name)
    }
    fun stop() {
        var deferred = false
        val (old, files) = synchronized(lock) {
            generation++
            if (opening != 0L) NativePlayer.cancel(opening)
            val old = handle
            handle = 0L
            if (old != 0L && (handleRefCounts[old] ?: 0) > 0) {
                NativePlayer.cancelExtractAudio(old)
                pendingDestroyHandles.add(old)
                deferred = true
            }
            val files = subtitleFiles.values.toList()
            subtitleFiles.clear()
            old to files
        }
        if (old != 0L && !deferred) NativePlayer.destroy(old)
        files.forEach { it.delete() }
    }
}
