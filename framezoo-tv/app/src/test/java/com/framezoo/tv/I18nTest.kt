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

    @Test
    fun testErrorAndNotFoundTranslations() {
        val i18nVi = I18n(initialLanguage = "vi", assetLoader = ::loadAsset)
        assertEquals("Lỗi", i18nVi.t("errors.badge"))
        assertEquals("Đã xảy ra lỗi!", i18nVi.t("errors.title"))
        assertEquals("Tải lại trang", i18nVi.t("errors.reloadPage"))
        assertEquals("Không tìm thấy", i18nVi.t("notFound.badge"))
        assertEquals("Không thể tìm thấy trang", i18nVi.t("notFound.title"))
        assertEquals("Mật khẩu không chính xác hoặc không đầy đủ", i18nVi.t("auth.login.validationError"))
        assertEquals("Không thể truy cập máy chủ", i18nVi.t("auth.login.failedToReachServer"))
    }

    @Test
    fun testRandomTranslationsJokeAndDefault() {
        val i18nVi = I18n(initialLanguage = "vi", assetLoader = ::loadAsset)
        val defaultNight = i18nVi.randomT("home.titles.night", jokeChance = 0.0)
        assertEquals("Đêm nay bạn muốn coi gì?", defaultNight)

        val jokeNight = i18nVi.randomT("home.titles.night", jokeChance = 1.0)
        assertEquals("Cảm thấy mệt? Tôi nghe nói phim The Exorcist hay đấy.", jokeNight)

        val defaultPlaceholder = i18nVi.randomT("home.search.placeholder", jokeChance = 0.0)
        assertEquals("Bạn muốn xem gì?", defaultPlaceholder)
    }

    @Test
    fun testFriendlyLoginErrorMapping() {
        val i18nVi = I18n(initialLanguage = "vi", assetLoader = ::loadAsset)
        assertEquals("Mật khẩu không chính xác hoặc không đầy đủ", com.framezoo.tv.ui.getFriendlyLoginError(IllegalStateException("HTTP 401: Unauthorized"), i18nVi))
        assertEquals("Mật khẩu không chính xác hoặc không đầy đủ", com.framezoo.tv.ui.getFriendlyLoginError(IllegalStateException("user not found"), i18nVi))
        assertEquals("Không có URL backend", com.framezoo.tv.ui.getFriendlyLoginError(IllegalStateException("No backend URL"), i18nVi))
        assertEquals("Không thể truy cập máy chủ", com.framezoo.tv.ui.getFriendlyLoginError(java.net.ConnectException("Connection refused"), i18nVi))
    }
}
