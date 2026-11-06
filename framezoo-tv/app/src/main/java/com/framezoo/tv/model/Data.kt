package com.framezoo.tv.model


data class Media(
    val id: String,
    val type: String,
    val title: String,
    val poster: String? = null,
    val backdrop: String? = null,
    val description: String = "",
    val year: String = "",
    val imdbId: String? = null,
    val addonManifest: String? = null,
    val rating: Double = 0.0,
    val popularity: Double = 0.0,
)

data class Episode(val season: Int, val number: Int, val title: String, val still: String? = null)
data class Addon(val manifestUrl: String, val id: String, val name: String, val resources: Set<String>, val enabled: Boolean = true)
data class Stream(
    val name: String,
    val url: String,
    val infoHash: String? = null,
    val fileIdx: Int? = null,
    val filename: String? = null,
    val headers: Map<String, String> = emptyMap(),
    val subtitles: List<Subtitle> = emptyList(),
)
data class Subtitle(val language: String, val url: String, val label: String = "")
data class LibraryItem(val media: Media, val position: Double = 0.0, val duration: Double = 0.0,
    val season: Int? = null, val episode: Int? = null)

fun mapPiece(byteOffset: Long, pieceLength: Int): Int {
    require(byteOffset >= 0 && pieceLength > 0)
    return (byteOffset / pieceLength).toInt()
}

data class DiscoverOption(val id: String, val name: String)
data class DiscoverFilter(val category: String = "all", val country: String = "", val year: String = "", val window: String = "day")
