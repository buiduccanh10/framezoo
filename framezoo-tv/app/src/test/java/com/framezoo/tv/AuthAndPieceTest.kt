package com.framezoo.tv

import com.framezoo.tv.auth.Auth
import com.framezoo.tv.model.mapPiece
import org.junit.Assert.assertEquals
import org.junit.Test

class AuthAndPieceTest {
    @Test fun loginVectorMatchesMobile() {
        val key = Auth.key("correct horse battery staple")
        assertEquals("h_73RkyU6DvKcBl3qDkbkYxLgM06v3xBEc7kgcrSQX0", Auth.publicKey(key))
        assertEquals("3j_AJ7GoQutrXz4viOqA77KhovEuG4bqabqreDW0wryBocP8WzoiIFjlgPPANVCvB_pnjufhYX2XCG5x14dDDA", Auth.signature(key, "framezoo-tv-test"))
    }

    @Test fun mapsBoundaryBytesToPieces() {
        assertEquals(0, mapPiece(0, 4 * 1024 * 1024))
        assertEquals(0, mapPiece(4L * 1024 * 1024 - 1, 4 * 1024 * 1024))
        assertEquals(1, mapPiece(4L * 1024 * 1024, 4 * 1024 * 1024))
    }
}
