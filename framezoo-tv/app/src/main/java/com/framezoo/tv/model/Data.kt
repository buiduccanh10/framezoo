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
    val voteCount: Int = 0,
    val originCountries: List<String> = emptyList(),
    val releaseQuality: String? = null,
    val releaseDate: String = "",
    val runtime: Int = 0,
    val language: String = "",
    val genres: List<String> = emptyList(),
    val genreIds: List<String> = emptyList(),
    val collectionId: String? = null,
    val collectionName: String? = null,
    val certification: String = "",
)

data class FeaturedRatings(
    val logo: String? = null,
    val imdbRating: Double? = null,
    val imdbVotes: Long? = null,
    val tomatoIcon: String? = null,
    val tomatoScore: Int? = null,
    val audienceIcon: String? = null,
    val audienceScore: Int? = null,
    val tomatoUrl: String? = null,
    val audienceUrl: String? = null,
    val trailerUrl: String? = null,
    val trailerThumbnail: String? = null,
)

data class BookmarkDetails(val media: Media, val groups: List<String>, val favoriteEpisodes: List<String>)

data class Episode(val season: Int, val number: Int, val title: String, val still: String? = null, val id: String = "", val overview: String = "", val airDate: String = "", val seasonId: String = "")
data class Addon(
    val manifestUrl: String,
    val id: String,
    val name: String,
    val resources: Set<String>,
    val enabled: Boolean = true,
    val version: String? = null,
    val description: String? = null,
    val logo: String? = null,
    val isNative: Boolean = false
)
data class AddonCatalog(val manifestUrl: String, val addonName: String, val type: String, val id: String, val items: List<Media>) {
    val key: String get() = "addon:$manifestUrl:$type:$id"
}
data class Stream(
    val name: String,
    val url: String,
    val infoHash: String? = null,
    val fileIdx: Int? = null,
    val filename: String? = null,
    val headers: Map<String, String> = emptyMap(),
    val subtitles: List<Subtitle> = emptyList(),
    val title: String = "",
    val description: String = "",
    val videoSize: Long? = null,
    val addonId: String = "",
    val addonName: String = "",
    val addonLogo: String? = null,
    val bingeGroup: String? = null
)
data class Subtitle(val language: String, val url: String, val label: String = "")
data class SkipSegment(
    val type: String,
    val startMs: Long?,
    val endMs: Long?
)
data class LibraryItem(val media: Media, val position: Double = 0.0, val duration: Double = 0.0,
    val season: Int? = null, val episode: Int? = null, val watchedAt: String = "", val seasonId: String = "", val episodeId: String = "")

fun mapPiece(byteOffset: Long, pieceLength: Int): Int {
    require(byteOffset >= 0 && pieceLength > 0)
    return (byteOffset / pieceLength).toInt()
}

data class DiscoverOption(val id: String, val name: String)
data class DiscoverFilter(val category: String = "all", val country: String = "", val year: String = "", val window: String = "day")
data class CuratedList(val slug: String, val name: String, val ids: List<String>)
data class CastMember(val id: String, val name: String, val role: String, val image: String?)
data class Trailer(val key: String, val name: String, val isImdb: Boolean = false, val thumbnail: String? = null)
data class MediaCollection(val overview: String, val parts: List<Media>)
