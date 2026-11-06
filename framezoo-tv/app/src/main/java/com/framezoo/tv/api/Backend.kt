package com.framezoo.tv.api

import com.framezoo.tv.BuildConfig
import com.framezoo.tv.auth.Auth
import com.framezoo.tv.model.*
import com.framezoo.tv.storage.SecureStore

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.Instant

class Backend(private val store: SecureStore) {
    private fun encode(value: String) = URLEncoder.encode(value, "UTF-8")
    private fun image(path: String?, size: String = "w500") = path?.takeIf { it.isNotBlank() }?.let {
        if (it.startsWith("http")) it else "https://image.tmdb.org/t/p/$size$it"
    }

    private suspend fun request(path: String, method: String = "GET", body: JSONObject? = null, auth: Boolean = false, retry: Boolean = true): Any = withContext(Dispatchers.IO) {
        val base = store.backendUrl.trimEnd('/')
        require(base.startsWith("https://") || (BuildConfig.DEBUG && base.startsWith("http://"))) { "Backend URL phải dùng HTTPS" }
        val connection = (URL(base + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 20_000
            setRequestProperty("Accept", "application/json")
            if (auth) store.accessToken?.let { setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
        }
        try {
            val status = connection.responseCode
            if (status == 401 && auth && retry && refresh()) return@withContext request(path, method, body, auth, false)
            val text = (if (status in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status !in 200..299) throw IllegalStateException("HTTP $status: ${text.take(180)}")
            when {
                text.trimStart().startsWith("[") -> JSONArray(text)
                text.trimStart().startsWith("{") -> JSONObject(text)
                else -> JSONObject()
            }
        } finally { connection.disconnect() }
    }

    private suspend fun refresh(): Boolean = try {
        val token = store.refreshToken ?: return false
        val reply = request("/oauth/token", "POST", JSONObject().put("grant_type", "refresh_token").put("refresh_token", token)) as JSONObject
        store.accessToken = reply.optString("access_token", reply.optString("accessToken"))
        store.refreshToken = reply.optString("refresh_token", reply.optString("refreshToken", token))
        !store.accessToken.isNullOrBlank()
    } catch (_: Exception) { false }

    suspend fun login(identifier: String, password: String) {
        require(identifier.isNotBlank() && password.isNotBlank())
        val key = Auth.key(password)
        val start = request("/auth/login/start", "POST", JSONObject().put("identifier", identifier.trim())) as JSONObject
        val challenge = start.getString("challenge")
        val body = JSONObject()
            .put("namespace", "mobile")
            .put("identifier", identifier.trim())
            .put("publicKey", start.optString("publicKey").ifBlank { Auth.publicKey(key) })
            .put("challenge", JSONObject().put("code", challenge).put("signature", Auth.signature(key, challenge)))
            .put("device", "FrameZoo TV")
        val reply = request("/auth/login/complete", "POST", body) as JSONObject
        val oauth = reply.optJSONObject("oauth") ?: throw IllegalStateException("Backend không trả token")
        val token = oauth.optString("accessToken", oauth.optString("access_token"))
        require(token.isNotBlank()) { "Backend không trả access token" }
        store.userId = reply.getJSONObject("user").getString("id")
        store.accessToken = token
        store.refreshToken = oauth.optString("refreshToken", oauth.optString("refresh_token"))
    }

    private fun media(raw: JSONObject, forcedType: String? = null): Media {
        val type = forcedType ?: if (raw.optString("media_type") == "tv") "show" else "movie"
        return Media(
            id = raw.optString("id", raw.optString("tmdbId")), type = type,
            title = raw.optString("title", raw.optString("name", "Untitled")),
            poster = image(raw.optString("poster_path", raw.optString("poster"))),
            backdrop = image(raw.optString("backdrop_path", raw.optString("backdrop")), "w1280"),
            description = raw.optString("overview"),
            year = raw.optString("release_date", raw.optString("first_air_date")).take(4),
            imdbId = raw.optJSONObject("external_ids")?.optString("imdb_id")?.ifBlank { null },
            rating = raw.optDouble("vote_average", 0.0), popularity = raw.optDouble("popularity", 0.0),
        )
    }

    private fun mediaList(raw: Any, type: String? = null): List<Media> {
        val items = (raw as JSONObject).optJSONArray("results") ?: JSONArray()
        return (0 until items.length()).mapNotNull { i -> items.optJSONObject(i)?.let { media(it, type) } }.filter { it.id.isNotBlank() }
    }

    suspend fun discover(): List<Media> = mediaList(request("/api/tmdb/trending/all/day?language=vi-VN"))

    suspend fun discoverOptions(): Pair<List<DiscoverOption>, List<DiscoverOption>> {
        val genres = listOf("movie", "tv").flatMap { kind ->
            val array = (request("/api/tmdb/genre/$kind/list?language=vi-VN") as JSONObject).optJSONArray("genres") ?: JSONArray()
            (0 until array.length()).mapNotNull { array.optJSONObject(it) }.map { DiscoverOption(it.optString("id"), when (it.optInt("id")) { 10759 -> "Hành động & Phiêu lưu"; 10765 -> "Khoa học Viễn tưởng & Giả tưởng"; else -> it.optString("name") }) }
        }.distinctBy { it.id }.sortedBy { it.name }
        val countries = request("/api/tmdb/configuration/countries?language=vi-VN") as JSONArray
        val locale = java.util.Locale.forLanguageTag("vi-VN")
        return genres to (0 until countries.length()).mapNotNull { countries.optJSONObject(it) }.map {
            val code = it.optString("iso_3166_1")
            DiscoverOption(code, java.util.Locale("", code).getDisplayCountry(locale).ifBlank { it.optString("english_name") })
        }.filter { it.id.isNotBlank() }.sortedBy { it.name }
    }

    suspend fun discoverSection(filter: DiscoverFilter, section: String): List<Media> {
        val kinds = when (filter.category) { "movie" -> listOf("movie"); "tv" -> listOf("tv"); else -> listOf("movie", "tv") }
        val result = kinds.flatMap { kind ->
            mediaList(request(discoverPath(filter, section, kind)), if (kind == "tv") "show" else "movie")
        }
        return result.sortedByDescending { it.popularity }.take(20)
    }
    suspend fun logo(item: Media): String? {
        val kind = if (item.type == "show") "tv" else "movie"
        val raw = request("/api/tmdb/$kind/${encode(item.id)}?append_to_response=images&include_image_language=vi,en,null&language=vi-VN") as JSONObject
        val logos = raw.optJSONObject("images")?.optJSONArray("logos") ?: return null
        return (0 until logos.length()).mapNotNull { logos.optJSONObject(it) }
            .sortedBy { when (it.optString("iso_639_1")) { "vi" -> 0; "en" -> 1; else -> 2 } }
            .firstOrNull()?.optString("file_path")?.let { image(it, "w500") }
    }
    suspend fun search(query: String): List<Media> = mediaList(request("/api/tmdb/search/multi?query=${encode(query)}"))
    suspend fun details(item: Media): Pair<Media, List<Int>> {
        val kind = if (item.type == "show") "tv" else "movie"
        val raw = request("/api/tmdb/$kind/${encode(item.id)}?append_to_response=external_ids") as JSONObject
        val seasons = raw.optJSONArray("seasons") ?: JSONArray()
        return media(raw, item.type) to (0 until seasons.length()).mapNotNull { seasons.optJSONObject(it)?.optInt("season_number") }.filter { it > 0 }
    }
    suspend fun episodes(id: String, season: Int): List<Episode> {
        val raw = request("/api/tmdb/tv/${encode(id)}/season/$season") as JSONObject
        val episodes = raw.optJSONArray("episodes") ?: JSONArray()
        return (0 until episodes.length()).mapNotNull { episodes.optJSONObject(it) }.map {
            Episode(season, it.optInt("episode_number"), it.optString("name", "Tập ${it.optInt("episode_number")}"), image(it.optString("still_path"), "w500"))
        }
    }

    private fun libraryMedia(item: JSONObject): Media {
        val meta = item.optJSONObject("meta") ?: JSONObject()
        return Media(item.optString("tmdbId"), meta.optString("type", "movie"), meta.optString("title", "Untitled"), image(meta.optString("poster")))
    }
    suspend fun library(): List<LibraryItem> {
        val id = store.userId ?: return emptyList()
        val bookmarks = request("/users/${encode(id)}/bookmarks", auth = true) as JSONArray
        val progress = request("/users/${encode(id)}/progress", auth = true) as JSONArray
        val history = request("/users/${encode(id)}/watch-history", auth = true) as JSONArray
        val result = linkedMapOf<String, LibraryItem>()
        for (array in listOf(bookmarks, history, progress)) for (i in 0 until array.length()) {
            val row = array.optJSONObject(i) ?: continue
            val item = libraryMedia(row)
            val season = row.optJSONObject("season")?.optInt("number", -1)?.takeIf { it >= 0 }
            val episode = row.optJSONObject("episode")?.optInt("number", -1)?.takeIf { it >= 0 }
            result["${item.id}:${season ?: -1}:${episode ?: -1}"] = LibraryItem(item,
                row.optDouble("watched"), row.optDouble("duration"), season, episode)
        }
        return result.values.toList()
    }

    suspend fun bookmark(item: Media) {
        val id = store.userId ?: return
        request("/users/${encode(id)}/bookmarks/${encode(item.id)}", "POST", JSONObject()
            .put("tmdbId", item.id).put("meta", meta(item)), auth = true)
    }

    private fun meta(item: Media) = JSONObject().put("title", item.title).put("type", item.type)
        .put("year", item.year.toIntOrNull() ?: 0).also { value -> item.poster?.let { value.put("poster", it) } }

    suspend fun progress(item: Media, position: Double, duration: Double, episode: Episode?) {
        val id = store.userId ?: return
        if (duration <= 0 || position < 20) return
        val body = JSONObject().put("tmdbId", item.id).put("meta", meta(item))
            .put("duration", duration).put("watched", position)
        episode?.let { body.put("seasonId", it.season.toString()).put("episodeId", it.number.toString())
            .put("seasonNumber", it.season).put("episodeNumber", it.number) }
        request("/users/${encode(id)}/progress/${encode(item.id)}", "PUT", body, auth = true)
        request("/users/${encode(id)}/watch-history/${encode(item.id)}", "PUT", JSONObject(body.toString())
            .put("watchedAt", Instant.now().toString()), auth = true)
    }

    suspend fun settings(): JSONObject {
        val id = store.userId ?: return JSONObject()
        return request("/users/${encode(id)}/settings", auth = true) as JSONObject
    }
    suspend fun updateSettings(value: JSONObject) {
        val id = store.userId ?: return
        request("/users/${encode(id)}/settings", "PUT", value, auth = true)
    }
}

internal fun discoverPath(filter: DiscoverFilter, section: String, kind: String): String {
    if (section == "trending") return "/api/tmdb/trending/$kind/${filter.window}?language=vi-VN"
    val params = mutableListOf("language=vi-VN")
    fun encode(value: String) = URLEncoder.encode(value, "UTF-8")
    if (filter.country.isNotEmpty()) params += "with_origin_country=${encode(filter.country)}"
    if (filter.year.isNotEmpty()) params += "${if (kind == "movie") "primary_release_year" else "first_air_date_year"}=${encode(filter.year)}"
    if (filter.category.startsWith("genre:")) params += "with_genres=${encode(filter.category.substringAfter(':'))}"
    if (section == "netflix") { params += "with_watch_providers=8"; params += "watch_region=VN" }
    val filtered = filter.country.isNotEmpty() || filter.year.isNotEmpty() || filter.category.startsWith("genre:")
    val path = when {
        section == "netflix" || filtered -> "/discover/$kind"
        section == "top" -> "/$kind/top_rated"
        else -> "/$kind/popular"
    }
    if (filtered && section == "top") params += "sort_by=vote_average.desc&vote_count.gte=100"
    return "/api/tmdb$path?${params.joinToString("&")}"
}
