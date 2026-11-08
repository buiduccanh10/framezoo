package com.framezoo.tv

import com.framezoo.tv.model.parseWatchPartyCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WatchPartyTest {
    @Test fun blankIsNull() = assertNull(parseWatchPartyCode("   "))
    @Test fun plainCodeIsUppercased() = assertEquals("ABCD123456", parseWatchPartyCode(" abcd123456 "))
    @Test fun extractsCodeFromLink() =
        assertEquals("ABCD123456", parseWatchPartyCode("https://framezoo.app/media/tmdb-movie-1?x=1&watchparty=abcd123456"))
    @Test fun linkWithoutCodeIsNull() = assertNull(parseWatchPartyCode("https://framezoo.app/media/tmdb-movie-1"))
}
