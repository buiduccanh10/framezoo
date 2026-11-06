package com.framezoo.tv

import com.framezoo.tv.ui.I18n
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class I18nTest {
    private fun loadAsset(path: String): InputStream {
        val candidates = listOf(
            File("src/main/assets", path),
            File("app/src/main/assets", path),
            File("framezoo-tv/app/src/main/assets", path)
        )
        val file = candidates.firstOrNull { it.exists() }
            ?: throw IllegalArgumentException("Asset not found in candidates: $path")
        return FileInputStream(file)
    }

    @Test
    fun testVietnameseTranslations() {
        val i18n = I18n(initialLanguage = "vi", assetLoader = ::loadAsset)
        assertEquals("vi", i18n.language)
        assertEquals("Phát", i18n.t("details.play"))
        assertEquals("Tiếp tục", i18n.t("details.resume"))
        assertEquals("Rừng rậm", i18n.t("settings.appearance.themes.forest"))
        assertEquals("Chiếu rạp", i18n.t("media.inCinema"))
        assertEquals("Tất cả", i18n.t("discover.tabs.all"))
    }

    @Test
    fun testEnglishTranslationsAndSwitching() {
        val i18n = I18n(initialLanguage = "vi", assetLoader = ::loadAsset)
        i18n.setLanguage("en")
        assertEquals("en", i18n.language)
        assertEquals("Play", i18n.t("details.play"))
        assertEquals("Resume", i18n.t("details.resume"))
        assertEquals("Forest", i18n.t("settings.appearance.themes.forest"))
        assertEquals("In Cinema", i18n.t("media.inCinema"))
        assertEquals("All", i18n.t("discover.tabs.all"))
    }

    @Test
    fun testThemeNamesResolvedAcrossLocales() {
        val i18nEn = I18n(initialLanguage = "en", assetLoader = ::loadAsset)
        assertEquals("Forest", i18nEn.t("settings.appearance.themes.forest"))
        assertEquals("Frost", i18nEn.t("settings.appearance.themes.frost"))
        assertEquals("Classic", i18nEn.t("settings.appearance.themes.classic"))

        val i18nVi = I18n(initialLanguage = "vi", assetLoader = ::loadAsset)
        assertEquals("Rừng rậm", i18nVi.t("settings.appearance.themes.forest"))
        assertEquals("Băng giá", i18nVi.t("settings.appearance.themes.frost"))
        assertEquals("Cổ điển", i18nVi.t("settings.appearance.themes.classic"))
    }

    @Test
    fun testAvailableLanguages() {
        val i18n = I18n(initialLanguage = "en", assetLoader = ::loadAsset)
        val langs = i18n.availableLanguages
        assertTrue(langs.size >= 50)
        assertTrue(langs.any { it.first == "vi" && it.second == "Tiếng Việt" })
        assertTrue(langs.any { it.first == "en" && it.second == "English" })
    }
}
