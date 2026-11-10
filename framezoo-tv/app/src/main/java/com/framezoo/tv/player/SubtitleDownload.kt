package com.framezoo.tv.player

import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

// ponytail: external subtitle files are limited to 32 MiB; raise this if larger text tracks are needed.
internal fun downloadSubtitle(url: String, directory: File, headers: Map<String, String>, mediaUrl: String): File {
    val maxBytes = 32L * 1024 * 1024
    val media = runCatching { URI(mediaUrl) }.getOrNull()
    var current = URL(url)
    repeat(6) { redirect ->
        require(current.protocol == "http" || current.protocol == "https")
        val conn = current.openConnection() as HttpURLConnection
        try {
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 10_000
            conn.readTimeout = 15_000
            if (media != null && current.host.equals(media.host, true) && current.protocol.equals(media.scheme, true) && (if (current.port == -1) current.defaultPort else current.port) == (if (media.port == -1) current.defaultPort else media.port)) {
                headers.forEach { (name, value) -> conn.setRequestProperty(name, value) }
            }
            val status = conn.responseCode
            if (status in listOf(301, 302, 303, 307, 308)) {
                check(redirect < 5)
                current = URL(current, conn.getHeaderField("Location") ?: error("Missing redirect location"))
                return@repeat
            }
            check(status in 200..299)
            check(conn.contentLengthLong <= maxBytes)
            directory.mkdirs()
            val extension = current.path.substringAfterLast('.', "").lowercase().takeIf { it.matches(Regex("[a-z0-9]{1,5}")) } ?: "sub"
            val output = File.createTempFile("subtitle-", ".$extension", directory)
            try {
                conn.inputStream.use { input -> output.outputStream().use { out ->
                    val buffer = ByteArray(8192)
                    var total = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        check(total <= maxBytes)
                        out.write(buffer, 0, count)
                    }
                } }
                return output
            } catch (e: Exception) {
                output.delete()
                throw e
            }
        } finally { conn.disconnect() }
    }
    error("Too many redirects")
}
