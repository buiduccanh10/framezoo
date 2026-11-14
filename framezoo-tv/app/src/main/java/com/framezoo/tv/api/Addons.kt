package com.framezoo.tv.api

import com.framezoo.tv.model.*
import com.framezoo.tv.storage.SecureStore

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLEncoder

class Addons(context: Context, private val backend: Backend, private val store: SecureStore) {
    companion object {
        const val NATIVE_SUBTITLE_ADDON_ID = "community.framezoo.subtitles"
        val DEFAULT_TRACKERS = listOf(
            "http://tracker.dler.org:6969/announce",
            "http://tracker.opentrackr.org:1337/announce",
            "https://tracker.opentrackr.org:443/announce",
            "http://zer0day.ch:1337/announce",
            "http://tracker.qu.ax:6969/announce",
            "http://tracker.auctor.tv:6969/announce",
            "http://tracker.ducks.party:1984/announce",
            "http://bittorrent-tracker.e-n-c-r-y-p-t.net:1337/announce",
            "http://t.overflow.biz:6969/announce",
            "http://open.tracker.cl:1337/announce",
            "http://tracker.tryhackx.org:6969/announce",
            "https://tracker.zhuqiy.com:443/announce",
            "http://tracker.renfei.net:8080/announce",
            "https://tracker.pmman.tech:443/announce",
            "https://ht.therarbg.to:443/announce",
            "udp://zer0day.ch:1337/announce",
            "udp://tracker.publictracker.xyz:6969/announce",
            "udp://tracker.opentrackr.org:1337/announce",
            "udp://tracker.openbittorrent.com:6969/announce",
            "udp://open.demonii.com:1337/announce",
            "udp://open.stealth.si:80/announce",
            "udp://udp.tracker.projectk.org:23333/announce",
            "udp://tracker.tryhackx.org:6969/announce",
            "udp://tracker.torrent.eu.org:451/announce",
            "udp://tracker.theoks.net:6969/announce",
            "udp://tracker.startwork.cv:1337/announce",
            "udp://tracker.qu.ax:6969/announce",
            "udp://tracker.dler.org:6969/announce",
            "udp://tracker.auctor.tv:6969/announce",
            "udp://tracker-udp.gbitt.info:80/announce",
            "udp://torrentclub.online:54123/announce",
            "udp://torrentclub.online:1984/announce",
            "udp://t.overflow.biz:6969/announce",
            "udp://explodie.org:6969/announce",
            "udp://bittorrent-tracker.e-n-c-r-y-p-t.net:1337/announce",
            "udp://tracker.plx.im:6969/announce",
            "udp://tracker.nyaa.vc:6969/announce",
            "udp://tracker.iperson.xyz:6969/announce",
            "udp://tracker.gmi.gd:6969/announce",
            "udp://tracker.fnix.net:6969/announce",
            "udp://tracker.flatuslifir.is:6969/announce",
            "udp://tracker.ducks.party:1984/announce",
            "udp://tracker.bluefrog.pw:2710/announce",
            "https://tracker.yemekyedim.com:443/announce",
            "https://tracker.bt4g.com:443/announce",
            "https://tr.zukizuki.org:443/announce",
            "http://tracker810.xyz:11450/announce",
            "udp://opentor.net:6969",
            "http://bt.t-ru.org/ann?magnet",
            "http://bt2.t-ru.org/ann?magnet",
            "http://bt4.t-ru.org/ann?magnet"
        )
    }

    private val prefs = context.getSharedPreferences("framezoo_tv_addons", Context.MODE_PRIVATE)
    private fun encode(value: String) = URLEncoder.encode(value, "UTF-8")

    fun getNativeSubtitlesAddon(): Addon {
        val rawBackend = store.backendUrl.trimEnd('/')
        val isLocalBackend = rawBackend.contains("localhost") || rawBackend.contains("127.0.0.1") || rawBackend.contains("10.0.2.2")
        val appDomain = "https://framezoo.top"
        val base = if (isLocalBackend) rawBackend else appDomain
        val manifestUrl = "$base/addon/subtitles/manifest.json"
        val enabled = prefs.getBoolean("native_subtitles_enabled", true)
        return Addon(
            manifestUrl = manifestUrl,
            id = NATIVE_SUBTITLE_ADDON_ID,
            name = "Framezoo Subtitles",
            resources = setOf("subtitles"),
            enabled = enabled,
            version = "1.0.0",
            description = "Native subtitle provider (Wyzie, OpenSubtitles, SubSource, Granite)",
            logo = "https://framezoo.top/favicon-192.png",
            isNative = true
        )
    }

    private suspend fun json(url: String): JSONObject = withContext(Dispatchers.IO) {
        val uri = URI(url)
        require(uri.scheme == "https" || uri.scheme == "http") { "Addon URL phải dùng HTTP(S)" }
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000; readTimeout = 15_000; instanceFollowRedirects = true
            setRequestProperty("Accept", "application/json")
        }
        try {
            require(connection.responseCode in 200..299) { "Addon HTTP ${connection.responseCode}" }
            require(connection.contentLengthLong <= 5L * 1024 * 1024 || connection.contentLengthLong < 0) { "Addon quá lớn" }
            val bytes = ByteArray(5 * 1024 * 1024 + 1)
            var size = 0
            connection.inputStream.use { input ->
                while (size < bytes.size) {
                    val count = input.read(bytes, size, bytes.size - size)
                    if (count < 0) break
                    size += count
                }
            }
            require(size < bytes.size) { "Addon quá lớn" }
            JSONObject(String(bytes, 0, size, Charsets.UTF_8))
        } finally { connection.disconnect() }
    }

    private fun resolveLogo(logo: String?, manifestUrl: String): String? {
        if (logo.isNullOrBlank()) return null
        if (logo.startsWith("http://") || logo.startsWith("https://")) return logo
        return runCatching { URI(manifestUrl).resolve(logo).toString() }.getOrDefault(logo)
    }

    private fun parse(raw: JSONObject): Addon {
        val manifestUrl = raw.getString("manifestUrl")
        val manifest = raw.optJSONObject("manifest") ?: JSONObject()
        val resources = manifest.optJSONArray("resources") ?: JSONArray()
        val id = manifest.optString("id", raw.optString("id"))
        return Addon(
            manifestUrl = manifestUrl,
            id = id,
            name = manifest.optString("name", raw.optString("name")),
            resources = (0 until resources.length()).mapNotNull { i ->
                when (val resource = resources.opt(i)) {
                    is String -> resource
                    is JSONObject -> resource.optString("name")
                    else -> null
                }
            }.toSet(),
            enabled = raw.optBoolean("enabled", true),
            version = manifest.optString("version").ifBlank { raw.optString("version").ifBlank { null } },
            description = manifest.optString("description").ifBlank { raw.optString("description").ifBlank { null } },
            logo = resolveLogo(manifest.optString("logo").ifBlank { raw.optString("logo").ifBlank { null } }, manifestUrl),
            isNative = raw.optBoolean("isNative", false) || id == NATIVE_SUBTITLE_ADDON_ID
        )
    }

    private fun local(): JSONArray = try { JSONArray(prefs.getString("installed", "[]")) } catch (_: Exception) { JSONArray() }

    suspend fun list(): List<Addon> {
        val nativeAddon = getNativeSubtitlesAddon()
        val local = local()
        val merged = linkedMapOf<String, JSONObject>()
        if (store.userId != null) try {
            val remote = backend.settings().optJSONArray("addons") ?: JSONArray()
            for (i in 0 until remote.length()) remote.optJSONObject(i)?.let { merged[it.optString("manifestUrl")] = it }
        } catch (_: Exception) { }
        for (i in 0 until local.length()) local.optJSONObject(i)?.let { merged[it.optString("manifestUrl")] = it }
        prefs.edit().putString("installed", JSONArray(merged.values).toString()).apply()
        val userAddons = merged.values.mapNotNull { raw ->
            val manifestUrl = raw.optString("manifestUrl")
            var manifestObj = raw.optJSONObject("manifest")
            if (manifestObj == null && manifestUrl.isNotBlank()) {
                val fetched = runCatching { json(manifestUrl) }.getOrNull()
                if (fetched != null) {
                    raw.put("manifest", fetched)
                }
            }
            runCatching { parse(raw) }.getOrNull()
        }.filter { it.id != NATIVE_SUBTITLE_ADDON_ID && !it.isNative && it.manifestUrl != nativeAddon.manifestUrl }
        return listOf(nativeAddon) + userAddons
    }

    suspend fun install(input: String) {
        val uri = URI(input.trim())
        require(uri.scheme == "https" || uri.scheme == "http") { "URL phải dùng HTTP(S)" }
        val manifestUrl = if (uri.path.endsWith("manifest.json")) uri.toString() else uri.toString().trimEnd('/') + "/manifest.json"
        val manifest = json(manifestUrl)
        require(manifest.optString("id").isNotBlank() && manifest.optString("name").isNotBlank()) { "Manifest thiếu id hoặc name" }
        val next = local()
        for (i in next.length() - 1 downTo 0) if (next.optJSONObject(i)?.optString("manifestUrl") == manifestUrl) next.remove(i)
        next.put(JSONObject().put("manifestUrl", manifestUrl).put("baseUrl", URI(manifestUrl).resolve(".").toString())
            .put("manifest", manifest).put("enabled", true).put("addedAt", System.currentTimeMillis()))
        save(next)
    }

    suspend fun remove(manifestUrl: String) {
        val nativeAddon = getNativeSubtitlesAddon()
        if (manifestUrl == nativeAddon.manifestUrl || manifestUrl == NATIVE_SUBTITLE_ADDON_ID) return
        val next = local()
        for (i in next.length() - 1 downTo 0) {
            val item = next.optJSONObject(i) ?: continue
            val itemUrl = item.optString("manifestUrl")
            val itemId = item.optJSONObject("manifest")?.optString("id", "") ?: item.optString("id", "")
            if (itemUrl == manifestUrl || itemId == manifestUrl) next.remove(i)
        }
        save(next)
    }

    suspend fun toggleEnabled(manifestUrl: String) {
        val nativeAddon = getNativeSubtitlesAddon()
        if (manifestUrl == nativeAddon.manifestUrl || manifestUrl == NATIVE_SUBTITLE_ADDON_ID) {
            val current = prefs.getBoolean("native_subtitles_enabled", true)
            prefs.edit().putBoolean("native_subtitles_enabled", !current).apply()
            return
        }
        val next = local()
        for (i in 0 until next.length()) {
            val item = next.optJSONObject(i) ?: continue
            val itemUrl = item.optString("manifestUrl")
            val itemId = item.optJSONObject("manifest")?.optString("id", "") ?: item.optString("id", "")
            if (itemUrl == manifestUrl || itemId == manifestUrl) {
                val current = item.optBoolean("enabled", true)
                item.put("enabled", !current)
                break
            }
        }
        save(next)
    }

    private suspend fun save(next: JSONArray) {
        prefs.edit().putString("installed", next.toString()).apply()
        if (store.userId != null) {
            val settings = backend.settings()
            settings.put("addons", next)
            backend.updateSettings(settings)
        }
    }

    private fun endpoint(addon: Addon, resource: String, type: String, id: String): String {
        val root = URI(addon.manifestUrl).resolve(".")
        return root.resolve("$resource/${encode(type)}/${encode(id)}.json").toString()
    }

    private fun mediaId(item: Media, episode: Episode?) = (item.imdbId?.takeIf { it.isNotBlank() } ?: "tmdb:${item.id}") +
        if (episode != null) ":${episode.season}:${episode.number}" else ""

    suspend fun catalog(): List<AddonCatalog> {
        val result = mutableListOf<AddonCatalog>()
        val installed = local()
        for (i in 0 until installed.length()) {
            val row = installed.optJSONObject(i) ?: continue
            if (!row.optBoolean("enabled", true)) continue
            val manifestUrl = row.optString("manifestUrl")
            val manifest = row.optJSONObject("manifest") ?: continue
            val addon = parse(row)
            if ("catalog" !in addon.resources) continue
            val catalogs = manifest.optJSONArray("catalogs") ?: JSONArray()
            for (type in listOf("movie", "series")) try {
                val catalog = (0 until catalogs.length()).mapNotNull { catalogs.optJSONObject(it) }
                    .firstOrNull { it.optString("type") == type }
                if (catalog == null && catalogs.length() > 0) continue
                val id = catalog?.optString("id")?.ifBlank { "top" } ?: "top"
                val entries = catalogPage(manifestUrl, type, id, 0)
                if (entries.isNotEmpty()) result += AddonCatalog(manifestUrl, addon.name, type, id, entries)
            } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { }
        }
        return result
    }

    suspend fun catalogPage(manifestUrl: String, type: String, id: String, skip: Int): List<Media> {
        require(type in setOf("movie", "series") && id.isNotBlank() && skip >= 0)
        val root = URI(manifestUrl).resolve(".")
        val metas = json(root.resolve(addonCatalogPath(type, id, skip)).toString()).optJSONArray("metas") ?: JSONArray()
        return (0 until metas.length()).mapNotNull { metas.optJSONObject(it) }.mapNotNull { meta ->
            val mediaId = meta.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            Media(mediaId, if (type == "series") "show" else "movie", meta.optString("name", "Untitled"),
                meta.optString("poster").ifBlank { null }, meta.optString("background").ifBlank { null },
                meta.optString("description"), meta.optString("releaseInfo").take(4),
                mediaId.takeIf { it.startsWith("tt") }, manifestUrl, releaseQuality = releaseQualityLabel(meta.optString("releaseInfo")))
        }.distinctBy { it.id }
    }

    suspend fun details(item: Media): Pair<Media, List<Episode>> {
        val manifestUrl = item.addonManifest ?: return item to emptyList()
        val type = if (item.type == "show") "series" else "movie"
        val raw = json(endpoint(Addon(manifestUrl, "", "", emptySet()), "meta", type, item.id)).optJSONObject("meta") ?: return item to emptyList()
        val videos = raw.optJSONArray("videos") ?: JSONArray()
        val episodes = (0 until videos.length()).mapNotNull { videos.optJSONObject(it) }.mapNotNull {
            val season = it.optInt("season", -1); val number = it.optInt("episode", -1)
            if (season < 0 || number < 0) null else Episode(season, number, it.optString("title", it.optString("name", "Tập $number")), it.optString("thumbnail"))
        }
        return item.copy(title = raw.optString("name", item.title), poster = raw.optString("poster", item.poster.orEmpty()).ifBlank { null },
            backdrop = raw.optString("background", item.backdrop.orEmpty()).ifBlank { null }, description = raw.optString("description", item.description)) to episodes
    }

    suspend fun streamsForAddon(addon: Addon, item: Media, episode: Episode?): List<Stream> {
        val id = mediaId(item, episode)
        val result = mutableListOf<Stream>()
        val raw = json(endpoint(addon, "stream", if (item.type == "show") "series" else "movie", id)).optJSONArray("streams") ?: JSONArray()
        for (i in 0 until raw.length()) {
            val value = raw.optJSONObject(i) ?: continue
            val hash = value.optString("infoHash").takeIf { it.matches(Regex("(?i)[0-9a-f]{40}|[a-z2-7]{32}")) }
            val trackers = value.optJSONArray("sources") ?: JSONArray()
            val streamTrackers = (0 until trackers.length()).mapNotNull { index ->
                val src = trackers.optString(index).trim()
                if (src.startsWith("tracker:")) src.removePrefix("tracker:").trim()
                else if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("udp://")) src
                else null
            }
            val allTrackers = (streamTrackers + DEFAULT_TRACKERS).distinct()
            val magnet = hash?.let {
                "magnet:?xt=urn:btih:$it" + allTrackers.joinToString("") { tr -> "&tr=${encode(tr)}" }
            }
            val url = value.optString("url").ifBlank { magnet ?: "" }
            if (runCatching { URI(url).scheme?.lowercase() }.getOrNull() !in setOf("http", "https", "magnet")) continue
            val hints = value.optJSONObject("behaviorHints") ?: JSONObject()
            val requestHeaders = hints.optJSONObject("proxyHeaders")?.optJSONObject("request") ?: JSONObject()
            val headers = requestHeaders.keys().asSequence().associateWith { requestHeaders.optString(it) }
                .filter { (name, content) -> name.matches(Regex("[A-Za-z0-9!#$%&'*+.^_`|~-]+")) && '\r' !in content && '\n' !in content }
            val subs = value.optJSONArray("subtitles") ?: JSONArray()
            val rawName = value.optString("name").trim()
            val rawTitle = value.optString("title").trim()
            val rawDesc = value.optString("description").trim()
            val videoSize = hints.optLong("videoSize", -1L).takeIf { it > 0 }
            val bingeGroup = hints.optString("bingeGroup").trim().ifBlank { null }
            result += Stream(
                name = if (rawName.isNotBlank()) rawName else if (rawTitle.isNotBlank()) rawTitle else addon.name,
                url = url,
                infoHash = hash,
                fileIdx = value.optInt("fileIdx", -1).takeIf { it >= 0 },
                filename = hints.optString("filename").ifBlank { null },
                headers = headers,
                subtitles = (0 until subs.length()).mapNotNull { subs.optJSONObject(it) }.mapNotNull {
                    it.optString("url").takeIf(String::isNotBlank)?.let { subUrl ->
                        Subtitle(
                            language = it.optString("lang", it.optString("language", "und")),
                            url = subUrl,
                            label = it.optString("label", it.optString("display")),
                            isHearingImpaired = it.optBoolean("isHearingImpaired", false) || it.optBoolean("hearingImpaired", false),
                            releaseName = it.optString("release", it.optString("fileName", it.optString("title")))
                        )
                    }
                },
                title = rawTitle,
                description = rawDesc,
                videoSize = videoSize,
                addonId = addon.id,
                addonName = addon.name,
                addonLogo = addon.logo,
                bingeGroup = bingeGroup
            )
        }
        return result
    }

    suspend fun streams(item: Media, episode: Episode?): List<Stream> {
        val result = mutableListOf<Stream>()
        for (addon in list().filter { it.enabled && "stream" in it.resources }) try {
            result += streamsForAddon(addon, item, episode)
        } catch (_: Exception) { }
        return result
    }

    suspend fun subtitles(item: Media, episode: Episode?): List<Subtitle> {
        val result = mutableListOf<Subtitle>()
        for (addon in list().filter { it.enabled && "subtitles" in it.resources }) try {
            val raw = json(endpoint(addon, "subtitles", if (item.type == "show") "series" else "movie", mediaId(item, episode)))
                .optJSONArray("subtitles") ?: JSONArray()
            for (i in 0 until raw.length()) raw.optJSONObject(i)?.let {
                val url = it.optString("url")
                if (url.isNotBlank()) result += Subtitle(
                    language = it.optString("lang", it.optString("language", "und")),
                    url = url,
                    label = it.optString("label", it.optString("display")),
                    isHearingImpaired = it.optBoolean("isHearingImpaired", false) || it.optBoolean("hearingImpaired", false),
                    releaseName = it.optString("release", it.optString("fileName", it.optString("title")))
                )
            }
        } catch (_: Exception) { }
        return result
    }
}

internal fun addonCatalogPath(type: String, id: String, skip: Int): String {
    require(type in setOf("movie", "series") && id.isNotBlank() && skip >= 0)
    val encoded = URLEncoder.encode(id, "UTF-8").replace("+", "%20")
    return "catalog/$type/$encoded" + if (skip == 0) ".json" else "/skip=$skip.json"
}
