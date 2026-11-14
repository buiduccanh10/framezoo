package com.framezoo.tv.player

import java.net.ServerSocket
import java.net.URLDecoder
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SubtitleTranslationTest {

    @Test
    fun translatesBatchWithSingleFallbackAndReconstructsVtt() = runBlocking {
        var requests = 0
        val server = ServerSocket(0)
        val worker = thread(isDaemon = true) {
            while (!server.isClosed) {
                val socket = try { server.accept() } catch (_: Exception) { break }
                socket.use {
                    val reader = it.getInputStream().bufferedReader()
                    var contentLen = 0
                    while (true) {
                        val line = reader.readLine() ?: break
                        if (line.isEmpty()) break
                        if (line.startsWith("Content-Length:", ignoreCase = true)) {
                            contentLen = line.substringAfter(':').trim().toIntOrNull() ?: 0
                        }
                    }
                    val buf = CharArray(contentLen)
                    var read = 0
                    while (read < contentLen) {
                        val count = reader.read(buf, read, contentLen - read)
                        if (count <= 0) break
                        read += count
                    }
                    val rawBody = String(buf, 0, read)
                    val q = URLDecoder.decode(rawBody.removePrefix("q="), "UTF-8")
                    requests++
                    val payload = if ("[[FZT_9918]]" in q) {
                        // Force mismatch so fallback-to-single path is exercised
                        """[[["Corrupted split",null,null,null]]]"""
                    } else {
                        val translated = when (q) {
                            "Hello" -> "Xin chao"
                            "World" -> "The gioi"
                            else -> q
                        }
                        """[[["$translated","$q",null,null]]]"""
                    }
                    val bytes = payload.toByteArray(Charsets.UTF_8)
                    it.getOutputStream().write(
                        ("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n")
                            .toByteArray() + bytes
                    )
                }
            }
        }
        try {
            val srt = """1
00:00:01,000 --> 00:00:02,000
Hello

2
00:00:03,000 --> 00:00:04,500
World
"""
            val translator = GoogleSubtitleTranslator("http://127.0.0.1:${server.localPort}/translate")
            val vtt1 = translator.translateSubtitleText(srt, "vi")
            assertTrue(vtt1.startsWith("WEBVTT"))
            assertTrue(vtt1.contains("00:00:01.000 --> 00:00:02.000\nXin chao"))
            assertTrue(vtt1.contains("00:00:03.000 --> 00:00:04.500\nThe gioi"))
            val callsAfterFirst = requests
            assertEquals(3, callsAfterFirst)

            // Second call hits in-memory translation cache with zero network requests.
            val vtt2 = translator.translateSubtitleText(srt, "vi")
            assertEquals(vtt1, vtt2)
            assertEquals(callsAfterFirst, requests)
        } finally {
            server.close()
            worker.join(1000)
        }
    }
}
