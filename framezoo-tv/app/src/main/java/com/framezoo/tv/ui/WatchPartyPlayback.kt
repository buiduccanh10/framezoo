package com.framezoo.tv.ui

import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import com.framezoo.tv.api.Backend
import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.Media
import com.framezoo.tv.model.Stream
import com.framezoo.tv.model.watchPartySyncTime
import com.framezoo.tv.player.PlayerController
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

@Composable
internal fun WatchPartyPlayback(state: FrameZooState, player: PlayerController, backend: Backend,
                                item: Media, episode: Episode?, stream: Stream?, ready: Boolean,
                                onSelectEpisode: ((Episode) -> Unit)?) {
    val room = state.activeWatchParty
    val hostMode = state.watchPartyIsHost
    val selectEpisode by rememberUpdatedState(onSelectEpisode)
    LaunchedEffect(room, hostMode, item.id, episode?.season, episode?.number, stream, ready) {
        if (room != null) state.watchPartyConnected = false
        if (room == null || stream == null || !ready) return@LaunchedEffect
        var missingHostSince: Long? = null
        while (isActive) {
            try {
                suspend fun publish() {
                    fun valid(value: Double) = value.takeIf { it.isFinite() && it >= 0.0 } ?: 0.0
                    val paused = player.paused()
                    backend.reportWatchParty(room, hostMode, item, episode, !paused, paused,
                        player.propertyString("paused-for-cache") == "yes", valid(player.position()),
                        valid(player.duration()), valid(player.propertyDouble("demuxer-cache-duration")))
                }
                if (hostMode) publish()
                val users = backend.watchPartyUsers(room)
                state.watchPartyUsers = users
                if (!hostMode) {
                    val host = users.firstOrNull { it.isHost }
                    if (host == null) {
                        state.watchPartyConnected = false
                        val now = SystemClock.elapsedRealtime()
                        if (missingHostSince == null) missingHostSince = now
                        if (now - missingHostSince >= 4000) {
                            state.leaveWatchParty(state.i18n.t("watchParty.noHost"))
                            return@LaunchedEffect
                        }
                    } else {
                        missingHostSince = null
                        if (host.tmdbId != item.id || host.isShow != (item.type == "show")) {
                            state.leaveWatchParty(state.i18n.t("watchParty.contentMismatch"))
                            return@LaunchedEffect
                        }
                        if (host.isShow && host.season != null && host.episode != null &&
                            (host.season != episode?.season || host.episode != episode?.number)) {
                            val target = backend.episodes(item.id, host.season).firstOrNull { it.number == host.episode }
                            if (target != null && selectEpisode != null) {
                                selectEpisode?.invoke(target)
                                return@LaunchedEffect
                            }
                            state.leaveWatchParty(state.i18n.t("watchParty.episodeMismatch"))
                            return@LaunchedEffect
                        }
                        val paused = player.paused()
                        val target = watchPartySyncTime(host, player.position(), paused, System.currentTimeMillis())
                        if (target != null && player.propertyString("paused-for-cache") != "yes") {
                            player.command("seek", target.toString(), "absolute+exact")
                            player.command("set", "pause", if (host.playing && !host.paused) "no" else "yes")
                        }
                        publish()
                        state.watchPartyConnected = true
                        state.watchPartyNotice = null
                    }
                } else {
                    state.watchPartyConnected = true
                    state.watchPartyNotice = null
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Retry a failed request; never treat a network failure as a missing host.
                missingHostSince = null
                state.watchPartyConnected = false
                state.watchPartyNotice = state.i18n.t("watchParty.invalidRoom")
            }
            delay(1000)
        }
    }
}
