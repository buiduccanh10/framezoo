package com.framezoo.tv.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

@Composable
internal fun FrameZooTheme(theme: String, content: @Composable () -> Unit) {
    val colors = when (theme) {
        "Light" -> lightColorScheme(primary = Color(0xFF9D441C), background = Color(0xFFF5F1ED), surface = Color.White)
        "Dark" -> darkColorScheme(primary = Color(0xFFB6B5D6), background = Color(0xFF12131B), surface = Color(0xFF232633))
        else -> darkColorScheme(primary = Color(0xFFF39455), background = Color(0xFF17111B), surface = Color(0xFF29222E))
    }
    MaterialTheme(colorScheme = colors, content = content)
}
