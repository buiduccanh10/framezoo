package com.framezoo.tv.ui

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject
import java.io.InputStream
import java.util.Locale

class I18n(
    private val context: Context? = null,
    initialLanguage: String = "vi",
    private val assetLoader: ((String) -> InputStream)? = null
) {
    private var _language by mutableStateOf(initialLanguage)
    val language: String get() = _language

    private var translations: Map<String, String> = emptyMap()
    private var fallbackTranslations: Map<String, String> = emptyMap()
    private var extraTranslations: Map<String, List<String>> = emptyMap()
    private var fallbackExtraTranslations: Map<String, List<String>> = emptyMap()

    init {
        val (fallbackMap, fallbackExtras) = loadLocaleWithExtras("en")
        fallbackTranslations = fallbackMap
        fallbackExtraTranslations = fallbackExtras
        loadLanguage(initialLanguage)
    }

    fun setLanguage(lang: String) {
        if (_language != lang) {
            loadLanguage(lang)
            _language = lang
        }
    }

    private fun loadLanguage(lang: String) {
        if (lang == "en") {
            translations = fallbackTranslations
            extraTranslations = fallbackExtraTranslations
        } else {
            val (map, extras) = loadLocaleWithExtras(lang)
            translations = map
            extraTranslations = extras
        }
    }

    private fun loadLocaleWithExtras(lang: String): Pair<Map<String, String>, Map<String, List<String>>> {
        return try {
            val fileName = "locales/$lang.json"
            val stream = assetLoader?.invoke(fileName) ?: context?.assets?.open(fileName) ?: return (emptyMap<String, String>() to emptyMap())
            val text = stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            val json = JSONObject(text)
            val map = mutableMapOf<String, String>()
            val extras = mutableMapOf<String, List<String>>()
            flattenJson(json, "", map, extras)
            map to extras
        } catch (_: Exception) {
            emptyMap<String, String>() to emptyMap()
        }
    }

    private fun flattenJson(
        obj: JSONObject,
        prefix: String,
        out: MutableMap<String, String>,
        extraOut: MutableMap<String, List<String>>
    ) {
        val keys = obj.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            val p = if (prefix.isEmpty()) k else "$prefix.$k"
            val v = obj.opt(k)
            if (v is JSONObject) {
                flattenJson(v, p, out, extraOut)
            } else if (v is org.json.JSONArray) {
                val list = mutableListOf<String>()
                for (i in 0 until v.length()) {
                    val item = v.opt(i)
                    if (item != null && item != JSONObject.NULL) {
                        val s = item.toString()
                        out["$p.$i"] = s
                        list.add(s)
                    }
                }
                extraOut[p] = list
            } else if (v is String) {
                out[p] = v
            } else if (v != null && v != JSONObject.NULL) {
                out[p] = v.toString()
            }
        }
    }

    fun t(key: String, vararg args: Pair<String, Any>): String {
        var str = translations[key] ?: fallbackTranslations[key] ?: key
        for ((argKey, argVal) in args) {
            str = str.replace("{{$argKey}}", argVal.toString())
                .replace("{$argKey}", argVal.toString())
        }
        return str.replace(Regex("<[^>]+>"), "")
    }

    fun randomT(key: String, jokeChance: Double = 0.35): String {
        val defaultVal = t("$key.default")
        val fallback = if (defaultVal != "$key.default") defaultVal else t(key)
        if (Math.random() < jokeChance) {
            val extras = extraTranslations["$key.extra"] ?: fallbackExtraTranslations["$key.extra"]
            if (!extras.isNullOrEmpty()) {
                return extras.random()
            }
        }
        return fallback
    }

    val availableLanguages: List<Pair<String, String>> by lazy {
        try {
            val files = context?.assets?.list("locales") ?: emptyArray()
            val list = files.filter { it.endsWith(".json") }.map { file ->
                val code = file.removeSuffix(".json")
                val name = languageDisplayName(code)
                code to name
            }.sortedBy { it.second }
            if (list.isNotEmpty()) list else ALL_SUPPORTED_LANGUAGES
        } catch (_: Exception) {
            ALL_SUPPORTED_LANGUAGES
        }
    }

    companion object {
        val ALL_SUPPORTED_CODES = listOf(
            "ar", "bg", "bn", "ca", "ca@valencia", "cs", "da", "de-CH", "de", "el", "en", "es", "et",
            "fa", "fi-FI", "fr", "futhark", "gl", "gu", "he", "hi", "hu", "id", "is-IS", "it", "ja",
            "kitty", "km", "ko", "lv", "minion", "ne", "nl", "nv", "pa", "pirate", "pl", "pt-BR",
            "pt-PT", "ro", "ru", "si", "sl", "sv", "ta", "th", "tok", "tr", "uk", "umb", "ur_PK",
            "uwu", "vi", "zh-Hant", "zh"
        )

        val ALL_SUPPORTED_LANGUAGES: List<Pair<String, String>> by lazy {
            ALL_SUPPORTED_CODES.map { it to languageDisplayName(it) }.sortedBy { it.second }
        }

        fun languageDisplayName(code: String): String = when (code) {
            "vi" -> "Tiếng Việt"
            "en" -> "English"
            "fr" -> "Français"
            "es" -> "Español"
            "de" -> "Deutsch"
            "it" -> "Italiano"
            "pt-BR", "ptbr" -> "Português (Brasil)"
            "pt-PT", "ptpt" -> "Português (Portugal)"
            "ru" -> "Русский"
            "ja" -> "日本語"
            "ko" -> "한국어"
            "zh" -> "中文 (简体)"
            "zh-Hant", "zhhant" -> "中文 (繁體)"
            "th" -> "ไทย"
            "id" -> "Bahasa Indonesia"
            "ar" -> "العربية"
            "hi" -> "हिन्दी"
            else -> try {
                val locale = Locale.forLanguageTag(code.replace('_', '-'))
                locale.getDisplayName(locale).ifBlank { code }
            } catch (_: Exception) { code }
        }
    }
}

val LocalI18n = compositionLocalOf<I18n> { error("LocalI18n not provided") }

@Composable
fun t(key: String, vararg args: Pair<String, Any>): String {
    return LocalI18n.current.t(key, *args)
}

@Composable
fun randomT(key: String, jokeChance: Double = 0.35): String {
    return LocalI18n.current.randomT(key, jokeChance)
}
