package com.framezoo.tv.player

import java.net.ServerSocket
import java.nio.file.Files
import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SubtitleDownloadTest {
    @Test fun downloadsRedirectsAndRejectsErrorsAndOversizedFiles() {
        val server = ServerSocket(0)
        val worker = thread(isDaemon = true) {
            while (!server.isClosed) {
                val socket = try { server.accept() } catch (_: Exception) { break }
                socket.use {
                    val request = it.getInputStream().bufferedReader().readLine()
                    val response = when (request.split(" ").getOrNull(1)) {
                        "/redirect" -> "HTTP/1.1 302 Found\r\nLocation: /subtitle\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        "/subtitle" -> "HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\nsubtitle"
                        "/large" -> "HTTP/1.1 200 OK\r\nContent-Length: 34603008\r\nConnection: close\r\n\r\n"
                        else -> "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    }
                    it.getOutputStream().write(response.toByteArray())
                }
            }
        }
        val directory = Files.createTempDirectory("subtitle-test").toFile()
        try {
            val base = "http://127.0.0.1:${server.localPort}"
            assertEquals("subtitle", downloadSubtitle("$base/redirect", directory, emptyMap(), base).readText())
            assertThrows(Exception::class.java) { downloadSubtitle("$base/missing", directory, emptyMap(), base) }
            assertThrows(Exception::class.java) { downloadSubtitle("$base/large", directory, emptyMap(), base) }
            assertEquals(1, directory.listFiles()?.size)
        } finally {
            server.close()
            worker.join(1000)
            directory.deleteRecursively()
        }
    }
}
