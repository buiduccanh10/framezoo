package com.framezoo.tv.ui

import android.view.KeyEvent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.framezoo.tv.R
import com.framezoo.tv.api.MAX_TIDB_TIME_SECONDS
import com.framezoo.tv.api.TIDB_SEGMENT_TYPES
import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.Media
import com.framezoo.tv.model.SkipSegment
import com.framezoo.tv.player.AudioOutputMode
import com.framezoo.tv.player.AudioTrack
import com.framezoo.tv.player.PlayerController
import com.framezoo.tv.player.SubtitleSyncStage
import com.framezoo.tv.player.TRANSLATION_TARGET_LANGUAGES
import com.framezoo.tv.player.TranslationTargetLanguage
import com.framezoo.tv.player.audioTrackDisplayTitle
import java.util.Locale
import kotlinx.coroutines.launch

/**
 * Parses seconds (`150`), `mm:ss` (`2:30`), or `hh:mm:ss` (`1:42:20`).
 * Returns null if empty/blank, or Double.NaN if malformed/out of range.
 */
internal fun parseFlexibleTimestampToSec(raw: String): Double? {
    val clean = raw.trim()
    if (clean.isEmpty()) return null

    Regex("^(\\d{1,2}):(0?[0-5]\\d):(0?[0-5]\\d)$").matchEntire(clean)?.let { m ->
        val h = m.groupValues[1].toIntOrNull() ?: return Double.NaN
        val min = m.groupValues[2].toIntOrNull() ?: return Double.NaN
        val sec = m.groupValues[3].toIntOrNull() ?: return Double.NaN
        return (h * 3600 + min * 60 + sec).toDouble()
    }
    Regex("^(\\d{1,3}):(0?[0-5]\\d)$").matchEntire(clean)?.let { m ->
        val min = m.groupValues[1].toIntOrNull() ?: return Double.NaN
        val sec = m.groupValues[2].toIntOrNull() ?: return Double.NaN
        return (min * 60 + sec).toDouble()
    }
    if (':' in clean) return Double.NaN
    val parsed = clean.replace(',', '.').toDoubleOrNull() ?: return Double.NaN
    if (!parsed.isFinite() || parsed < 0.0 || parsed > MAX_TIDB_TIME_SECONDS) return Double.NaN
    return parsed
}

@Composable
internal fun PlayerAudioOverlayContent(
    state: FrameZooState,
    player: PlayerController,
    audioTracks: List<AudioTrack>,
    firstRequester: FocusRequester,
    onBack: () -> Unit,
    onClose: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val mainText = colors["video.context.type.main"]
    val secondaryText = colors["video.context.type.secondary"]
    val modeItems = listOf(
        Triple(
            AudioOutputMode.AUTO,
            t("player.menus.audio.modes.auto"),
            t("player.menus.audio.modes.autoDesc")
        ),
        Triple(
            AudioOutputMode.STEREO_DIALOGUE,
            t("player.menus.audio.modes.stereoDialogue"),
            t("player.menus.audio.modes.stereoDialogueDesc")
        ),
        Triple(
            AudioOutputMode.PASSTHROUGH,
            t("player.menus.audio.modes.passthrough"),
            t("player.menus.audio.modes.passthroughDesc")
        )
    )

    Column(modifier = Modifier.fillMaxSize()) {
        PlayerMenuHeader(
            title = t("player.menus.settings.audioItem"),
            onBack = onBack,
            backModifier = Modifier.focusRequester(firstRequester)
        )
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(top = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            item {
                Text(
                    text = t("player.menus.audio.modeSection"),
                    color = secondaryText,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp)
                )
            }
            items(modeItems.size) { idx ->
                val (mode, title, desc) = modeItems[idx]
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    PlayerMenuRowLink(
                        title = title,
                        selected = state.audioOutputMode == mode,
                        onClick = { state.updateAudioOutputMode(mode) }
                    )
                    Text(
                        text = desc,
                        color = secondaryText,
                        fontSize = 11.5.sp,
                        lineHeight = 15.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(horizontal = 12.dp)
                    )
                }
            }
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                        .height(1.dp)
                        .background(colors["video.context.border"])
                )
                Text(
                    text = t("player.menus.audio.tracksSection"),
                    color = secondaryText,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 4.dp)
                )
            }
            if (audioTracks.isEmpty()) {
                item {
                    Text(
                        text = t("player.menus.audio.default"),
                        color = mainText.copy(alpha = 0.7f),
                        fontSize = 13.sp,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                    )
                }
            } else {
                itemsIndexed(audioTracks) { _, track ->
                    PlayerMenuRowLink(
                        title = audioTrackDisplayTitle(track),
                        selected = track.selected,
                        onClick = {
                            if (player.command("set", "aid", track.id) >= 0) onClose()
                        }
                    )
                }
            }
        }
    }
}

@Composable
internal fun PlayerTranslateOverlayContent(
    sourceLanguage: String,
    isTranslating: Boolean,
    progressDone: Int,
    progressTotal: Int,
    errorText: String,
    firstRequester: FocusRequester,
    onBack: () -> Unit,
    onCancelTranslate: () -> Unit,
    onSelectTarget: (TranslationTargetLanguage) -> Unit
) {
    val colors = LocalFrameZooColors.current
    val secondaryText = colors["video.context.type.secondary"]
    val focusManager = LocalFocusManager.current
    var query by remember { mutableStateOf("") }

    val sourceDisplay = remember(sourceLanguage) {
        val code = subtitleLanguage(sourceLanguage)
        if (code == "und") sourceLanguage.uppercase()
        else Locale.forLanguageTag(code).getDisplayLanguage(Locale.getDefault())
            .replaceFirstChar { it.uppercase() }.ifBlank { code.uppercase() }
    }
    val filtered = remember(query) {
        val q = query.trim()
        if (q.isEmpty()) TRANSLATION_TARGET_LANGUAGES
        else TRANSLATION_TARGET_LANGUAGES.filter {
            it.name.contains(q, ignoreCase = true) || it.code.contains(q, ignoreCase = true)
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        PlayerMenuHeader(
            title = t("player.menus.subtitles.translate.title", "language" to sourceDisplay),
            onBack = onBack,
            backModifier = Modifier.focusRequester(firstRequester)
        )
        if (errorText.isNotBlank()) {
            Text(
                text = errorText,
                color = colors["type.danger"],
                fontSize = 12.5.sp,
                modifier = Modifier.padding(top = 6.dp)
            )
        }
        if (isTranslating) {
            Spacer(Modifier.height(14.dp))
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(colors["video.context.buttons.list"])
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                CircularProgressIndicator(
                    color = colors["video.context.type.accent"],
                    modifier = Modifier.size(28.dp),
                    strokeWidth = 2.5.dp
                )
                val pct = if (progressTotal > 0) (progressDone * 100 / progressTotal).coerceIn(0, 100) else 0
                Text(
                    text = if (progressTotal > 0) "$pct% ($progressDone/$progressTotal)" else "…",
                    color = Color.White,
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.Medium
                )
                TvButton(label = t("onboarding.defaultConfirm.cancel"), navigation = true) {
                    onCancelTranslate()
                }
            }
        } else {
            BasicTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                textStyle = TextStyle(color = Color.White, fontSize = 14.sp),
                cursorBrush = SolidColor(Color.White),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp, bottom = 6.dp)
                    .background(colors["video.context.border"], RoundedCornerShape(6.dp))
                    .onPreviewKeyEvent { event ->
                        if (event.nativeKeyEvent.action == KeyEvent.ACTION_DOWN &&
                            event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_DOWN
                        ) focusManager.moveFocus(FocusDirection.Down) else false
                    }
                    .padding(10.dp),
                decorationBox = { inner ->
                    Box {
                        if (query.isEmpty()) {
                            Text(t("player.menus.subtitles.searchPlaceholder"), color = secondaryText, fontSize = 14.sp)
                        }
                        inner()
                    }
                }
            )
            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                itemsIndexed(filtered, key = { _, lang -> lang.code }) { _, lang ->
                    PlayerMenuRowLink(
                        title = lang.name,
                        rightText = lang.code.uppercase(),
                        onClick = { onSelectTarget(lang) }
                    )
                }
            }
        }
    }
}

@Composable
internal fun SubtitleSyncHudBanner(
    stage: SubtitleSyncStage?,
    step: Int,
    total: Int,
    statusMessage: String?,
    isError: Boolean,
    modifier: Modifier = Modifier,
    onCancel: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val visible = stage != null || !statusMessage.isNullOrBlank()
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(),
        exit = fadeOut(),
        modifier = modifier
    ) {
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .background(colors["video.context.background"].copy(alpha = 0.94f))
                .border(
                    BorderStroke(
                        1.dp,
                        if (isError) colors["type.danger"] else colors["video.context.border"]
                    ),
                    RoundedCornerShape(50)
                )
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (stage != null) {
                CircularProgressIndicator(
                    color = colors["video.context.type.accent"],
                    modifier = Modifier.size(18.dp),
                    strokeWidth = 2.dp
                )
                val label = when (stage) {
                    SubtitleSyncStage.EXTRACTING -> "${t("player.menus.subtitles.syncStageSample")} ($step/$total)"
                    SubtitleSyncStage.ANALYZING -> t("player.menus.subtitles.syncPhaseCorrelate")
                    SubtitleSyncStage.APPLYING -> t("player.menus.subtitles.syncSubtitleApplying")
                }
                Text(
                    text = label,
                    color = Color.White,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium
                )
                TvButton(label = t("onboarding.defaultConfirm.cancel"), navigation = true, onClick = onCancel)
            } else if (!statusMessage.isNullOrBlank()) {
                Icon(
                    painter = painterResource(if (isError) R.drawable.desktop_close else R.drawable.desktop_checkmark),
                    contentDescription = null,
                    tint = if (isError) colors["type.danger"] else colors["video.context.type.accent"],
                    modifier = Modifier.size(16.dp)
                )
                Text(
                    text = statusMessage,
                    color = Color.White,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium
                )
            }
        }
    }
}

@Composable
internal fun TidbSkipSubmitOverlayContent(
    state: FrameZooState,
    item: Media,
    episode: Episode?,
    currentPositionSec: Double,
    firstRequester: FocusRequester,
    onBack: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val scope = rememberCoroutineScope()
    val secondaryText = colors["video.context.type.secondary"]
    var segmentType by remember { mutableStateOf("intro") }
    var startText by remember { mutableStateOf("") }
    var endText by remember { mutableStateOf("") }
    var errorText by remember { mutableStateOf("") }
    var successText by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize()) {
        PlayerMenuHeader(
            title = t("player.skipTime.submitSegment"),
            onBack = onBack,
            backModifier = Modifier.focusRequester(firstRequester)
        )
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(top = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Text(
                    text = t("player.skipTime.feedback.modal.segmentType"),
                    color = secondaryText,
                    fontSize = 12.sp
                )
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TIDB_SEGMENT_TYPES.forEach { type ->
                        TvButton(
                            label = t("player.skipTime.feedback.modal.types.$type"),
                            selected = segmentType == type,
                            navigation = true
                        ) {
                            segmentType = type
                            errorText = ""
                        }
                    }
                }
            }
            item {
                Text(
                    text = t("player.skipTime.feedback.modal.startTimeLabel"),
                    color = secondaryText,
                    fontSize = 12.sp
                )
                Spacer(Modifier.height(4.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    BasicTextField(
                        value = startText,
                        onValueChange = { startText = it; errorText = "" },
                        singleLine = true,
                        textStyle = TextStyle(color = Color.White, fontSize = 14.sp),
                        cursorBrush = SolidColor(Color.White),
                        modifier = Modifier
                            .weight(1f)
                            .background(colors["video.context.border"], RoundedCornerShape(6.dp))
                            .padding(10.dp),
                        decorationBox = { inner ->
                            Box {
                                if (startText.isEmpty()) Text("0:00", color = secondaryText, fontSize = 13.sp)
                                inner()
                            }
                        }
                    )
                    TvButton(label = formatDurationTime(currentPositionSec), navigation = true) {
                        startText = formatDurationTime(currentPositionSec)
                        errorText = ""
                    }
                    if (startText.isNotEmpty()) {
                        TvButton(label = "✕", navigation = true) { startText = "" }
                    }
                }
            }
            item {
                Text(
                    text = t("player.skipTime.feedback.modal.endTimeLabel"),
                    color = secondaryText,
                    fontSize = 12.sp
                )
                Spacer(Modifier.height(4.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    BasicTextField(
                        value = endText,
                        onValueChange = { endText = it; errorText = "" },
                        singleLine = true,
                        textStyle = TextStyle(color = Color.White, fontSize = 14.sp),
                        cursorBrush = SolidColor(Color.White),
                        modifier = Modifier
                            .weight(1f)
                            .background(colors["video.context.border"], RoundedCornerShape(6.dp))
                            .padding(10.dp),
                        decorationBox = { inner ->
                            Box {
                                if (endText.isEmpty()) Text("mm:ss", color = secondaryText, fontSize = 13.sp)
                                inner()
                            }
                        }
                    )
                    TvButton(label = formatDurationTime(currentPositionSec), navigation = true) {
                        endText = formatDurationTime(currentPositionSec)
                        errorText = ""
                    }
                    if (endText.isNotEmpty()) {
                        TvButton(label = "✕", navigation = true) { endText = "" }
                    }
                }
            }
            item {
                Text(
                    text = t("player.skipTime.feedback.modal.whenToDesc"),
                    color = secondaryText,
                    fontSize = 11.5.sp,
                    lineHeight = 15.sp
                )
            }
            if (errorText.isNotBlank()) {
                item {
                    Text(errorText, color = colors["type.danger"], fontSize = 12.5.sp)
                }
            }
            if (successText.isNotBlank()) {
                item {
                    Text(successText, color = colors["video.context.type.accent"], fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            item {
                val endErrText = t("player.skipTime.feedback.modal.error.endTime")
                val startErrText = t("player.skipTime.feedback.modal.error.startTime")
                val submitErrPrefix = t("player.skipTime.feedback.modal.error.submission")
                val okText = t("player.skipTime.feedback.modal.success.title")
                val whenToDescText = t("player.skipTime.feedback.modal.whenToDesc")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TvButton(
                        label = t("player.skipTime.feedback.modal.cancel"),
                        navigation = true,
                        modifier = Modifier.weight(1f),
                        onClick = onBack
                    )
                    TvButton(
                        label = if (submitting) t("player.skipTime.feedback.modal.submitting")
                        else t("player.skipTime.feedback.modal.submit"),
                        accent = true,
                        loading = submitting,
                        modifier = Modifier.weight(1f)
                    ) {
                        if (submitting) return@TvButton
                        val s = parseFlexibleTimestampToSec(startText)
                        val e = parseFlexibleTimestampToSec(endText)
                        if (s?.isNaN() == true || e?.isNaN() == true) {
                            errorText = whenToDescText
                            return@TvButton
                        }
                        if ((segmentType == "intro" || segmentType == "recap") && e == null) {
                            errorText = endErrText
                            return@TvButton
                        }
                        if ((segmentType == "credits" || segmentType == "preview") && s == null) {
                            errorText = startErrText
                            return@TvButton
                        }
                        scope.launch {
                            submitting = true
                            errorText = ""
                            successText = ""
                            val res = state.submitSkipSegment(item, episode, segmentType, s, e)
                            submitting = false
                            res.onSuccess {
                                successText = okText
                            }.onFailure { err ->
                                errorText = "$submitErrPrefix: ${err.message ?: ""}".trim()
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun SkipThumbsFeedbackBanner(
    segment: SkipSegment?,
    modifier: Modifier = Modifier,
    onSubmitAdjustment: () -> Unit,
    onDismiss: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    AnimatedVisibility(
        visible = segment != null,
        enter = fadeIn(),
        exit = fadeOut(),
        modifier = modifier
    ) {
        if (segment != null) {
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors["video.context.background"].copy(alpha = 0.94f))
                    .border(BorderStroke(1.dp, colors["video.context.border"]), RoundedCornerShape(12.dp))
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = t("player.skipTime.feedback.title"),
                    color = Color.White,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium
                )
                TvButton(label = "👍", navigation = true, onClick = onDismiss)
                TvButton(label = "👎", navigation = true, onClick = onSubmitAdjustment)
            }
        }
    }
}
