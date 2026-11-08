package com.framezoo.tv.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.tv.material3.Border as TvBorder
import androidx.tv.material3.Button as MaterialTvButton
import androidx.tv.material3.ButtonDefaults as TvButtonDefaults
import com.framezoo.tv.R
import com.framezoo.tv.model.AccountProfile
import com.framezoo.tv.ui.designsystem.TvDesignTokens
import com.framezoo.tv.ui.features.account.AccountMenuAction
import com.framezoo.tv.ui.features.account.AccountMenuUiState

/**
 * Pure presentation Header Account Pill Button on Android TV.
 * Conforms to Desktop LinksDropdown header trigger behavior and design system tokens.
 */
@Composable
fun HeaderAccountButton(
    uiState: AccountMenuUiState,
    focusRequester: FocusRequester,
    leftFocusRequester: FocusRequester,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val i18n = LocalI18n.current
    var focused by remember { mutableStateOf(false) }
    val rotation by animateFloatAsState(
        targetValue = if (uiState.isExpanded) 180f else 0f,
        animationSpec = tween(durationMillis = TvDesignTokens.Animation.NormalDuration),
        label = "chevron rotation"
    )

    val active = focused || uiState.isExpanded
    val focusBorderColor = if (active) Color.White else (colors["type.logo"] ?: TvDesignTokens.Colors.Highlight)

    MaterialTvButton(
        onClick = onClick,
        modifier = modifier
            .focusRequester(focusRequester)
            .focusProperties {
                left = leftFocusRequester
            }
            .onFocusChanged { focused = it.isFocused },
        shape = TvButtonDefaults.shape(TvDesignTokens.Shapes.Pill),
        colors = TvButtonDefaults.colors(
            containerColor = colors["pill.background"].copy(alpha = if (uiState.isExpanded) 1f else 0.85f),
            contentColor = Color.White,
            focusedContainerColor = colors["pill.backgroundHover"] ?: colors["pill.background"],
            focusedContentColor = Color.White
        ),
        scale = TvButtonDefaults.scale(focusedScale = TvDesignTokens.Animation.FocusScaleHeader),
        border = TvButtonDefaults.border(
            focusedBorder = TvBorder(
                BorderStroke(TvDesignTokens.Dimensions.BorderFocus, focusBorderColor),
                shape = TvDesignTokens.Shapes.Pill
            )
        ),
        contentPadding = PaddingValues(
            horizontal = if (uiState.isLoggedIn) 12.dp else 14.dp,
            vertical = TvDesignTokens.Dimensions.PaddingVerticalMenu
        )
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(TvDesignTokens.Dimensions.SpacingSm)
        ) {
            if (uiState.isLoggedIn) {
                UserAvatar(
                    profile = uiState.profile,
                    size = TvDesignTokens.Dimensions.AvatarSmall,
                    fontSize = TvDesignTokens.Typography.Caption
                )
                Text(
                    text = uiState.displayName.ifEmpty {
                        i18n.t("settings.account.devices.unknownDevice")
                    },
                    color = Color.White,
                    fontSize = TvDesignTokens.Typography.HeaderText,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            } else {
                Icon(
                    painter = painterResource(R.drawable.desktop_user),
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(18.dp)
                )
                Text(
                    text = i18n.t("auth.login.submit"),
                    color = Color.White,
                    fontSize = TvDesignTokens.Typography.HeaderText,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Icon(
                painter = painterResource(R.drawable.desktop_chevron_down),
                contentDescription = null,
                tint = colors["type.secondary"] ?: TvDesignTokens.Colors.TextMuted,
                modifier = Modifier
                    .size(14.dp)
                    .graphicsLayer { rotationZ = rotation }
            )
        }
    }
}

/**
 * Backward compatibility overload for HeaderAccountButton.
 */
@Composable
fun HeaderAccountButton(
    isLoggedIn: Boolean,
    userNickname: String?,
    colorA: String?,
    colorB: String?,
    icon: String?,
    expanded: Boolean,
    focusRequester: FocusRequester,
    leftFocusRequester: FocusRequester,
    modifier: Modifier = Modifier,
    deviceName: String? = null,
    seedBase64: String? = null,
    onClick: () -> Unit
) {
    val state = remember(isLoggedIn, userNickname, colorA, colorB, icon, expanded, deviceName, seedBase64) {
        AccountMenuUiState(
            isLoggedIn = isLoggedIn,
            profile = AccountProfile(
                colorA = colorA ?: "#6366F1",
                colorB = colorB ?: "#EC4899",
                icon = com.framezoo.tv.model.UserIcon.fromKey(icon),
                nickname = userNickname.orEmpty(),
                deviceName = deviceName,
                seedBase64 = seedBase64
            ),
            isExpanded = expanded
        )
    }
    HeaderAccountButton(
        uiState = state,
        focusRequester = focusRequester,
        leftFocusRequester = leftFocusRequester,
        modifier = modifier,
        onClick = onClick
    )
}

/**
 * Pure presentation Row item for the Account Dropdown Menu on Android TV.
 */
@Composable
fun DropdownItemRow(
    label: String,
    icon: Int? = null,
    leadingContent: (@Composable () -> Unit)? = null,
    isHighlight: Boolean = false,
    isDanger: Boolean = false,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    var focused by remember { mutableStateOf(false) }
    val baseColor = when {
        isHighlight -> colors["type.logo"] ?: TvDesignTokens.Colors.Highlight
        isDanger -> colors["type.danger"] ?: TvDesignTokens.Colors.Danger
        else -> TvDesignTokens.Colors.TextMuted
    }
    val contentColor = when {
        isDanger -> colors["type.danger"] ?: TvDesignTokens.Colors.Danger
        isHighlight -> colors["type.logo"] ?: TvDesignTokens.Colors.Highlight
        focused -> Color.White
        else -> baseColor
    }

    MaterialTvButton(
        onClick = onClick,
        modifier = modifier
            .zIndex(if (focused) 10f else 1f)
            .fillMaxWidth()
            .height(TvDesignTokens.Dimensions.MenuItemHeight)
            .padding(horizontal = 6.dp, vertical = 2.dp)
            .onFocusChanged { focused = it.isFocused },
        shape = TvButtonDefaults.shape(TvDesignTokens.Shapes.MenuItem),
        colors = TvButtonDefaults.colors(
            containerColor = if (focused) TvDesignTokens.Colors.FocusedItemContainer else Color.Transparent,
            contentColor = contentColor,
            focusedContainerColor = TvDesignTokens.Colors.FocusedItemContainer,
            focusedContentColor = if (isDanger) (colors["type.danger"] ?: TvDesignTokens.Colors.Danger) else Color.White
        ),
        scale = TvButtonDefaults.scale(focusedScale = TvDesignTokens.Animation.FocusScaleNormal),
        border = TvButtonDefaults.border(
            focusedBorder = TvBorder(
                BorderStroke(
                    TvDesignTokens.Dimensions.BorderFocus,
                    colors["type.logo"] ?: TvDesignTokens.Colors.Highlight
                ),
                shape = TvDesignTokens.Shapes.MenuItem
            )
        ),
        contentPadding = PaddingValues(
            horizontal = TvDesignTokens.Dimensions.PaddingHorizontalMenu,
            vertical = TvDesignTokens.Dimensions.PaddingVerticalMenu
        )
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(TvDesignTokens.Dimensions.SpacingMd)
        ) {
            if (leadingContent != null) {
                leadingContent()
            } else if (icon != null) {
                Icon(
                    painter = painterResource(icon),
                    contentDescription = null,
                    tint = if (isDanger) {
                        colors["type.danger"] ?: TvDesignTokens.Colors.Danger
                    } else if (isHighlight) {
                        colors["type.logo"] ?: TvDesignTokens.Colors.Highlight
                    } else if (focused) {
                        Color.White
                    } else {
                        baseColor
                    },
                    modifier = Modifier.size(20.dp)
                )
            }
            Text(
                text = label,
                color = if (isDanger) {
                    colors["type.danger"] ?: TvDesignTokens.Colors.Danger
                } else if (isHighlight) {
                    colors["type.logo"] ?: TvDesignTokens.Colors.Highlight
                } else if (focused) {
                    Color.White
                } else {
                    contentColor
                },
                fontSize = TvDesignTokens.Typography.MenuItemText,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

/**
 * Pure presentation Divider for the Account Dropdown Menu.
 */
@Composable
fun DropdownDivider(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = TvDesignTokens.Dimensions.SpacingXs)
            .height(TvDesignTokens.Dimensions.DividerThickness)
            .background(TvDesignTokens.Colors.Divider)
    )
}

/**
 * Pure presentation Dropdown Menu displaying account options matching desktop LinksDropdown.tsx.
 */
@Composable
fun AccountDropdownMenu(
    uiState: AccountMenuUiState,
    onDismissRequest: () -> Unit,
    onAction: (AccountMenuAction) -> Unit,
    modifier: Modifier = Modifier
) {
    val i18n = LocalI18n.current

    DropdownMenu(
        expanded = uiState.isExpanded,
        onDismissRequest = onDismissRequest,
        modifier = modifier
            .width(TvDesignTokens.Dimensions.DropdownWidth)
            .background(TvDesignTokens.Colors.DropdownBackground, TvDesignTokens.Shapes.Dropdown)
            .border(
                BorderStroke(TvDesignTokens.Dimensions.BorderSubtle, TvDesignTokens.Colors.DropdownBorder),
                TvDesignTokens.Shapes.Dropdown
            )
            .padding(vertical = TvDesignTokens.Dimensions.SpacingXs)
    ) {
        if (uiState.isLoggedIn) {
            DropdownItemRow(
                label = uiState.displayName.ifEmpty {
                    i18n.t("settings.account.devices.unknownDevice")
                },
                leadingContent = {
                    UserAvatar(
                        profile = uiState.profile,
                        size = TvDesignTokens.Dimensions.AvatarSmall,
                        fontSize = TvDesignTokens.Typography.Caption
                    )
                },
                onClick = { onAction(AccountMenuAction.SelectProfile) }
            )
        } else {
            DropdownItemRow(
                label = i18n.t("navigation.menu.register"),
                icon = R.drawable.desktop_cloud_arrow_up,
                isHighlight = true,
                onClick = { onAction(AccountMenuAction.SelectLogin) }
            )
        }

        DropdownDivider()

        DropdownItemRow(
            label = i18n.t("home.watchHistory.sectionTitle"),
            icon = R.drawable.desktop_clock,
            onClick = { onAction(AccountMenuAction.SelectHistory) }
        )

        DropdownItemRow(
            label = i18n.t("home.bookmarks.sectionTitle"),
            icon = R.drawable.desktop_bookmark,
            onClick = { onAction(AccountMenuAction.SelectBookmarks) }
        )

        DropdownItemRow(
            label = i18n.t("navigation.menu.addons"),
            icon = R.drawable.desktop_extension,
            onClick = { onAction(AccountMenuAction.SelectAddons) }
        )

        DropdownItemRow(
            label = i18n.t("player.menus.watchparty.watchpartyItem"),
            icon = R.drawable.desktop_watch_party,
            onClick = { onAction(AccountMenuAction.SelectWatchParty) }
        )

        DropdownItemRow(
            label = i18n.t("navigation.menu.feedback"),
            icon = R.drawable.desktop_feedback,
            onClick = { onAction(AccountMenuAction.SelectFeedback) }
        )

        DropdownItemRow(
            label = i18n.t("navigation.menu.settings"),
            icon = R.drawable.desktop_settings,
            onClick = { onAction(AccountMenuAction.SelectSettings) }
        )

        if (uiState.isLoggedIn) {
            DropdownItemRow(
                label = i18n.t("navigation.menu.logout"),
                icon = R.drawable.desktop_logout,
                isDanger = true,
                onClick = { onAction(AccountMenuAction.SelectLogout) }
            )
        }

        DropdownDivider()
    }
}
