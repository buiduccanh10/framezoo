package com.framezoo.tv

import com.framezoo.tv.api.buildBackendSettingsJson
import com.framezoo.tv.api.buildTidbSubmissionPayload
import com.framezoo.tv.api.parseBackendSettingsJson
import com.framezoo.tv.api.shouldFallbackToClientTidbKey
import com.framezoo.tv.model.BookmarkDetails
import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.Media
import com.framezoo.tv.model.UserIcon
import com.framezoo.tv.ui.DEFAULT_HOME_SECTION_ORDER
import com.framezoo.tv.ui.computeBookmarkGroupDelete
import com.framezoo.tv.ui.computeBookmarkGroupRename
import com.framezoo.tv.ui.formatBookmarkGroup
import com.framezoo.tv.ui.mergeAndOrderBookmarkGroups
import com.framezoo.tv.ui.moveListItem
import com.framezoo.tv.ui.normalizeHomeSectionOrder
import com.framezoo.tv.ui.parseBookmarkGroup
import com.framezoo.tv.ui.parseFlexibleTimestampToSec
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsAndTidbTest {
    private val validThemes = setOf("default", "teal", "blue", "red", "custom")

    @Test
    fun settingsSyncRoundTripMapsNullThemeToDefaultAndValidatesCustomTheme() {
        val json = buildBackendSettingsJson(
            applicationLanguage = "en",
            applicationTheme = "default",
            defaultSubtitleLanguage = "vi",
            enableAutoplay = false,
            enableSkipCredits = true,
            enableAutoSkipSegments = true,
            customPrimary = "teal",
            customSecondary = "blue",
            customTertiary = "red"
        )
        assertTrue(json.isNull("applicationTheme"))

        val parsed = parseBackendSettingsJson(json, validThemes)
        assertEquals("en", parsed.applicationLanguage)
        assertEquals("default", parsed.applicationTheme)
        assertEquals("vi", parsed.defaultSubtitleLanguage)
        assertEquals(false, parsed.enableAutoplay)
        assertEquals(true, parsed.enableSkipCredits)
        assertEquals(true, parsed.enableAutoSkipSegments)
        assertEquals("teal", parsed.customPrimary)
        assertEquals("blue", parsed.customSecondary)
        assertEquals("red", parsed.customTertiary)

        val invalidThemeObj = JSONObject().put("applicationTheme", "unknown_theme")
        assertEquals("default", parseBackendSettingsJson(invalidThemeObj, validThemes).applicationTheme)
    }

    @Test
    fun tidbSubmissionValidatesTypesTimestampsAndFallbackStatuses() {
        val movie = Media(id = "550", type = "movie", title = "Fight Club")
        val creditsPayload = buildTidbSubmissionPayload(
            item = movie,
            episode = null,
            segmentType = "credits",
            startSec = 7800.0,
            endSec = null
        )
        assertEquals(550, creditsPayload.getInt("tmdb_id"))
        assertEquals("movie", creditsPayload.getString("type"))
        assertTrue(creditsPayload.isNull("end_sec"))

        val show = Media(id = "1396", type = "show", title = "Breaking Bad")
        val ep = Episode(season = 1, number = 1, title = "Pilot")
        val introPayload = buildTidbSubmissionPayload(show, ep, "intro", null, 88.5)
        assertEquals("tv", introPayload.getString("type"))
        assertEquals(1, introPayload.getInt("season"))
        assertEquals(1, introPayload.getInt("episode"))
        assertTrue(introPayload.isNull("start_sec"))
        assertEquals(88.5, introPayload.getDouble("end_sec"), 0.001)

        val rejected = runCatching { buildTidbSubmissionPayload(movie, null, "intro", 10.0, null) }
        assertTrue(rejected.isFailure)

        assertTrue(shouldFallbackToClientTidbKey(404, "key_123"))
        assertTrue(shouldFallbackToClientTidbKey(503, "key_123"))
        assertFalse(shouldFallbackToClientTidbKey(400, "key_123"))
        assertFalse(shouldFallbackToClientTidbKey(404, "   "))
    }

    @Test
    fun bookmarkGroupsAndHomeSectionOrderHelpersPreserveAndReorderCorrectly() {
        val formatted = formatBookmarkGroup(UserIcon.FIRE, "Action")
        assertEquals("[FIRE]Action", formatted)
        val parsed = parseBookmarkGroup(formatted)
        assertEquals(UserIcon.FIRE, parsed.icon)
        assertEquals("Action", parsed.name)

        val m1 = Media(id = "1", type = "movie", title = "One")
        val m2 = Media(id = "2", type = "movie", title = "Two")
        val details = listOf(
            BookmarkDetails(m1, listOf(formatted, "Watchlist"), emptyList()),
            BookmarkDetails(m2, listOf("Comedy"), emptyList())
        )
        val merged = mergeAndOrderBookmarkGroups(listOf("Comedy", formatted), details)
        assertEquals(listOf("Comedy", formatted, "Watchlist"), merged)

        val (renamedDetails, renamedOrder) = computeBookmarkGroupRename(details, merged, "Comedy", "[FILM]Funny")
        assertEquals(1, renamedDetails.size)
        assertEquals(listOf("[FILM]Funny"), renamedDetails.first().groups)
        assertEquals(listOf("[FILM]Funny", formatted, "Watchlist"), renamedOrder)

        val (deletedDetails, deletedOrder) = computeBookmarkGroupDelete(details, merged, formatted)
        assertEquals(listOf("Watchlist"), deletedDetails.first().groups)
        assertEquals(listOf("Comedy", "Watchlist"), deletedOrder)

        assertEquals(listOf("b", "a", "c"), moveListItem(listOf("a", "b", "c"), 1, 0))

        val normalizedSections = normalizeHomeSectionOrder(listOf("providers", "addon:torrentio", "top-rated", "providers"))
        assertEquals(listOf("provider", "addon:torrentio", "top"), normalizedSections.take(3))
        assertTrue(DEFAULT_HOME_SECTION_ORDER.all { it in normalizedSections })
    }

    @Test
    fun parseFlexibleTimestampToSecSupportsSecondsMmSsAndHhMmSs() {
        assertEquals(null, parseFlexibleTimestampToSec("   "))
        assertEquals(95.5, parseFlexibleTimestampToSec("95.5")!!, 0.001)
        assertEquals(95.5, parseFlexibleTimestampToSec("95,5")!!, 0.001)
        assertEquals(150.0, parseFlexibleTimestampToSec("2:30")!!, 0.001)
        assertEquals(3740.0, parseFlexibleTimestampToSec("1:02:20")!!, 0.001)
        assertTrue(parseFlexibleTimestampToSec("1:99")?.isNaN() == true)
        assertTrue(parseFlexibleTimestampToSec("-5")?.isNaN() == true)
        assertTrue(parseFlexibleTimestampToSec("abc")?.isNaN() == true)
    }
}
