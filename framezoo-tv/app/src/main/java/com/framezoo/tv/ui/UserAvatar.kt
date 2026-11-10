package com.framezoo.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import com.framezoo.tv.model.AccountProfile
import com.framezoo.tv.model.UserIcon
import com.framezoo.tv.model.UserIconGraphic
import com.framezoo.tv.ui.designsystem.TvDesignTokens

/**
 * Pure presentation Composable for User Avatar on Android TV.
 * Renders a linear gradient circle with either an Emoji or a Vector icon.
 * Supports all 58 user icons matching Desktop UserIcon.tsx.
 */
@Composable
fun UserAvatar(
    profile: AccountProfile,
    modifier: Modifier = Modifier,
    size: Dp = TvDesignTokens.Dimensions.AvatarSmall,
    fontSize: TextUnit = TvDesignTokens.Typography.Caption
) {
    val (startColor, endColor) = profile.gradientColors()
    val graphic = profile.icon.toGraphic()

    Box(
        modifier = modifier
            .size(size)
            .clip(TvDesignTokens.Shapes.Avatar)
            .background(
                Brush.linearGradient(
                    colors = listOf(startColor, endColor),
                    start = Offset.Zero,
                    end = Offset.Infinite
                )
            ),
        contentAlignment = Alignment.Center
    ) {
        when (graphic) {
            is UserIconGraphic.Emoji -> {
                Text(
                    text = graphic.char,
                    fontSize = fontSize,
                    textAlign = TextAlign.Center
                )
            }
            is UserIconGraphic.VectorRes -> {
                Icon(
                    painter = painterResource(graphic.resId),
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(size * 0.65f)
                )
            }
        }
    }
}

/**
 * Overload for backward compatibility and direct string property invocations.
 */
@Composable
fun UserAvatar(
    colorA: String?,
    colorB: String?,
    icon: String?,
    modifier: Modifier = Modifier,
    size: Dp = TvDesignTokens.Dimensions.AvatarSmall,
    fontSize: TextUnit = TvDesignTokens.Typography.Caption
) {
    val profile = AccountProfile(
        colorA = colorA ?: "#6366F1",
        colorB = colorB ?: "#EC4899",
        icon = UserIcon.fromKey(icon)
    )
    UserAvatar(
        profile = profile,
        modifier = modifier,
        size = size,
        fontSize = fontSize
    )
}
