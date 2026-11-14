package com.framezoo.tv.api

import org.json.JSONObject

internal data class SyncedSettingsSnapshot(
    val applicationLanguage: String? = null,
    val applicationTheme: String? = null,
    val hasApplicationTheme: Boolean = false,
    val defaultSubtitleLanguage: String? = null,
    val enableAutoplay: Boolean? = null,
    val enableSkipCredits: Boolean? = null,
    val enableAutoSkipSegments: Boolean? = null,
    val customPrimary: String? = null,
    val customSecondary: String? = null,
    val customTertiary: String? = null,
)

internal fun parseBackendSettingsJson(
    obj: JSONObject,
    validThemes: Set<String>
): SyncedSettingsSnapshot {
    fun optBool(key: String): Boolean? =
        if (obj.has(key) && !obj.isNull(key)) obj.optBoolean(key) else null

    val hasTheme = obj.has("applicationTheme")
    val parsedTheme = when {
        !hasTheme -> null
        obj.isNull("applicationTheme") -> "default"
        else -> obj.optString("applicationTheme").trim().lowercase()
            .takeIf { it in validThemes } ?: "default"
    }

    val rawLang = if (obj.has("applicationLanguage") && !obj.isNull("applicationLanguage")) {
        obj.optString("applicationLanguage").trim().takeIf { it.isNotBlank() }
    } else null

    val rawDefaultSub = if (obj.has("defaultSubtitleLanguage") && !obj.isNull("defaultSubtitleLanguage")) {
        obj.optString("defaultSubtitleLanguage").trim().takeIf { it.isNotBlank() }
    } else null

    val customObj = obj.optJSONObject("customTheme")
    val partThemes = validThemes - "custom"
    fun validPart(key: String): String? = customObj?.optString(key)?.trim()?.lowercase()?.takeIf { it in partThemes }

    return SyncedSettingsSnapshot(
        applicationLanguage = rawLang,
        applicationTheme = parsedTheme,
        hasApplicationTheme = hasTheme,
        defaultSubtitleLanguage = rawDefaultSub,
        enableAutoplay = optBool("enableAutoplay"),
        enableSkipCredits = optBool("enableSkipCredits"),
        enableAutoSkipSegments = optBool("enableAutoSkipSegments"),
        customPrimary = validPart("primary"),
        customSecondary = validPart("secondary"),
        customTertiary = validPart("tertiary"),
    )
}

internal fun buildBackendSettingsJson(
    applicationLanguage: String,
    applicationTheme: String,
    defaultSubtitleLanguage: String?,
    enableAutoplay: Boolean,
    enableSkipCredits: Boolean,
    enableAutoSkipSegments: Boolean,
    customPrimary: String,
    customSecondary: String,
    customTertiary: String,
): JSONObject = JSONObject().apply {
    put("applicationLanguage", applicationLanguage)
    put("applicationTheme", if (applicationTheme == "default") JSONObject.NULL else applicationTheme)
    if (!defaultSubtitleLanguage.isNullOrBlank()) {
        put("defaultSubtitleLanguage", defaultSubtitleLanguage)
    }
    put("enableAutoplay", enableAutoplay)
    put("enableSkipCredits", enableSkipCredits)
    put("enableAutoSkipSegments", enableAutoSkipSegments)
    put(
        "customTheme",
        JSONObject()
            .put("primary", customPrimary)
            .put("secondary", customSecondary)
            .put("tertiary", customTertiary)
    )
}
