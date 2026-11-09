package com.framezoo.tv

import com.framezoo.tv.model.parseWatchPartyCode
import com.framezoo.tv.model.parseWatchPartyUsers
import com.framezoo.tv.model.watchPartySyncTime
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WatchPartyTest {
    @Test fun blankIsNull() = assertNull(parseWatchPartyCode("   "))
    @Test fun plainCodeIsUppercased() = assertEquals("ABCD123456", parseWatchPartyCode(" abcd123456 "))
    @Test fun extractsCodeFromLink() =
        assertEquals("ABCD123456", parseWatchPartyCode("https://framezoo.app/media/tmdb-movie-1?x=1&watchparty=abcd123456"))
    @Test fun linkWithoutCodeIsNull() = assertNull(parseWatchPartyCode("https://framezoo.app/media/tmdb-movie-1"))

    @Test fun usesLatestPresenceAndPredictsHostPlayback() {
        val users = parseWatchPartyUsers(JSONObject("""{"users":{"host":[
          {"isHost":true,"timestamp":1000,"content":{"tmdbId":5,"type":"TV Show","seasonNumber":1,"episodeNumber":1},"player":{"time":1}},
          {"isHost":true,"timestamp":2000,"content":{"tmdbId":5,"type":"TV Show","seasonNumber":2,"episodeNumber":3},"player":{"isPlaying":true,"time":10,"duration":100}}
        ]}}"""))
        val host = users.single()
        assertEquals("host", host.participantId)
        assertEquals(2, host.season)
        assertEquals(3, host.episode)
        assertEquals(12.0, watchPartySyncTime(host, 0.0, false, 4000)!!, 0.001)
        assertNull(watchPartySyncTime(host, 11.0, false, 4000))
        assertEquals(12.0, watchPartySyncTime(host, 12.0, true, 4000)!!, 0.001)
        assertEquals(10.0, watchPartySyncTime(host.copy(paused = true), 15.0, false, 4000)!!, 0.001)
    }
}
