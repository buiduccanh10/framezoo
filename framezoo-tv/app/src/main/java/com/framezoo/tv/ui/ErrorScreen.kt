package com.framezoo.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.framezoo.tv.R

@Composable
internal fun ErrorScreen(
    state: FrameZooState,
    errorMessage: String? = null,
    is404: Boolean = false,
    onReload: () -> Unit,
    onGoHome: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val reloadFocus = remember { FocusRequester() }
    var showDetails by remember { mutableStateOf(false) }

    val resolvedError = errorMessage?.ifBlank { null }
        ?: state.discoverError.ifBlank { null }
        ?: state.error.ifBlank { null }
        ?: t("auth.login.failedToReachServer")

    val badgeText = if (is404) t("notFound.badge") else t("errors.badge")
    val titleText = if (is404) t("notFound.title") else t("errors.title")
    val messageText = if (is404) t("notFound.message") else resolvedError

    LaunchedEffect(Unit) {
        kotlinx.coroutines.android.awaitFrame()
        runCatching { reloadFocus.requestFocus() }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors["background.main"])
            .padding(horizontal = 48.dp, vertical = 28.dp)
    ) {
        // Top Header matching Desktop Layout
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.TopStart),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(colors["pill.background"].copy(alpha = 0.5f))
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                contentAlignment = Alignment.Center
            ) {
                androidx.compose.foundation.Image(
                    painter = painterResource(R.drawable.framezoo_brand),
                    contentDescription = "Framezoo",
                    modifier = Modifier.height(28.dp),
                    contentScale = androidx.compose.ui.layout.ContentScale.Fit
                )
            }

            if (state.isOffline) {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(RoundedCornerShape(50))
                        .background(colors["pill.background"].copy(alpha = 0.5f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        painter = painterResource(R.drawable.desktop_wifi_off),
                        contentDescription = "Offline",
                        tint = colors["type.danger"],
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }

        // Center Content Card matching Desktop ErrorPart & NotFoundPart
        Column(
            modifier = Modifier
                .align(Alignment.Center)
                .widthIn(max = 680.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // Icon Pill: Eye Slash + Badge Text
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(colors["pill.background"].copy(alpha = 0.6f))
                    .padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        painter = painterResource(R.drawable.desktop_eye_slash),
                        contentDescription = null,
                        tint = colors["type.logo"],
                        modifier = Modifier.size(16.dp)
                    )
                    Text(
                        text = badgeText,
                        color = colors["type.emphasis"],
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }

            Spacer(Modifier.height(18.dp))

            // Main Title
            Text(
                text = titleText,
                color = colors["type.emphasis"],
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )

            Spacer(Modifier.height(12.dp))

            // Message Paragraph
            Text(
                text = messageText,
                color = colors["type.secondary"],
                fontSize = 15.sp,
                lineHeight = 22.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 16.dp)
            )

            // Optional Expanded Error Details Modal/Box
            if (showDetails) {
                Spacer(Modifier.height(14.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(120.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(colors["background.secondary"])
                        .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(12.dp))
                        .padding(12.dp)
                        .verticalScroll(rememberScrollState())
                ) {
                    Text(
                        text = resolvedError,
                        color = colors["type.danger"],
                        fontSize = 12.sp,
                        fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace
                    )
                }
            }

            Spacer(Modifier.height(26.dp))

            // Action Buttons Row matching Desktop ErrorPart & NotFoundPart
            Row(
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                TvButton(
                    label = if (is404) t("notFound.reloadButton") else t("errors.reloadPage"),
                    modifier = Modifier.focusRequester(reloadFocus),
                    primary = true
                ) {
                    onReload()
                }

                TvButton(
                    label = t("notFound.goHome"),
                    navigation = true
                ) {
                    onGoHome()
                }

                if (!is404 && resolvedError.length > 30) {
                    TvButton(
                        label = if (showDetails) t("errors.details") else t("errors.showError"),
                        navigation = true
                    ) {
                        showDetails = !showDetails
                    }
                }
            }
        }
    }
}
