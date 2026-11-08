package com.framezoo.tv.ui.designsystem

import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Standard Design System Tokens for FrameZoo Android TV app.
 * Provides unified dimensions, shapes, colors, and typography for UI consistency.
 */
object TvDesignTokens {

    object Dimensions {
        val DropdownWidth = 260.dp
        val DialogWidth = 560.dp
        val MenuItemHeight = 44.dp
        val HeaderButtonHeight = 42.dp

        val AvatarSmall = 24.dp
        val AvatarMedium = 48.dp
        val AvatarLarge = 72.dp

        val BorderFocus = 2.dp
        val BorderSubtle = 1.dp
        val DividerThickness = 1.dp

        val SpacingXs = 4.dp
        val SpacingSm = 8.dp
        val SpacingMd = 12.dp
        val SpacingLg = 16.dp
        val SpacingXl = 24.dp

        val PaddingHorizontalMenu = 12.dp
        val PaddingVerticalMenu = 8.dp
    }

    object Shapes {
        val Dropdown = RoundedCornerShape(16.dp)
        val Dialog = RoundedCornerShape(16.dp)
        val MenuItem = RoundedCornerShape(8.dp)
        val Pill = RoundedCornerShape(50)
        val Input = RoundedCornerShape(12.dp)
        val Avatar = CircleShape
    }

    object Colors {
        val DropdownBackground = Color(0xFF141414)
        val DropdownBorder = Color(0xFF262626)
        val FocusedItemContainer = Color(0xFF222222)
        val InputBackground = Color(0xFF1C1C1C)
        val Divider = Color(0xFF262626)
        val TextMuted = Color(0xFFCCCCCC)
        val TextError = Color(0xFFF87171)
        val Highlight = Color(0xFFEF4444)
        val Danger = Color(0xFFEF4444)
    }

    object Typography {
        val DialogTitle = 18.sp
        val MenuItemText = 14.sp
        val HeaderText = 14.sp
        val Caption = 13.sp
        val EmojiSmall = 13.sp
        val EmojiMedium = 22.sp
        val EmojiLarge = 32.sp
    }

    object Animation {
        const val FastDuration = 150
        const val NormalDuration = 200
        const val FocusScaleNormal = 1.02f
        const val FocusScaleHeader = 1.05f
    }
}
