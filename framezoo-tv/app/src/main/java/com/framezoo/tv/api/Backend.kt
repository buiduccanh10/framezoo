package com.framezoo.tv.api

import com.framezoo.tv.BuildConfig
import com.framezoo.tv.auth.Auth
import com.framezoo.tv.model.*
import com.framezoo.tv.storage.SecureStore
import android.content.ContentResolver
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URI
import java.net.URLEncoder
import java.time.Instant

internal fun tmdbImageUrl(path: String?, size: String = "w500"): String? =
    path?.takeIf { it.isNotBlank() && it != "null" }?.let {
        if (it.startsWith("http")) it else "https://image.tmdb.org/t/p/$size$it"
    }

internal class HttpException(
    val statusCode: Int,
    val responseBody: String,
    message: String
) : IllegalStateException(message)

class Backend(private val store: SecureStore) {
    private val qualityCache = java.util.concurrent.ConcurrentHashMap<String, String>()
    private val libraryArtwork = java.util.concurrent.ConcurrentHashMap<String, Media>()
    private val libraryArtworkRequests = Semaphore(6)
    private val qualityRequests = Semaphore(6)
    private val guestTokenMutex = Mutex()
    private fun encode(value: String) = URLEncoder.encode(value, "UTF-8")
    private fun userAgentHeader() = "Framezoo-TV/${BuildConfig.VERSION_NAME} (Android TV ${Build.VERSION.RELEASE})"
    private fun isPublicGuestPath(path: String): Boolean {
        val clean = path.substringBefore('?')
        return clean == "/api/tmdb" ||
            clean.startsWith("/api/tmdb/") ||
            clean == "/api/skip-segments" ||
            clean == "/api/subtitle-align" ||
            clean.startsWith("/addon/subtitles/")
    }
    private fun secureUrl(value: String?): String? = value?.takeIf {
        try { val uri = URI(it); uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null } catch (_: Exception) { false }
    }
    private fun image(path: String?, size: String = "w500") = tmdbImageUrl(path, size)

    private suspend fun ensureGuestToken(): String? {
        val now = System.currentTimeMillis()
        store.guestToken?.takeIf { it.isNotBlank() && store.guestTokenExpiresAt - now > 30_000L }?.let { return it }
        return guestTokenMutex.withLock {
            val refreshedNow = System.currentTimeMillis()
            store.guestToken?.takeIf { it.isNotBlank() && store.guestTokenExpiresAt - refreshedNow > 30_000L }?.let { return@withLock it }
            try {
                val payload = JSONObject().apply {
                    store.guestId?.takeIf { it.isNotBlank() }?.let { put("guestId", it) }
                }
                val reply = request(
                    path = "/api/auth/guest",
                    method = "POST",
                    body = payload,
                    auth = false,
                    retry = false,
                    skipGuestToken = true
                ) as? JSONObject ?: return@withLock null
                val token = reply.optString("access_token").ifBlank { null } ?: return@withLock null
                val gid = reply.optString("guest_id", reply.optString("guestId")).ifBlank { null }
                val expiresInSec = reply.optLong("expires_in", 1800L).coerceAtLeast(60L)
                if (gid != null) store.guestId = gid
                store.guestToken = token
                store.guestTokenExpiresAt = System.currentTimeMillis() + expiresInSec * 1000L
                token
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                null
            }
        }
    }

    private suspend fun request(
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
        auth: Boolean = false,
        retry: Boolean = true,
        headers: Map<String, String> = emptyMap(),
        rawBody: String? = null,
        skipGuestToken: Boolean = false
    ): Any = withContext(Dispatchers.IO) {
        val base = store.backendUrl.trimEnd('/')
        require(base.startsWith("https://") || (BuildConfig.DEBUG && base.startsWith("http://"))) { "Backend URL phải dùng HTTPS" }
        val guestBearer = if (!auth && !skipGuestToken && store.accessToken.isNullOrBlank() && isPublicGuestPath(path)) {
            ensureGuestToken()
        } else {
            null
        }
        val payloadText = rawBody ?: body?.toString()
        val connection = (URL(base + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 20_000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("X-App-Version", BuildConfig.VERSION_NAME)
            setRequestProperty("User-Agent", userAgentHeader())
            headers.forEach { (k, v) -> setRequestProperty(k, v) }
            if (auth) {
                store.accessToken?.let { setRequestProperty("Authorization", "Bearer $it") }
            } else if (!guestBearer.isNullOrBlank()) {
                setRequestProperty("Authorization", "Bearer $guestBearer")
            }
            if (payloadText != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                outputStream.use { it.write(payloadText.toByteArray(Charsets.UTF_8)) }
            }
        }
        try {
            val status = connection.responseCode
            if (status == 401 && auth && retry) {
                if (refresh()) {
                    return@withContext request(path, method, body, auth, false, headers, rawBody)
                } else {
                    store.clearSession()
                }
            }
            val text = (if (status in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status !in 200..299) throw HttpException(status, text, "HTTP $status: ${text.take(180)}")
            when {
                text.trimStart().startsWith("[") -> JSONArray(text)
                text.trimStart().startsWith("{") -> JSONObject(text)
                else -> JSONObject()
            }
        } finally { connection.disconnect() }
    }

    private suspend fun refresh(): Boolean = try {
        val token = store.refreshToken ?: return false
        val reply = request("/oauth/token", "POST", JSONObject().put("grant_type", "refresh_token").put("refresh_token", token)) as JSONObject
        store.accessToken = reply.optString("access_token", reply.optString("accessToken"))
        store.refreshToken = reply.optString("refresh_token", reply.optString("refreshToken", token))
        !store.accessToken.isNullOrBlank()
    } catch (_: Exception) { false }

    private fun applyUserAndSession(reply: JSONObject, seedBytes: ByteArray? = null) {
        if (seedBytes != null) {
            store.userSeed = Auth.base64(seedBytes)
        }
        val oauth = reply.optJSONObject("oauth")
        if (oauth != null) {
            val token = oauth.optString("accessToken", oauth.optString("access_token"))
            if (token.isNotBlank()) store.accessToken = token
            val ref = oauth.optString("refreshToken", oauth.optString("refresh_token"))
            if (ref.isNotBlank()) store.refreshToken = ref
        }
        val sessionObj = reply.optJSONObject("session")
        if (sessionObj != null) {
            sessionObj.optString("id").takeIf { it.isNotBlank() }?.let { store.userSessionId = it }
            val sessionUser = sessionObj.optString("user", sessionObj.optString("userId"))
            if (sessionUser.isNotBlank() && store.userId.isNullOrBlank()) {
                store.userId = sessionUser
            }
            sessionObj.optString("device").takeIf { it.isNotBlank() }?.let { store.userDeviceName = it }
        }
        val userObj = reply.optJSONObject("user")
        if (userObj != null) {
            userObj.optString("id").takeIf { it.isNotBlank() }?.let { store.userId = it }
            userObj.optString("nickname").takeIf { it.isNotBlank() }?.let { store.userNickname = it }
            userObj.optString("email").takeIf { it.isNotBlank() && it != "null" }?.let { store.userEmail = it }
            val profileObj = userObj.optJSONObject("profile")
            if (profileObj != null) {
                profileObj.optString("colorA").takeIf { it.isNotBlank() }?.let { store.userProfileColorA = it }
                profileObj.optString("colorB").takeIf { it.isNotBlank() }?.let { store.userProfileColorB = it }
                profileObj.optString("icon").takeIf { it.isNotBlank() }?.let { store.userProfileIcon = it }
            }
        } else {
            reply.optString("user").takeIf { it.isNotBlank() && !it.startsWith("{") }?.let { store.userId = it }
        }
    }

    suspend fun login(identifier: String, password: String) {
        require(identifier.isNotBlank() && password.isNotBlank())
        val seed = Auth.seed(password)
        val key = Auth.key(password)
        val start = request("/auth/login/start", "POST", JSONObject().put("identifier", identifier.trim())) as JSONObject
        val challenge = start.getString("challenge")
        val encryptedDevice = runCatching { Auth.encryptData("FrameZoo TV", seed) }.getOrDefault("FrameZoo TV")
        val body = JSONObject()
            .put("namespace", "mobile")
            .put("identifier", identifier.trim())
            .put("publicKey", start.optString("publicKey").ifBlank { Auth.publicKey(key) })
            .put("challenge", JSONObject().put("code", challenge).put("signature", Auth.signature(key, challenge)))
            .put("device", encryptedDevice)
        val reply = request("/auth/login/complete", "POST", body) as JSONObject
        val oauth = reply.optJSONObject("oauth") ?: throw IllegalStateException("Backend không trả token")
        val token = oauth.optString("accessToken", oauth.optString("access_token"))
        require(token.isNotBlank()) { "Backend không trả access token" }
        applyUserAndSession(reply, seed)
        store.userDeviceName = encryptedDevice
        getMe()
    }

    suspend fun checkNicknameExists(nickname: String): Boolean = try {
        val reply = request("/nickname/${encode(nickname.trim())}/exists") as JSONObject
        reply.optBoolean("exists", false)
    } catch (_: Exception) {
        true
    }

    suspend fun checkEmailExists(email: String): Boolean = try {
        val reply = request("/auth/email/exists?email=${encode(email.trim())}") as JSONObject
        reply.optBoolean("exists", false)
    } catch (_: Exception) {
        false
    }

    private fun parseOtpChallenge(reply: JSONObject): OtpChallenge = OtpChallenge(
        challengeId = reply.optString("challengeId"),
        expiresIn = reply.optInt("expiresIn", 600),
        resendAfter = reply.optInt("resendAfter", 60),
        message = reply.optString("message")
    )

    suspend fun requestRegistrationOtp(email: String): OtpChallenge {
        val reply = request(
            path = "/auth/register/otp/request",
            method = "POST",
            body = JSONObject().put("email", email.trim()),
            headers = mapOf("Idempotency-Key" to java.util.UUID.randomUUID().toString())
        ) as JSONObject
        return parseOtpChallenge(reply)
    }

    suspend fun resendOtp(challengeId: String): OtpChallenge {
        val reply = request(
            path = "/auth/otp/resend",
            method = "POST",
            body = JSONObject().put("challengeId", challengeId),
            headers = mapOf("Idempotency-Key" to java.util.UUID.randomUUID().toString())
        ) as JSONObject
        return parseOtpChallenge(reply)
    }

    suspend fun register(
        nickname: String,
        email: String,
        password: String,
        colorA: String,
        colorB: String,
        icon: String,
        otpChallengeId: String? = null,
        otpCode: String? = null
    ) {
        val seed = Auth.seed(password)
        val key = Auth.key(password)
        val start = request("/auth/register/start", "POST", JSONObject()) as JSONObject
        val challenge = start.getString("challenge")
        val encryptedDevice = runCatching { Auth.encryptData("FrameZoo TV", seed) }.getOrDefault("FrameZoo TV")
        val profileJson = JSONObject()
            .put("colorA", colorA)
            .put("colorB", colorB)
            .put("icon", icon)
        val body = JSONObject()
            .put("namespace", "mobile")
            .put("publicKey", Auth.publicKey(key))
            .put("challenge", JSONObject().put("code", challenge).put("signature", Auth.signature(key, challenge)))
            .put("device", encryptedDevice)
            .put("nickname", nickname.trim())
            .put("email", email.trim())
            .put("profile", profileJson)
            .put(
                "legalConsent",
                JSONObject()
                    .put("acceptedTerms", true)
                    .put("acceptedPrivacy", true)
                    .put("ageConfirmed", true)
                    .put("termsVersion", "2026-11")
                    .put("privacyVersion", "2026-11")
                    .put("platform", "tv")
            )
        if (!otpChallengeId.isNullOrBlank() && !otpCode.isNullOrBlank()) {
            body.put("emailOtp", JSONObject().put("challengeId", otpChallengeId).put("code", otpCode.trim()))
        }
        val reply = request("/auth/register/complete", "POST", body) as JSONObject
        applyUserAndSession(reply, seed)
        if (store.accessToken.isNullOrBlank()) {
            login(nickname.trim(), password)
        }
    }

    suspend fun requestPasswordReset(email: String): OtpChallenge {
        val reply = request(
            path = "/auth/password/reset/request",
            method = "POST",
            body = JSONObject().put("email", email.trim()),
            headers = mapOf("Idempotency-Key" to java.util.UUID.randomUUID().toString())
        ) as JSONObject
        return parseOtpChallenge(reply)
    }

    suspend fun verifyPasswordReset(challengeId: String, code: String): String {
        val reply = request(
            path = "/auth/password/reset/verify",
            method = "POST",
            body = JSONObject().put("challengeId", challengeId).put("code", code.trim())
        ) as JSONObject
        val token = reply.optString("actionToken")
        require(token.isNotBlank()) { "Không nhận được mã xác thực đặt lại mật khẩu" }
        return token
    }

    suspend fun completePasswordReset(actionToken: String, email: String, newPassword: String) {
        val seed = Auth.seed(newPassword)
        val key = Auth.key(newPassword)
        val encryptedDevice = runCatching { Auth.encryptData("FrameZoo TV", seed) }.getOrDefault("FrameZoo TV")
        val reply = request(
            path = "/auth/password/reset/complete",
            method = "POST",
            body = JSONObject()
                .put("actionToken", actionToken)
                .put("newPublicKey", Auth.publicKey(key))
                .put("device", encryptedDevice)
        ) as JSONObject
        applyUserAndSession(reply, seed)
        if (store.accessToken.isNullOrBlank()) {
            login(email.trim(), newPassword)
        }
    }

    suspend fun editUser(
        nickname: String? = null,
        colorA: String? = null,
        colorB: String? = null,
        icon: String? = null
    ): JSONObject? {
        val id = store.userId ?: return null
        val body = JSONObject()
        if (!nickname.isNullOrBlank()) {
            body.put("nickname", nickname.trim())
        }
        if (!colorA.isNullOrBlank() && !colorB.isNullOrBlank() && !icon.isNullOrBlank()) {
            body.put(
                "profile",
                JSONObject()
                    .put("colorA", colorA)
                    .put("colorB", colorB)
                    .put("icon", icon)
            )
        }
        val reply = request("/users/${encode(id)}", "PATCH", body, auth = true) as JSONObject
        applyUserAndSession(reply)
        return reply.optJSONObject("user")
    }

    suspend fun deleteAccount() {
        val id = store.userId ?: return
        request("/users/${encode(id)}", "DELETE", auth = true)
        store.clearSession()
    }

    suspend fun exportAccountData(): JSONObject? {
        val id = store.userId ?: return null
        return request("/users/${encode(id)}/export", auth = true) as? JSONObject
    }

    suspend fun complianceBlocklist(): JSONObject =
        request("/compliance/blocklist", auth = false, skipGuestToken = true) as? JSONObject ?: JSONObject()

    suspend fun getSessions(): List<DeviceSession> {
        val id = store.userId ?: return emptyList()
        val rows = request("/users/${encode(id)}/sessions", auth = true) as JSONArray
        val currentSessionId = store.userSessionId
        val seedBase64 = store.userSeed
        return (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }.map { row ->
            resolveDeviceSession(
                id = row.optString("id"),
                userId = row.optString("userId", id),
                createdAt = row.optString("createdAt"),
                accessedAt = row.optString("accessedAt"),
                rawDevice = row.optString("device"),
                userAgent = row.optString("userAgent"),
                currentSessionId = currentSessionId,
                seedBase64 = seedBase64
            )
        }.sortedWith(compareByDescending<DeviceSession> { it.isCurrent }.thenByDescending { it.accessedAt })
    }

    suspend fun removeSession(sessionId: String) {
        if (sessionId.isBlank()) return
        request("/sessions/${encode(sessionId)}", "DELETE", auth = true)
    }

    suspend fun logoutCurrentSession() {
        val sessionId = store.userSessionId
        if (!sessionId.isNullOrBlank()) {
            runCatching { removeSession(sessionId) }
        }
        store.clearSession()
    }

    suspend fun requestPasswordChange(): OtpChallenge {
        val reply = request(
            path = "/auth/password/change/request",
            method = "POST",
            body = JSONObject(),
            auth = true,
            headers = mapOf("Idempotency-Key" to java.util.UUID.randomUUID().toString())
        ) as JSONObject
        return parseOtpChallenge(reply)
    }

    suspend fun completePasswordChange(challengeId: String, code: String, newPassword: String) {
        val seed = Auth.seed(newPassword)
        val key = Auth.key(newPassword)
        val encryptedDevice = runCatching { Auth.encryptData("FrameZoo TV", seed) }.getOrDefault("FrameZoo TV")
        val reply = request(
            path = "/auth/password/change/complete",
            method = "POST",
            body = JSONObject()
                .put("challengeId", challengeId)
                .put("code", code.trim())
                .put("newPublicKey", Auth.publicKey(key))
                .put("device", encryptedDevice),
            auth = true
        ) as JSONObject
        applyUserAndSession(reply, seed)
    }

    suspend fun requestEmailChange(newEmail: String): OtpChallenge {
        val reply = request(
            path = "/auth/email/change/request",
            method = "POST",
            body = JSONObject().put("newEmail", newEmail.trim()),
            auth = true,
            headers = mapOf("Idempotency-Key" to java.util.UUID.randomUUID().toString())
        ) as JSONObject
        return parseOtpChallenge(reply)
    }

    suspend fun verifyEmailChangeOld(challengeId: String, code: String): OtpChallenge {
        val reply = request(
            path = "/auth/email/change/verify-old",
            method = "POST",
            body = JSONObject().put("challengeId", challengeId).put("code", code.trim()),
            auth = true
        ) as JSONObject
        return parseOtpChallenge(reply)
    }

    suspend fun completeEmailChange(flowId: String, code: String) {
        val reply = request(
            path = "/auth/email/change/complete",
            method = "POST",
            body = JSONObject().put("flowId", flowId).put("code", code.trim()),
            auth = true
        ) as JSONObject
        applyUserAndSession(reply)
    }

    /** Mirrors desktop getRoomStatuses + host lookup in WatchPartyJoinDialog. */
    suspend fun watchPartyHost(roomCode: String): WatchPartyHost {
        val users = watchPartyUsers(roomCode)
        if (users.isEmpty()) throw WatchPartyException(WatchPartyError.EMPTY_ROOM)
        val host = users.firstOrNull { it.isHost }
            ?: throw WatchPartyException(WatchPartyError.NO_HOST)
        if (host.tmdbId.isBlank() || (host.isShow && (host.season == null || host.episode == null)))
            throw WatchPartyException(WatchPartyError.NO_HOST)
        return WatchPartyHost(
            tmdbId = host.tmdbId, title = host.title, isShow = host.isShow,
            season = host.season, episode = host.episode,
        )
    }

    internal suspend fun watchPartyUsers(roomCode: String): List<WatchPartyUser> =
        parseWatchPartyUsers(request("/api/player/status?roomCode=${encode(roomCode)}", auth = true) as JSONObject)

    internal suspend fun reportWatchParty(roomCode: String, isHost: Boolean, item: Media, episode: Episode?,
                                          playing: Boolean, paused: Boolean, loading: Boolean,
                                          time: Double, duration: Double, buffered: Double) {
        val id = requireNotNull(store.userId)
        val content = JSONObject().put("title", item.title).put("type", if (item.type == "show") "TV Show" else "Movie")
            .put("tmdbId", item.id.toLongOrNull() ?: item.id)
        episode?.let {
            content.put("seasonNumber", it.season).put("episodeNumber", it.number)
            it.seasonId.toLongOrNull()?.let { number -> content.put("seasonId", number) }
            it.id.toLongOrNull()?.let { number -> content.put("episodeId", number) }
        }
        val state = JSONObject().put("isPlaying", playing).put("isPaused", paused).put("isLoading", loading)
            .put("hasPlayedOnce", true).put("time", time).put("duration", duration).put("playbackRate", 1).put("buffered", buffered)
        request("/api/player/status", "POST", JSONObject().put("participantId", id).put("userId", id)
            .put("nickname", store.userNickname.orEmpty()).put("roomCode", roomCode).put("isHost", isHost)
            .put("content", content).put("player", state), auth = true)
    }

    suspend fun getMe(): JSONObject? = try {
        if (store.userId == null) null else {
            val reply = request("/users/@me", auth = true) as? JSONObject
            if (reply != null) {
                applyUserAndSession(reply)
            }
            reply?.optJSONObject("user")
        }
    } catch (_: Exception) { null }

    private fun media(raw: JSONObject, forcedType: String? = null): Media {
        val type = forcedType ?: if (raw.optString("media_type") == "tv") "show" else "movie"
        return Media(
            id = raw.optString("id", raw.optString("tmdbId")), type = type,
            title = raw.optString("title", raw.optString("name", "Untitled")),
            poster = image(raw.optString("poster_path", raw.optString("poster"))),
            backdrop = image(raw.optString("backdrop_path", raw.optString("backdrop")), "w1280"),
            description = raw.optString("overview"),
            year = raw.optString("release_date", raw.optString("first_air_date")).take(4),
            imdbId = raw.optJSONObject("external_ids")?.optString("imdb_id")?.ifBlank { null },
            rating = raw.optDouble("vote_average", 0.0), popularity = raw.optDouble("popularity", 0.0), voteCount = raw.optInt("vote_count", 0),
            originCountries = raw.optJSONArray("origin_country")?.let { a -> (0 until a.length()).map(a::optString) }
                ?: raw.optJSONArray("production_countries")?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it)?.optString("iso_3166_1") } } ?: emptyList(),
            releaseDate = raw.optString("release_date", raw.optString("first_air_date")), runtime = raw.optInt("runtime", 0),
            language = raw.optString("original_language"),
            genres = raw.optJSONArray("genres")?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it)?.optString("name") }.filter { it.isNotBlank() } } ?: emptyList(),
            genreIds = raw.optJSONArray("genre_ids")?.let { a -> (0 until a.length()).map(a::optString) }
                ?: raw.optJSONArray("genres")?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it)?.optString("id") } } ?: emptyList(),
            collectionId = raw.optJSONObject("belongs_to_collection")?.optString("id")?.ifBlank { null },
            collectionName = raw.optJSONObject("belongs_to_collection")?.optString("name")?.ifBlank { null },
            certification = (if (type == "movie") raw.optJSONObject("release_dates")?.optJSONArray("results") else raw.optJSONObject("content_ratings")?.optJSONArray("results"))?.let { regions ->
                (0 until regions.length()).mapNotNull(regions::optJSONObject).firstOrNull { it.optString("iso_3166_1") == "US" }?.let { region ->
                    if (type == "movie") region.optJSONArray("release_dates")?.optJSONObject(0)?.optString("certification") else region.optString("rating")
                }
            }.orEmpty(),
            originalTitle = raw.optString("original_title", raw.optString("original_name")),
        )
    }

    private fun mediaList(raw: Any, type: String? = null): List<Media> {
        val items = (raw as JSONObject).optJSONArray("results") ?: JSONArray()
        return (0 until items.length()).mapNotNull { i -> items.optJSONObject(i)?.takeIf {
            type != null || it.optString("media_type", "movie") in setOf("movie", "tv")
        }?.let { media(it, type) } }.filter { it.id.isNotBlank() }
    }

    suspend fun discover(): List<Media> = mediaList(request("/api/tmdb/trending/all/day?language=vi-VN"))

    suspend fun discoverOptions(): Pair<List<DiscoverOption>, List<DiscoverOption>> {
        val tmdbLang = if (store.language == "vi") "vi-VN" else "en-US"
        val genres = listOf("movie", "tv").flatMap { kind ->
            val array = (request("/api/tmdb/genre/$kind/list?language=$tmdbLang") as JSONObject).optJSONArray("genres") ?: JSONArray()
            (0 until array.length()).mapNotNull { array.optJSONObject(it) }.map {
                val id = it.optString("id")
                val name = if (store.language == "vi") {
                    when (it.optInt("id")) {
                        10759 -> "Phim Hành Động & Phiêu Lưu"
                        10762 -> "Phim Trẻ Em"
                        10763 -> "Tin Tức"
                        10764 -> "Truyền Hình Thực Tế"
                        10765 -> "Khoa Học Viễn Tưởng & Giả Tưởng"
                        10766 -> "Phim Truyền Hình Dài Tập"
                        10767 -> "Talk Show"
                        10768 -> "Chiến Tranh & Chính Trị"
                        else -> it.optString("name")
                    }
                } else it.optString("name")
                DiscoverOption(id, name)
            }
        }.distinctBy { it.id }
        val countries = request("/api/tmdb/configuration/countries?language=$tmdbLang") as JSONArray
        val locale = if (store.language == "vi") java.util.Locale.forLanguageTag("vi-VN") else java.util.Locale.US
        return genres to (0 until countries.length()).mapNotNull { countries.optJSONObject(it) }.map {
            val code = it.optString("iso_3166_1")
            DiscoverOption(code, java.util.Locale("", code).getDisplayCountry(locale).ifBlank { it.optString("english_name") })
        }.filter { it.id.isNotBlank() }.sortedBy { it.name }
    }

    suspend fun discoverSection(filter: DiscoverFilter, section: String, provider: String = "8", genre: String = "", page: Int = 1): List<Media> =
        discoverSectionPage(filter, section, provider, genre, page).first

    suspend fun discoverSectionPage(filter: DiscoverFilter, section: String, provider: String = "8", genre: String = "", page: Int = 1): Pair<List<Media>, Boolean> {
        if (section == "latest4k") {
            val ids = try {
                val raw = request("/discover/enrichment/feed?kind=latest4k") as JSONObject
                val values = raw.optJSONArray("movie_tmdb_ids") ?: JSONArray()
                (0 until values.length()).map { values.optString(it) }.filter { it.isNotBlank() }
            } catch (e: CancellationException) { throw e } catch (_: Exception) { emptyList() }
            if (ids.isNotEmpty()) return movieDetails(ids.take(50)) to false
            return discoverSectionPage(filter, "top", provider, genre, page)
        }
        val kinds = when (filter.category) { "movie" -> listOf("movie"); "tv" -> listOf("tv"); else -> listOf("movie", "tv") }
        val pages = coroutineScope { kinds.map { kind -> async {
            val raw = request(discoverPath(filter, section, kind, provider, genre, page)) as JSONObject
            mediaList(raw, if (kind == "tv") "show" else "movie") to (page < raw.optInt("total_pages", page))
        } }.awaitAll() }
        val result = pages.flatMap { it.first }
        val filtered = if (section == "trending") result.filter {
            (filter.year.isEmpty() || it.year == filter.year) && (filter.country.isEmpty() || filter.country in it.originCountries)
        } else result
        return (if (section == "latest") filtered.sortedByDescending { it.year } else filtered.sortedByDescending { it.popularity }) to pages.any { it.second }
    }
    suspend fun curatedLists(): List<CuratedList> {
        val rows = request("/discover/enrichment/curated") as JSONArray
        return (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }.mapNotNull { row ->
            val slug = row.optString("listSlug").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            val ids = row.optJSONArray("tmdbIds") ?: JSONArray()
            CuratedList(slug, row.optString("listName", slug), (0 until minOf(ids.length(), 50)).map { ids.optString(it) }.filter { it.isNotBlank() && it.all(Char::isDigit) })
        }
    }
    suspend fun movieDetails(ids: List<String>): List<Media> = coroutineScope {
        val limit = Semaphore(6)
        ids.map { id -> async { limit.withPermit {
            try { media(request("/api/tmdb/movie/${encode(id)}?language=vi-VN") as JSONObject, "movie") }
            catch (e: CancellationException) { throw e } catch (_: Exception) { null }
        } } }.awaitAll().filterNotNull()
    }
    suspend fun editorPicks(filter: DiscoverFilter, picks: List<Pair<String, String>>, page: Int = 1): List<Media> = coroutineScope {
        val kinds = when (filter.category) { "movie" -> setOf("movie"); "tv" -> setOf("show"); else -> setOf("movie", "show") }
        val limit = Semaphore(6)
        picks.filter { it.second in kinds }.drop((page - 1) * 20).take(20).map { (id, type) -> async {
          limit.withPermit { try {
                val kind = if (type == "show") "tv" else "movie"
                val raw = request("/api/tmdb/$kind/${encode(id)}?language=vi-VN") as JSONObject
                val countries = raw.optJSONArray("origin_country")
                val matchesCountry = filter.country.isEmpty() || (countries != null && (0 until countries.length()).any { countries.optString(it) == filter.country }) ||
                    (raw.optJSONArray("production_countries")?.let { a -> (0 until a.length()).any { a.optJSONObject(it)?.optString("iso_3166_1") == filter.country } } == true)
                val item = media(raw, type)
                item.takeIf { matchesCountry && (filter.year.isEmpty() || it.year == filter.year) }
            } catch (e: CancellationException) { throw e } catch (_: Exception) { null } }
        } }.awaitAll().filterNotNull()
    }
    suspend fun recommendations(item: Media): List<Media> {
        val kind = if (item.type == "show") "tv" else "movie"
        return mediaList(request("/api/tmdb/$kind/${encode(item.id)}/recommendations?language=vi-VN"), item.type)
    }
    suspend fun releaseQuality(item: Media): String? {
        if (item.type != "movie" || item.id.isBlank() || !item.id.all(Char::isDigit)) return item.releaseQuality
        qualityCache[item.id]?.let { return it.ifEmpty { null } }
        return qualityRequests.withPermit {
            qualityCache[item.id]?.let { return@withPermit it.ifEmpty { null } }
            val raw = request("/api/tmdb/movie/${encode(item.id)}?append_to_response=release_dates&language=vi-VN") as JSONObject
            val regions = raw.optJSONObject("release_dates")?.optJSONArray("results") ?: JSONArray()
            val dates = (0 until regions.length()).flatMap { index ->
                val region = regions.optJSONObject(index) ?: return@flatMap emptyList()
                val releases = region.optJSONArray("release_dates") ?: JSONArray()
                (0 until releases.length()).mapNotNull { i ->
                    val entry = releases.optJSONObject(i) ?: return@mapNotNull null
                    runCatching { ReleaseDate(region.optString("iso_3166_1"), entry.optInt("type"), Instant.parse(entry.getString("release_date"))) }.getOrNull()
                }
            }
            releaseQuality(dates).also { qualityCache[item.id] = it.orEmpty() }
        }
    }
    suspend fun trailer(item: Media): String? {
        val kind = if (item.type == "show") "tv" else "movie"
        for (language in listOf("vi-VN", "en-US")) {
            val raw = request("/api/tmdb/$kind/${encode(item.id)}/videos?language=$language") as JSONObject
            val videos = raw.optJSONArray("results") ?: JSONArray()
            val candidates = (0 until videos.length()).mapNotNull { videos.optJSONObject(it) }
                .filter { it.optString("site") == "YouTube" && it.optString("key").matches(Regex("[A-Za-z0-9_-]{11}")) }
                .sortedWith(compareByDescending<JSONObject> { it.optString("type") == "Trailer" }.thenByDescending { it.optBoolean("official") })
            candidates.firstOrNull()?.let { return it.getString("key") }
        }
        return null
    }
    suspend fun logo(item: Media): String? {
        val kind = if (item.type == "show") "tv" else "movie"
        val raw = request("/api/tmdb/$kind/${encode(item.id)}?append_to_response=images&include_image_language=vi,en,null&language=vi-VN") as JSONObject
        val logos = raw.optJSONObject("images")?.optJSONArray("logos") ?: return null
        return (0 until logos.length()).mapNotNull { logos.optJSONObject(it) }
            .sortedBy { when (it.optString("iso_639_1")) { "vi" -> 0; "en" -> 1; else -> 2 } }
            .firstOrNull()?.optString("file_path")?.let { image(it, "w500") }
    }
    suspend fun featuredRatings(item: Media): FeaturedRatings = coroutineScope {
        val kind = if (item.type == "show") "tv" else "movie"
        val raw = request("/api/tmdb/$kind/${encode(item.id)}?append_to_response=images,external_ids&include_image_language=vi,en,null&language=vi-VN") as JSONObject
        val logos = raw.optJSONObject("images")?.optJSONArray("logos") ?: JSONArray()
        val logo = (0 until logos.length()).mapNotNull { logos.optJSONObject(it) }
            .sortedBy { when (it.optString("iso_639_1")) { "vi" -> 0; "en" -> 1; else -> 2 } }
            .firstOrNull()?.optString("file_path")?.let { image(it, "w500") }
        val imdbId = raw.optJSONObject("external_ids")?.optString("imdb_id").orEmpty()
        suspend fun optional(path: String): JSONObject? = try { request(path) as? JSONObject }
            catch (e: CancellationException) { throw e } catch (_: Exception) { null }
        val imdb = async { if (imdbId.isNotBlank()) optional("/imdb/title?imdbId=${encode(imdbId)}&language=vi-VN") else null }
        val rt = async { optional("/rt/search?title=${encode(item.title)}${item.year.toIntOrNull()?.let { "&year=$it" }.orEmpty()}") }
        val imdbData = imdb.await(); val rtData = rt.await()
        FeaturedRatings(logo, imdbData?.optDouble("imdb_rating")?.takeIf { it.isFinite() },
            imdbData?.optLong("votes")?.takeIf { it > 0 }, rtData?.optString("tomatoIcon"),
            rtData?.optInt("tomatoScore", -1)?.takeIf { it >= 0 }, rtData?.optString("popcornIcon"),
            rtData?.optInt("popcornScore", -1)?.takeIf { it >= 0 },
            rtData?.optString("url")?.ifBlank { null }, rtData?.optString("popcornUrl")?.ifBlank { null },
            secureUrl(imdbData?.optString("trailer_url")),
            secureUrl(imdbData?.optString("trailer_thumbnail")))
    }
    suspend fun provider(item: Media): String? {
        val raw = request("/discover/enrichment/network?tmdbId=${encode(item.id)}&type=${encode(item.type)}") as JSONObject
        return raw.optJSONArray("platforms")?.optString(0)?.takeIf { it.isNotBlank() }
    }
    suspend fun search(query: String): List<Media> {
        val match = Regex("(?i)^tmdb:(\\d+)(?::(movie|tv))?$").matchEntire(query)
        if (match != null) {
            val kind = match.groupValues[2].lowercase().ifEmpty { "movie" }
            return listOf(media(request("/api/tmdb/$kind/${match.groupValues[1]}?language=vi-VN") as JSONObject, if (kind == "tv") "show" else "movie"))
        }
        return mediaList(request("/api/tmdb/search/multi?query=${encode(query)}&language=vi-VN"))
    }
    suspend fun enrichSearch(items: List<Media>): List<Media> = coroutineScope {
        val limit = Semaphore(6)
        items.map { item -> async { limit.withPermit {
            try {
                val kind = if (item.type == "show") "tv" else "movie"
                media(request("/api/tmdb/$kind/${encode(item.id)}?language=vi-VN") as JSONObject, item.type)
            } catch (e: CancellationException) { throw e } catch (_: Exception) { item }
        } } }.awaitAll()
    }
    suspend fun details(item: Media): Pair<Media, List<Int>> {
        val kind = if (item.type == "show") "tv" else "movie"
        val raw = request("/api/tmdb/$kind/${encode(item.id)}?language=vi-VN&append_to_response=external_ids,${if (item.type == "show") "content_ratings" else "release_dates"}") as JSONObject
        val seasons = raw.optJSONArray("seasons") ?: JSONArray()
        return media(raw, item.type) to (0 until seasons.length()).mapNotNull { seasons.optJSONObject(it)?.optInt("season_number") }.filter { it > 0 }
    }
    suspend fun similar(item: Media): List<Media> {
        val kind = if (item.type == "show") "tv" else "movie"
        return mediaList(request("/api/tmdb/$kind/${encode(item.id)}/similar?language=vi-VN"), item.type).take(12)
    }
    suspend fun collection(id: String): MediaCollection {
        val raw = request("/api/tmdb/collection/${encode(id)}?language=vi-VN") as JSONObject
        val parts = raw.optJSONArray("parts") ?: JSONArray()
        return MediaCollection(raw.optString("overview"), (0 until parts.length()).mapNotNull { parts.optJSONObject(it) }.map { media(it, "movie") }.sortedBy { it.releaseDate })
    }
    suspend fun cast(item: Media): List<CastMember> {
        val kind = if (item.type == "show") "tv" else "movie"
        val raw = request("/api/tmdb/$kind/${encode(item.id)}/credits?language=vi-VN") as JSONObject
        val cast = raw.optJSONArray("cast") ?: JSONArray()
        val crew = raw.optJSONArray("crew") ?: JSONArray()
        val director = (0 until crew.length()).mapNotNull { crew.optJSONObject(it) }.firstOrNull { it.optString("job") == "Director" }
        return (listOfNotNull(director) + (0 until cast.length()).mapNotNull { cast.optJSONObject(it) }.filter { it.optString("profile_path").isNotBlank() }.take(20)).map {
            CastMember(it.optString("id"), it.optString("name"), if (it === director) "Director" else it.optString("character"), image(it.optString("profile_path")))
        }
    }
    suspend fun trailers(item: Media): List<Trailer> {
        val kind = if (item.type == "show") "tv" else "movie"
        val raw = request("/api/tmdb/$kind/${encode(item.id)}/videos?language=en-US") as JSONObject
        val rows = raw.optJSONArray("results") ?: JSONArray()
        return (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }.filter {
            it.optString("site") == "YouTube" && it.optString("type") == "Trailer" && it.optString("key").matches(Regex("[A-Za-z0-9_-]{11}"))
        }.map { Trailer(it.getString("key"), it.optString("name", "Trailer")) }.take(6)
    }

    suspend fun skipSegments(item: Media, episode: Episode?): List<SkipSegment> {
        val query = buildString {
            append("/api/skip-segments?type=")
            append(encode(if (item.type == "show") "show" else "movie"))
            append("&tmdbId=").append(encode(item.id))
            if (item.type == "show" && episode != null) {
                append("&season=").append(episode.season)
                append("&episode=").append(episode.number)
            }
            item.imdbId?.takeIf { it.isNotBlank() }?.let { append("&imdbId=").append(encode(it)) }
        }
        val raw = request(query) as? JSONObject ?: return emptyList()
        val rows = raw.optJSONArray("segments") ?: return emptyList()
        return (0 until rows.length()).mapNotNull { index ->
            val row = rows.optJSONObject(index) ?: return@mapNotNull null
            val type = when (row.optString("type").lowercase()) {
                "intro", "recap", "credits", "preview" -> row.optString("type").lowercase()
                "outro" -> "credits"
                else -> return@mapNotNull null
            }
            val start = if (row.has("start_ms") && !row.isNull("start_ms")) row.optLong("start_ms") else null
            val end = if (row.has("end_ms") && !row.isNull("end_ms")) row.optLong("end_ms") else null
            if (start == null && end == null) null else SkipSegment(type, start, end)
        }
    }
    suspend fun episodes(id: String, season: Int): List<Episode> {
        val raw = request("/api/tmdb/tv/${encode(id)}/season/$season") as JSONObject
        val episodes = raw.optJSONArray("episodes") ?: JSONArray()
        return (0 until episodes.length()).mapNotNull { episodes.optJSONObject(it) }.map {
            val epNum = it.optInt("episode_number")
            val epName = it.optString("name").ifBlank { "Episode $epNum" }
            Episode(season, epNum, epName, image(it.optString("still_path"), "w500"), it.optString("id"), it.optString("overview"), it.optString("air_date"), raw.optString("id"))
        }
    }

    private fun libraryMedia(item: JSONObject): Media {
        val meta = item.optJSONObject("meta") ?: JSONObject()
        return Media(item.optString("tmdbId"), meta.optString("type", "movie"), meta.optString("title", "Untitled"), image(meta.optString("poster")), year = meta.optInt("year", 0).takeIf { it > 0 }?.toString().orEmpty())
    }
    private suspend fun artwork(item: Media): Media {
        if (!item.poster.isNullOrBlank() || item.id.isBlank()) return item
        val key = "${item.type}:${item.id}"
        val found = libraryArtwork[key] ?: libraryArtworkRequests.withPermit {
            libraryArtwork[key] ?: try {
                val kind = if (item.type == "show") "tv" else "movie"
                media(request("/api/tmdb/$kind/${encode(item.id)}?language=vi-VN") as JSONObject, item.type)
                    .also { if (!it.poster.isNullOrBlank()) libraryArtwork[key] = it }
            } catch (e: CancellationException) { throw e } catch (_: Exception) { item }
        }
        return item.copy(poster = found.poster, backdrop = item.backdrop ?: found.backdrop)
    }
    private suspend fun libraryItems(path: String): List<LibraryItem> = coroutineScope {
        val id = store.userId ?: return@coroutineScope emptyList()
        val rows = request("/users/${encode(id)}/$path", auth = true) as JSONArray
        (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }.map { row -> async {
            LibraryItem(artwork(libraryMedia(row)), row.optDouble("watched", 0.0), row.optDouble("duration", 0.0),
                row.optJSONObject("season")?.optInt("number", -1)?.takeIf { it >= 0 },
                row.optJSONObject("episode")?.optInt("number", -1)?.takeIf { it >= 0 }, row.optString("watchedAt"),
                row.optJSONObject("season")?.optString("id").orEmpty().takeUnless { it == "null" }.orEmpty(),
                row.optJSONObject("episode")?.optString("id").orEmpty().takeUnless { it == "null" }.orEmpty())
        } }.awaitAll()
    }
    suspend fun bookmarkDetails(): List<BookmarkDetails> = coroutineScope {
        val id = store.userId ?: return@coroutineScope emptyList()
        val rows = request("/users/${encode(id)}/bookmarks", auth = true) as JSONArray
        fun values(row: JSONObject, name: String): List<String> = row.optJSONArray(name)?.let { a -> (0 until a.length()).map(a::optString).filter(String::isNotBlank) } ?: emptyList()
        (0 until rows.length()).mapNotNull(rows::optJSONObject).map { row -> async {
            BookmarkDetails(artwork(libraryMedia(row)), values(row, "group"), values(row, "favoriteEpisodes"))
        } }.awaitAll()
    }
    suspend fun bookmarks(): List<Media> = bookmarkDetails().map { it.media }
    suspend fun bookmarkGroups(): List<String> {
        val id = store.userId ?: return emptyList()
        return try {
            val data = request("/users/${encode(id)}/group-order", auth = true) as JSONObject
            val groups = data.optJSONArray("groupOrder") ?: return emptyList()
            (0 until groups.length()).map(groups::optString).filter(String::isNotBlank)
        } catch (e: HttpException) {
            if (e.statusCode == 404) emptyList() else throw e
        }
    }
    suspend fun saveGroupOrder(groups: List<String>) {
        val id = store.userId ?: return
        request("/users/${encode(id)}/group-order", "PUT", rawBody = JSONArray(groups).toString(), auth = true)
    }
    suspend fun saveBookmarkDetails(item: Media, groups: List<String>, favorites: List<String>) {
        val id = requireNotNull(store.userId) { "Đăng nhập để lưu phim" }
        request("/users/${encode(id)}/bookmarks/${encode(item.id)}", "POST", JSONObject().put("tmdbId", item.id).put("meta", meta(item))
            .put("group", JSONArray(groups)).put("favoriteEpisodes", JSONArray(favorites)), auth = true)
    }
    suspend fun markEpisodeWatched(item: Media, episode: Episode, watched: Boolean, existing: LibraryItem?) {
        val id = requireNotNull(store.userId) { "Đăng nhập để đánh dấu tập phim" }
        require(episode.id.isNotBlank() && episode.seasonId.isNotBlank()) { "Thiếu thông tin tập phim" }
        val body = JSONObject().put("tmdbId", item.id).put("meta", meta(item)).put("duration", 60).put("watched", if (watched) 60 else 0)
            .put("seasonId", existing?.seasonId?.ifBlank { episode.seasonId } ?: episode.seasonId).put("episodeId", existing?.episodeId?.ifBlank { episode.id } ?: episode.id).put("seasonNumber", episode.season).put("episodeNumber", episode.number)
        request("/users/${encode(id)}/progress/${encode(item.id)}", "PUT", body, auth = true)
        request("/users/${encode(id)}/watch-history/${encode(item.id)}", "PUT", JSONObject(body.toString()).put("watchedAt", Instant.now().toString()).put("completed", watched), auth = true)
    }
    suspend fun markMovieWatched(item: Media, watched: Boolean) {
        val id = requireNotNull(store.userId) { "Đăng nhập để đánh dấu phim" }
        val body = JSONObject().put("tmdbId", item.id).put("meta", meta(item)).put("duration", 60).put("watched", if (watched) 60 else 0)
        request("/users/${encode(id)}/progress/${encode(item.id)}", "PUT", body, auth = true)
        request("/users/${encode(id)}/watch-history/${encode(item.id)}", "PUT", JSONObject(body.toString()).put("watchedAt", Instant.now().toString()).put("completed", watched), auth = true)
    }
    fun saveLocalProgress(item: Media, position: Double, duration: Double, episode: Episode?) {
        try {
            val raw = store.localProgress
            val arr = if (raw != null) JSONArray(raw) else JSONArray()
            val list = mutableListOf<JSONObject>()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                if (obj.optString("id") != item.id) {
                    list.add(obj)
                }
            }
            val newEntry = JSONObject().apply {
                put("id", item.id)
                put("title", item.title)
                put("type", item.type)
                put("year", item.year)
                put("poster", item.poster ?: "")
                put("position", position)
                put("duration", duration)
                if (episode != null) {
                    put("season", episode.season)
                    put("episode", episode.number)
                    put("seasonId", episode.seasonId)
                    put("episodeId", episode.id)
                }
            }
            list.add(0, newEntry)
            val trimmed = list.take(30)
            val resultArr = JSONArray()
            trimmed.forEach { resultArr.put(it) }
            store.localProgress = resultArr.toString()
        } catch (_: Exception) {}
    }

    fun loadLocalProgress(): List<LibraryItem> {
        val raw = store.localProgress ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            val list = mutableListOf<LibraryItem>()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                val media = Media(
                    id = obj.getString("id"),
                    title = obj.getString("title"),
                    type = obj.getString("type"),
                    year = obj.optString("year", ""),
                    poster = obj.optString("poster", "").takeIf { it.isNotBlank() }
                )
                val season = if (obj.has("season")) obj.getInt("season") else null
                val episode = if (obj.has("episode")) obj.getInt("episode") else null
                list.add(LibraryItem(
                    media = media,
                    position = obj.optDouble("position", 0.0),
                    duration = obj.optDouble("duration", 0.0),
                    season = season,
                    episode = episode
                ))
            }
            list
        } catch (_: Exception) { emptyList() }
    }

    suspend fun watchProgress(): List<LibraryItem> {
        val remote = if (store.userId != null) runCatching { libraryItems("progress") }.getOrDefault(emptyList()) else emptyList()
        val local = loadLocalProgress()
        return (remote + local).distinctBy { "${it.media.id}:${it.season}:${it.episode}" }
    }
    suspend fun library(): List<LibraryItem> {
        val id = store.userId ?: return emptyList()
        val bookmarks = request("/users/${encode(id)}/bookmarks", auth = true) as JSONArray
        val progress = request("/users/${encode(id)}/progress", auth = true) as JSONArray
        val history = request("/users/${encode(id)}/watch-history", auth = true) as JSONArray
        val result = linkedMapOf<String, LibraryItem>()
        for (array in listOf(bookmarks, history, progress)) for (i in 0 until array.length()) {
            val row = array.optJSONObject(i) ?: continue
            val item = libraryMedia(row)
            val season = row.optJSONObject("season")?.optInt("number", -1)?.takeIf { it >= 0 }
            val episode = row.optJSONObject("episode")?.optInt("number", -1)?.takeIf { it >= 0 }
            result["${item.id}:${season ?: -1}:${episode ?: -1}"] = LibraryItem(item,
                row.optDouble("watched"), row.optDouble("duration"), season, episode)
        }
        return result.values.toList()
    }

    suspend fun watchHistory(): List<LibraryItem> = libraryItems("watch-history").sortedByDescending { it.watchedAt }

    suspend fun removeHistory(tmdbId: String) {
        val id = store.userId ?: return
        request("/users/${encode(id)}/watch-history/${encode(tmdbId)}", "DELETE", null, auth = true)
    }

    suspend fun removeProgress(tmdbId: String) {
        try {
            val raw = store.localProgress
            if (raw != null) {
                val arr = JSONArray(raw)
                val result = JSONArray()
                for (i in 0 until arr.length()) {
                    val obj = arr.getJSONObject(i)
                    if (obj.optString("id") != tmdbId) {
                        result.put(obj)
                    }
                }
                store.localProgress = result.toString()
            }
        } catch (_: Exception) {}
        val id = store.userId ?: return
        request("/users/${encode(id)}/progress/${encode(tmdbId)}", "DELETE", null, auth = true)
    }

    suspend fun bookmark(item: Media, remove: Boolean = false) {
        val id = requireNotNull(store.userId) { "Đăng nhập để lưu phim" }
        request("/users/${encode(id)}/bookmarks/${encode(item.id)}", if (remove) "DELETE" else "POST",
            if (remove) null else JSONObject().put("tmdbId", item.id).put("meta", meta(item)), auth = true)
    }

    private fun meta(item: Media) = JSONObject().put("title", item.title).put("type", item.type)
        .put("year", item.year.toIntOrNull() ?: 0).also { value -> item.poster?.let { value.put("poster", it) } }

    suspend fun progress(item: Media, position: Double, duration: Double, episode: Episode?) {
        if (duration <= 0 || position < 20) return
        saveLocalProgress(item, position, duration, episode)
        val id = store.userId ?: return
        val body = JSONObject().put("tmdbId", item.id).put("meta", meta(item))
            .put("duration", duration).put("watched", position)
        episode?.let { body.put("seasonId", it.season.toString()).put("episodeId", it.number.toString())
            .put("seasonNumber", it.season).put("episodeNumber", it.number) }
        request("/users/${encode(id)}/progress/${encode(item.id)}", "PUT", body, auth = true)
        request("/users/${encode(id)}/watch-history/${encode(item.id)}", "PUT", JSONObject(body.toString())
            .put("watchedAt", Instant.now().toString()), auth = true)
    }

    suspend fun metaTidbAvailability(): Boolean = try {
        (request("/meta") as? JSONObject)?.optBoolean("hasTIDBSubmission", false) == true
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        false
    }

    suspend fun submitSkipSegment(
        item: Media,
        episode: Episode?,
        segmentType: String,
        startSec: Double?,
        endSec: Double?
    ) = withContext(Dispatchers.IO) {
        val payload = buildTidbSubmissionPayload(item, episode, segmentType, startSec, endSec)
        val tidbKey = store.tidbKey?.trim()?.takeIf { it.isNotBlank() }
        try {
            request("/api/skip-segments/submit", "POST", payload)
            return@withContext
        } catch (e: HttpException) {
            if (!shouldFallbackToClientTidbKey(e.statusCode, tidbKey)) {
                val parsed = runCatching { JSONObject(e.responseBody) }.getOrNull()
                val msg = parsed?.optString("statusMessage")?.ifBlank { null }
                    ?: parsed?.optString("message")?.ifBlank { null }
                    ?: (e.message ?: "Failed to submit segment")
                val details = parsed?.optJSONObject("data")?.optString("details")?.ifBlank { null }
                throw TidbSubmissionException(msg, e.statusCode, details)
            }
        }
        val key = tidbKey ?: throw TidbSubmissionException("TIDB API key is not set")
        val connection = (URL("https://api.theintrodb.org/v1/submit").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15_000
            readTimeout = 20_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer $key")
            outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
        }
        try {
            val status = connection.responseCode
            val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                val parsed = runCatching { JSONObject(text) }.getOrNull()
                val err = parsed?.optString("error")?.ifBlank { null } ?: "HTTP $status"
                val details = parsed?.optString("details")?.ifBlank { null }
                throw TidbSubmissionException(err, status, details)
            }
        } finally {
            connection.disconnect()
        }
    }

    suspend fun settings(): JSONObject {
        val id = store.userId ?: return JSONObject()
        return request("/users/${encode(id)}/settings", auth = true) as JSONObject
    }
    suspend fun feedback(
        title: String,
        description: String,
        attachments: List<Uri>,
        resolver: ContentResolver,
        contact: String? = null
    ) = withContext(Dispatchers.IO) {
        val subject = title.trim(); val message = description.trim()
        val trimmedContact = contact?.trim()?.take(255).orEmpty()
        val isGuest = store.userId == null
        require(subject.isNotBlank() && subject.length <= 255 && message.isNotBlank()) { "Nhập tiêu đề tối đa 255 ký tự và nội dung phản hồi" }
        if (isGuest) {
            require(trimmedContact.isNotBlank()) { "Vui lòng nhập email hoặc số điện thoại để chúng tôi phản hồi" }
        }
        if (trimmedContact.isNotBlank()) {
            val isEmail = trimmedContact.matches(Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$"))
            val isPhone = trimmedContact.replace(Regex("[\\s().-]"), "").matches(Regex("^\\+?\\d{7,15}$"))
            require(isEmail || isPhone) { "Thông tin liên hệ phải là email hoặc số điện thoại hợp lệ" }
        }
        require(attachments.all { it.scheme == "content" }) { "File đính kèm không hợp lệ" }
        val token = store.accessToken ?: ensureGuestToken()
        val boundary = "framezoo-${java.util.UUID.randomUUID()}"
        val connection = (URL(store.backendUrl.trimEnd('/') + "/api/feedback").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; connectTimeout = 15_000; readTimeout = 60_000; doOutput = true
            setChunkedStreamingMode(8192); setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            setRequestProperty("X-App-Version", BuildConfig.VERSION_NAME)
            setRequestProperty("User-Agent", userAgentHeader())
            token?.let { setRequestProperty("Authorization", "Bearer $it") }
        }
        try {
            connection.outputStream.use { out ->
                fun write(value: String) = out.write(value.toByteArray(Charsets.UTF_8))
                fun field(name: String, value: String) { write("--$boundary\r\nContent-Disposition: form-data; name=\"$name\"\r\n\r\n$value\r\n") }
                field("title", subject); field("description", message)
                if (trimmedContact.isNotBlank()) field("contact", trimmedContact)
                var total = 0L
                attachments.forEachIndexed { index, uri ->
                    val type = resolver.getType(uri).orEmpty()
                    require(type.matches(Regex("(?i)(image|video)/[a-z0-9.+-]+"))) { "Chỉ hỗ trợ ảnh và video" }
                    val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                        if (cursor.moveToFirst()) cursor.getString(0) else null
                    }.orEmpty().replace(Regex("[^A-Za-z0-9._-]"), "_").take(120).ifBlank { "attachment-$index" }
                    write("--$boundary\r\nContent-Disposition: form-data; name=\"files\"; filename=\"$name\"\r\nContent-Type: $type\r\n\r\n")
                    val input = requireNotNull(resolver.openInputStream(uri)) { "Không mở được file đính kèm" }
                    input.use {
                        val buffer = ByteArray(8192)
                        while (true) {
                            val count = it.read(buffer); if (count < 0) break
                            total += count; require(total <= 55L * 1024 * 1024) { "Tổng dung lượng file không được vượt quá 55 MB" }
                            out.write(buffer, 0, count)
                        }
                    }
                    write("\r\n")
                }
                write("--$boundary--\r\n")
            }
            if (connection.responseCode !in 200..299) {
                val body = connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
                throw IllegalStateException(runCatching { JSONObject(body).optString("message") }.getOrDefault("").ifBlank { "Gửi phản hồi thất bại (HTTP ${connection.responseCode})" })
            }
        } finally { connection.disconnect() }
    }
    suspend fun updateSettings(value: JSONObject) {
        val id = store.userId ?: return
        request("/users/${encode(id)}/settings", "PUT", value, auth = true)
    }
}

internal fun discoverPath(filter: DiscoverFilter, section: String, kind: String, provider: String = "8", genre: String = "", page: Int = 1): String {
    require(page > 0)
    val params = mutableListOf("language=vi-VN")
    fun encode(value: String) = URLEncoder.encode(value, "UTF-8")
    if (page > 1) params += "page=$page"
    if (section == "trending") return "/api/tmdb/trending/$kind/${filter.window}?${params.joinToString("&")}"
    if (filter.country.isNotEmpty()) params += "with_origin_country=${encode(filter.country)}"
    if (filter.year.isNotEmpty()) params += "${if (kind == "movie") "primary_release_year" else "first_air_date_year"}=${encode(filter.year)}"
    val selectedGenre = filter.category.takeIf { it.startsWith("genre:") }?.substringAfter(':') ?: genre
    if (selectedGenre.isNotEmpty()) params += "with_genres=${encode(selectedGenre)}"
    if (section == "netflix" || section == "provider") { params += "with_watch_providers=${encode(provider)}"; params += if (section == "netflix") "watch_region=VN" else "watch_region=US" }
    val filtered = filter.country.isNotEmpty() || filter.year.isNotEmpty() || selectedGenre.isNotEmpty()
    val path = when {
        section == "provider" || section == "netflix" || filtered -> "/discover/$kind"
        section == "top" -> "/$kind/top_rated"
        section == "latest" -> if (kind == "movie") "/movie/now_playing" else "/tv/on_the_air"
        else -> "/$kind/popular"
    }
    if (filtered && section == "top") params += "sort_by=vote_average.desc&vote_count.gte=100"
    if (filtered && section == "latest") params += if (kind == "movie") "sort_by=primary_release_date.desc" else "sort_by=first_air_date.desc"
    return "/api/tmdb$path?${params.joinToString("&")}"
}
