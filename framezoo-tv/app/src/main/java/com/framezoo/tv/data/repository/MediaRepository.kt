package com.framezoo.tv.data.repository

import android.content.Context
import com.framezoo.tv.api.Backend
import com.framezoo.tv.model.*
import org.json.JSONObject

class MediaRepository(
    private val context: Context,
    private val backend: Backend
) {
    private val discoverData by lazy {
        JSONObject(context.assets.open("discover.json").bufferedReader().use { it.readText() })
    }

    private val editorPicksList: List<Pair<String, String>> by lazy {
        listOf("MOVIES_DATA", "TV_SHOWS_DATA").flatMap { key ->
            val arr = discoverData.getJSONArray(key)
            (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                obj.getString("id") to (if (key == "MOVIES_DATA") "movie" else "show")
            }
        }
    }

    fun providersFor(category: String): List<DiscoverOption> = when (category) {
        "all" -> options("DISCOVER_PROVIDERS_ALL")
        "movie" -> options("DISCOVER_PROVIDERS_MOVIES")
        "tv" -> options("DISCOVER_PROVIDERS_SHOWS")
        else -> emptyList()
    }

    private fun options(key: String): List<DiscoverOption> = discoverData.getJSONArray(key).let { data ->
        (0 until data.length()).map { i ->
            val obj = data.getJSONObject(i)
            DiscoverOption(obj.getString("id"), obj.getString("name"))
        }
    }

    suspend fun discover(): List<Media> = backend.discover()

    suspend fun discoverOptions(): Pair<List<DiscoverOption>, List<DiscoverOption>> = backend.discoverOptions()

    suspend fun discoverSection(filter: DiscoverFilter, section: String, provider: String = "8", genre: String = ""): List<Media> {
        if (section == "editor") return backend.editorPicks(filter, editorPicksList)
        return backend.discoverSection(filter, section, provider, genre)
    }

    suspend fun discoverSectionPage(filter: DiscoverFilter, section: String, provider: String = "8", genre: String = "", page: Int = 1): Pair<List<Media>, Boolean> {
        if (section == "editor") {
            val items = backend.editorPicks(filter, editorPicksList, page)
            return items to (items.size >= 20)
        }
        return backend.discoverSectionPage(filter, section, provider, genre, page)
    }

    suspend fun editorPicks(filter: DiscoverFilter, page: Int = 1): List<Media> =
        backend.editorPicks(filter, editorPicksList, page)

    suspend fun recommendations(item: Media): List<Media> = backend.recommendations(item)

    suspend fun search(query: String): List<Media> = backend.search(query)

    suspend fun enrichSearch(items: List<Media>): List<Media> = backend.enrichSearch(items)

    suspend fun details(item: Media): Pair<Media, List<Int>> = backend.details(item)

    suspend fun episodes(id: String, season: Int): List<Episode> = backend.episodes(id, season)

    suspend fun cast(item: Media): List<CastMember> = backend.cast(item)

    suspend fun trailers(item: Media): List<Trailer> = backend.trailers(item)

    suspend fun featuredRatings(item: Media): FeaturedRatings = backend.featuredRatings(item)

    suspend fun collection(id: String): MediaCollection = backend.collection(id)

    suspend fun curatedLists(): List<CuratedList> = backend.curatedLists()

    suspend fun movieDetails(ids: List<String>): List<Media> = backend.movieDetails(ids)
}
