package com.framezoo.tv.ui

import android.graphics.Color.parseColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.tv.material3.MaterialTheme as TvMaterialTheme
import androidx.tv.material3.Typography as TvTypography
import androidx.tv.material3.darkColorScheme as tvDarkColorScheme
import com.framezoo.tv.R
import org.json.JSONObject

internal class FrameZooColors(private val values: Map<String, Color>) {
    operator fun get(name: String): Color = checkNotNull(values[name]) { "Thiếu token màu: $name" }
    fun withTokens(source: FrameZooColors, names: List<String>) = FrameZooColors(values + names.associateWith { source[it] })
}

internal val LocalFrameZooColors = compositionLocalOf<FrameZooColors> { error("FrameZooTheme chưa được khởi tạo") }
internal val LocalFrameZooPalettes = compositionLocalOf<Map<String, FrameZooColors>> { error("FrameZooTheme chưa được khởi tạo") }
internal val LocalFrameZooThemeLabels = compositionLocalOf<Map<String, String>> { error("FrameZooTheme chưa được khởi tạo") }

private val lato = FontFamily(
    Font(R.font.lato_regular, FontWeight.Normal),
    Font(R.font.lato_bold, FontWeight.Bold),
    Font(R.font.lato_black, FontWeight.Black),
)
private val typography = Typography().let { base ->
    Typography(
        displayLarge = base.displayLarge.copy(fontFamily = lato), displayMedium = base.displayMedium.copy(fontFamily = lato),
        displaySmall = base.displaySmall.copy(fontFamily = lato), headlineLarge = base.headlineLarge.copy(fontFamily = lato),
        headlineMedium = base.headlineMedium.copy(fontFamily = lato), headlineSmall = base.headlineSmall.copy(fontFamily = lato),
        titleLarge = base.titleLarge.copy(fontFamily = lato), titleMedium = base.titleMedium.copy(fontFamily = lato),
        titleSmall = base.titleSmall.copy(fontFamily = lato), bodyLarge = base.bodyLarge.copy(fontFamily = lato),
        bodyMedium = base.bodyMedium.copy(fontFamily = lato), bodySmall = base.bodySmall.copy(fontFamily = lato),
        labelLarge = base.labelLarge.copy(fontFamily = lato), labelMedium = base.labelMedium.copy(fontFamily = lato),
        labelSmall = base.labelSmall.copy(fontFamily = lato),
    )
}

private val tvTypography = TvTypography(
    displayLarge = typography.displayLarge, displayMedium = typography.displayMedium, displaySmall = typography.displaySmall,
    headlineLarge = typography.headlineLarge, headlineMedium = typography.headlineMedium, headlineSmall = typography.headlineSmall,
    titleLarge = typography.titleLarge, titleMedium = typography.titleMedium, titleSmall = typography.titleSmall,
    bodyLarge = typography.bodyLarge, bodyMedium = typography.bodyMedium, bodySmall = typography.bodySmall,
    labelLarge = typography.labelLarge, labelMedium = typography.labelMedium, labelSmall = typography.labelSmall,
)

@Composable
internal fun FrameZooTheme(theme: String, primary: String, secondary: String, tertiary: String, content: @Composable () -> Unit) {
    val context = LocalContext.current
    val palettes = remember(context) {
        val json = JSONObject(context.assets.open("themes.json").bufferedReader().use { it.readText() })
        json.keys().asSequence().associateWith { name ->
            val colors = json.getJSONObject(name)
            FrameZooColors(colors.keys().asSequence().associateWith { token -> Color(parseColor(colors.getString(token))) })
        }
    }
    val parts = remember(context) {
        val json = JSONObject(context.assets.open("custom-parts.json").bufferedReader().use { it.readText() })
        listOf("primary", "secondary", "tertiary").associateWith { part ->
            val names = json.getJSONArray(part)
            (0 until names.length()).map(names::getString)
        }
    }
    val labels = remember(context) {
        val json = JSONObject(context.assets.open("theme-labels.json").bufferedReader().use { it.readText() })
        json.keys().asSequence().associateWith(json::getString)
    }
    val custom = remember(palettes, parts, primary, secondary, tertiary) {
        palettes.getValue("default")
            .withTokens(palettes[primary] ?: palettes.getValue("default"), parts.getValue("primary"))
            .withTokens(palettes[secondary] ?: palettes.getValue("default"), parts.getValue("secondary"))
            .withTokens(palettes[tertiary] ?: palettes.getValue("default"), parts.getValue("tertiary"))
    }
    val allPalettes = palettes + ("custom" to custom)
    val colors = allPalettes[theme.lowercase()] ?: palettes.getValue("default")
    val scheme = darkColorScheme(
        primary = colors["type.logo"],
        onPrimary = colors["buttons.primaryText"],
        background = colors["background.main"],
        onBackground = colors["type.emphasis"],
        surface = colors["settings.card.background"],
        onSurface = colors["type.emphasis"],
        surfaceVariant = colors["search.background"],
        onSurfaceVariant = colors["type.text"],
        outline = colors["utils.divider"],
        error = colors["type.danger"],
    )
    val tvScheme = tvDarkColorScheme(
        primary = colors["type.logo"], onPrimary = colors["buttons.primaryText"],
        background = colors["background.main"], onBackground = colors["type.emphasis"],
        surface = colors["settings.card.background"], onSurface = colors["type.emphasis"],
        surfaceVariant = colors["search.background"], onSurfaceVariant = colors["type.text"],
        border = colors["utils.divider"], error = colors["type.danger"],
    )
    val density = LocalDensity.current
    CompositionLocalProvider(LocalDensity provides Density(density.density * 0.85f, density.fontScale),
        LocalFrameZooColors provides colors, LocalFrameZooPalettes provides allPalettes,
        LocalFrameZooThemeLabels provides labels) {
        MaterialTheme(colorScheme = scheme, typography = typography) {
            TvMaterialTheme(colorScheme = tvScheme, typography = tvTypography, content = content)
        }
    }
}
