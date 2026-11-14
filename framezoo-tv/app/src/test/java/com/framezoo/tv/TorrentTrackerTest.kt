package com.framezoo.tv

import com.framezoo.tv.player.parseCompactPeersFromBencode
import org.junit.Assert.assertEquals
import org.junit.Test

class TorrentTrackerTest {

    @Test
    fun parsesCompactIpv4AndIpv6PeersWithFilteringAndDeduplication() {
        val ipv4 = byteArrayOf(
            0, 0, 0, 1, 0x1A, 0xE1.toByte(), // invalid 0.0.0.1
            127, 0, 0, 1, 0x1A, 0xE1.toByte(), // loopback skipped
            8, 8, 8, 8, 0x1A, 0xE1.toByte(), // 8.8.8.8:6881
            8, 8, 8, 8, 0x1A, 0xE1.toByte() // duplicate skipped
        )
        val ipv6 = byteArrayOf(
            // 2001:0db8:0000:0000:0000:0000:0000:0001 : 51413 (0xC8D5)
            0x20, 0x01, 0x0d, 0xb8.toByte(), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
            0xC8.toByte(), 0xD5.toByte(),
            // ::1 : 6881 (loopback skipped)
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
            0x1A, 0xE1.toByte()
        )
        val payload = "d8:intervali1800e5:peers${ipv4.size}:".toByteArray(Charsets.ISO_8859_1) +
            ipv4 +
            "6:peers6${ipv6.size}:".toByteArray(Charsets.ISO_8859_1) +
            ipv6 +
            "e".toByteArray(Charsets.ISO_8859_1)

        val peers = parseCompactPeersFromBencode(payload)
        assertEquals(
            listOf(
                "8.8.8.8" to 6881,
                "2001:db8:0:0:0:0:0:1" to 51413
            ),
            peers
        )
    }

    @Test
    fun parsesDictionaryPeerListAndHandlesMalformedPayload() {
        val dictPayload = "d5:peersld2:ip9:1.1.1.1  4:porti6881eed2:ip7:9.9.9.94:porti51413eed2:ip9:127.0.0.14:porti6881eed2:ip7:5.5.5.54:porti0eeee".toByteArray(Charsets.ISO_8859_1)
        assertEquals(
            listOf("1.1.1.1" to 6881, "9.9.9.9" to 51413),
            parseCompactPeersFromBencode(dictPayload)
        )
        assertEquals(emptyList<Pair<String, Int>>(), parseCompactPeersFromBencode("invalid".toByteArray()))
    }
}
