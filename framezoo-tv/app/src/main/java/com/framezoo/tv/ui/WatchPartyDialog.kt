package com.framezoo.tv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.tv.material3.Button as MaterialTvButton
import androidx.tv.material3.ButtonDefaults as TvButtonDefaults
import com.framezoo.tv.R
import com.framezoo.tv.ui.designsystem.TvDesignTokens
import com.framezoo.tv.ui.features.watchparty.WatchPartyAction
import com.framezoo.tv.ui.features.watchparty.WatchPartyUiState

/**
 * Pure presentation dialog for Watch Party Join on Android TV.
 * Conforms to Desktop WatchPartyJoinDialog (LinksDropdown.tsx) and TvDesignTokens.
 */
@Composable
fun WatchPartyJoinDialog(
    uiState: WatchPartyUiState,
    onAction: (WatchPartyAction) -> Unit
) {
    if (!uiState.isOpen) return

    val colors = LocalFrameZooColors.current
    val i18n = LocalI18n.current
    val inputFocus = remember { FocusRequester() }
    var inputFocused by remember { mutableStateOf(false) }

    LaunchedEffect(uiState.isOpen) {
        try {
            inputFocus.requestFocus()
        } catch (_: Exception) {}
    }

    BackHandler { onAction(WatchPartyAction.Close) }

    Dialog(
        onDismissRequest = { onAction(WatchPartyAction.Close) },
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.7f)),
            contentAlignment = Alignment.Center
        ) {
            Column(
                modifier = Modifier
                    .width(TvDesignTokens.Dimensions.DialogWidth)
                    .background(TvDesignTokens.Colors.DropdownBackground, TvDesignTokens.Shapes.Dialog)
                    .border(
                        BorderStroke(TvDesignTokens.Dimensions.BorderSubtle, TvDesignTokens.Colors.DropdownBorder),
                        TvDesignTokens.Shapes.Dialog
                    )
                    .padding(TvDesignTokens.Dimensions.SpacingXl),
                verticalArrangement = Arrangement.spacedBy(TvDesignTokens.Dimensions.SpacingLg)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(
                            painter = painterResource(R.drawable.desktop_watch_party),
                            contentDescription = null,
                            tint = colors["buttons.purple"] ?: Color(0xFF8B5CF6),
                            modifier = Modifier.size(22.dp)
                        )
                        Text(
                            text = i18n.t("player.menus.watchparty.watchpartyItem"),
                            color = Color.White,
                            fontSize = TvDesignTokens.Typography.DialogTitle,
                            fontWeight = FontWeight.SemiBold
                        )
                    }

                    var closeFocused by remember { mutableStateOf(false) }
                    MaterialTvButton(
                        onClick = { onAction(WatchPartyAction.Close) },
                        modifier = Modifier
                            .size(32.dp)
                            .onFocusChanged { closeFocused = it.isFocused },
                        shape = TvButtonDefaults.shape(RoundedCornerShape(8.dp)),
                        colors = TvButtonDefaults.colors(
                            containerColor = if (closeFocused) Color(0xFF262626) else Color.Transparent,
                            contentColor = if (closeFocused) Color.White else TvDesignTokens.Colors.TextMuted
                        ),
                        contentPadding = PaddingValues(0.dp)
                    ) {
                        Icon(
                            painter = painterResource(R.drawable.desktop_close),
                            contentDescription = i18n.t("watchParty.cancel"),
                            tint = if (closeFocused) Color.White else TvDesignTokens.Colors.TextMuted,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }

            Text(
                text = i18n.t("watchParty.enterCodeOrLink"),
                color = TvDesignTokens.Colors.TextMuted,
                fontSize = TvDesignTokens.Typography.Caption
            )

            BasicTextField(
                value = uiState.codeInput,
                onValueChange = { onAction(WatchPartyAction.CodeChanged(it)) },
                enabled = !uiState.isLoading,
                singleLine = true,
                textStyle = TextStyle(color = Color.White, fontSize = 15.sp),
                cursorBrush = SolidColor(Color.White),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Go
                ),
                keyboardActions = KeyboardActions(
                    onGo = { if (uiState.canSubmit) onAction(WatchPartyAction.Submit) }
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(inputFocus)
                    .onFocusChanged { inputFocused = it.isFocused }
                    .background(TvDesignTokens.Colors.InputBackground, TvDesignTokens.Shapes.Input)
                    .border(
                        BorderStroke(
                            if (inputFocused) TvDesignTokens.Dimensions.BorderFocus else TvDesignTokens.Dimensions.BorderSubtle,
                            if (inputFocused) (colors["type.logo"] ?: TvDesignTokens.Colors.Highlight) else TvDesignTokens.Colors.DropdownBorder
                        ),
                        TvDesignTokens.Shapes.Input
                    )
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                decorationBox = { inner ->
                    if (uiState.codeInput.isEmpty()) {
                        Text(
                            text = "https://framezoo/...?...watchparty=ABCD123456",
                            color = Color(0x99CCCCCC),
                            fontSize = 15.sp
                        )
                    }
                    inner()
                }
            )

            uiState.errorMessage?.let { errorText ->
                Text(
                    text = errorText,
                    color = TvDesignTokens.Colors.TextError,
                    fontSize = TvDesignTokens.Typography.Caption,
                    fontWeight = FontWeight.Medium
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End)
            ) {
                TvButton(label = i18n.t("watchParty.cancel")) {
                    onAction(WatchPartyAction.Close)
                }
                TvButton(
                    label = if (uiState.isLoading) i18n.t("watchParty.validating") else i18n.t("watchParty.join"),
                    accent = true,
                    loading = uiState.isLoading
                ) {
                    if (uiState.canSubmit) onAction(WatchPartyAction.Submit)
                }
            }
        }
    }
}
}

/**
 * Backward compatibility overload for existing FrameZooState usage.
 */
@Composable
internal fun WatchPartyJoinDialog(state: FrameZooState) {
    val uiState = remember(state.watchPartyDialogOpen, state.watchPartyCodeInput, state.watchPartyLoading, state.watchPartyError) {
        WatchPartyUiState(
            isOpen = state.watchPartyDialogOpen,
            codeInput = state.watchPartyCodeInput,
            isLoading = state.watchPartyLoading,
            errorMessage = state.watchPartyError
        )
    }

    WatchPartyJoinDialog(
        uiState = uiState,
        onAction = { action ->
            when (action) {
                WatchPartyAction.Open -> state.openWatchParty()
                WatchPartyAction.Close -> state.closeWatchParty()
                is WatchPartyAction.CodeChanged -> state.watchPartyCodeInput = action.newCode
                WatchPartyAction.Submit -> state.submitWatchParty()
            }
        }
    )
}
