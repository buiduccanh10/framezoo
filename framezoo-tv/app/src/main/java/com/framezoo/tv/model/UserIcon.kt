package com.framezoo.tv.model

import androidx.annotation.DrawableRes
import com.framezoo.tv.R

/**
 * Graphic representation of a UserIcon on Android TV.
 */
sealed interface UserIconGraphic {
    data class Emoji(val char: String) : UserIconGraphic
    data class VectorRes(@DrawableRes val resId: Int) : UserIconGraphic
}

/**
 * Mirrors framezoo-desktop `UserIcons` enum (UserIcon.tsx).
 * Contains all 58 user avatar icons with exact key strings and typed graphics.
 */
enum class UserIcon(val key: String) {
    // Standard Object / Symbol Icons
    CAT("cat"),
    WEED("weed"),
    USER_GROUP("user_group"),
    COUCH("couch"),
    MOBILE("mobile"),
    TICKET("ticket"),
    SATURN("saturn"),
    HEADPHONES("headphones"),
    TV("tv"),
    GHOST("ghost"),
    COFFEE("coffee"),
    FIRE("fire"),
    MEGAPHONE("megaphone"),
    DRAGON("dragon"),
    RISING_STAR("rising_star"),
    CLOUD_ARROW_UP("cloud_arrow_up"),
    WAND("wand"),
    CLAPPER_BOARD("clapper_board"),
    FILM("film"),
    PLAY("play"),
    WATCH_PARTY("watch_party"),
    TACHOMETER("tachometer"),
    CIRCLE_QUESTION("circle_question"),
    BRUSH("brush"),
    BELL("bell"),
    THUMBS_UP("thumbs_up"),
    BOOKMARK("bookmark"),
    FIREFOX("firefox"),
    CHROME("chrome"),
    SAFARI("safari"),
    ORION("orion"),
    EDGE("edge"),

    // Face Emojis
    CAT_FACE("cat_face"),
    DOG_FACE("dog_face"),
    FOX_FACE("fox_face"),
    PANDA_FACE("panda_face"),
    KOALA_FACE("koala_face"),
    TIGER_FACE("tiger_face"),
    RABBIT_FACE("rabbit_face"),
    BEAR_FACE("bear_face"),
    MONKEY_FACE("monkey_face"),
    PIG_FACE("pig_face"),
    UNICORN_FACE("unicorn_face"),
    CHICK_FACE("chick_face"),
    FROG_FACE("frog_face"),
    ROBOT_FACE("robot_face"),
    ALIEN_FACE("alien_face"),
    GRINNING_FACE("grinning_face"),
    SMILING_FACE("smiling_face"),
    JOY_FACE("joy_face"),
    COOL_FACE("cool_face"),
    HEART_EYES_FACE("heart_eyes_face"),
    WINK_FACE("wink_face"),
    THINKING_FACE("thinking_face"),
    NERD_FACE("nerd_face"),
    PLEADING_FACE("pleading_face"),
    SLEEPY_FACE("sleepy_face"),
    ANGEL_FACE("angel_face"),

    // Default Fallback
    DEFAULT("user");

    fun toGraphic(): UserIconGraphic = when (this) {
        // Emojis
        CAT_FACE -> UserIconGraphic.Emoji("🐱")
        DOG_FACE -> UserIconGraphic.Emoji("🐶")
        FOX_FACE -> UserIconGraphic.Emoji("🦊")
        PANDA_FACE -> UserIconGraphic.Emoji("🐼")
        KOALA_FACE -> UserIconGraphic.Emoji("🐨")
        TIGER_FACE -> UserIconGraphic.Emoji("🐯")
        RABBIT_FACE -> UserIconGraphic.Emoji("🐰")
        BEAR_FACE -> UserIconGraphic.Emoji("🐻")
        MONKEY_FACE -> UserIconGraphic.Emoji("🐵")
        PIG_FACE -> UserIconGraphic.Emoji("🐷")
        UNICORN_FACE -> UserIconGraphic.Emoji("🦄")
        CHICK_FACE -> UserIconGraphic.Emoji("🐥")
        FROG_FACE -> UserIconGraphic.Emoji("🐸")
        ROBOT_FACE -> UserIconGraphic.Emoji("🤖")
        ALIEN_FACE -> UserIconGraphic.Emoji("👽")
        GRINNING_FACE -> UserIconGraphic.Emoji("😀")
        SMILING_FACE -> UserIconGraphic.Emoji("😊")
        JOY_FACE -> UserIconGraphic.Emoji("😂")
        COOL_FACE -> UserIconGraphic.Emoji("😎")
        HEART_EYES_FACE -> UserIconGraphic.Emoji("😍")
        WINK_FACE -> UserIconGraphic.Emoji("😉")
        THINKING_FACE -> UserIconGraphic.Emoji("🤔")
        NERD_FACE -> UserIconGraphic.Emoji("🤓")
        PLEADING_FACE -> UserIconGraphic.Emoji("🥺")
        SLEEPY_FACE -> UserIconGraphic.Emoji("😴")
        ANGEL_FACE -> UserIconGraphic.Emoji("😇")

        // Vector Drawables available in app
        CLOUD_ARROW_UP -> UserIconGraphic.VectorRes(R.drawable.desktop_cloud_arrow_up)
        WATCH_PARTY -> UserIconGraphic.VectorRes(R.drawable.desktop_watch_party)
        BOOKMARK -> UserIconGraphic.VectorRes(R.drawable.desktop_bookmark)
        FILM -> UserIconGraphic.VectorRes(R.drawable.desktop_film)
        PLAY -> UserIconGraphic.VectorRes(R.drawable.desktop_play)
        CIRCLE_QUESTION -> UserIconGraphic.VectorRes(R.drawable.desktop_question)

        // Expressive Icons
        CAT -> UserIconGraphic.Emoji("🐈")
        WEED -> UserIconGraphic.Emoji("🌿")
        USER_GROUP -> UserIconGraphic.Emoji("👥")
        COUCH -> UserIconGraphic.Emoji("🛋️")
        MOBILE -> UserIconGraphic.Emoji("📱")
        TICKET -> UserIconGraphic.Emoji("🎟️")
        SATURN -> UserIconGraphic.Emoji("🪐")
        HEADPHONES -> UserIconGraphic.Emoji("🎧")
        TV -> UserIconGraphic.Emoji("📺")
        GHOST -> UserIconGraphic.Emoji("👻")
        COFFEE -> UserIconGraphic.Emoji("☕")
        FIRE -> UserIconGraphic.Emoji("🔥")
        MEGAPHONE -> UserIconGraphic.Emoji("📢")
        DRAGON -> UserIconGraphic.Emoji("🐉")
        RISING_STAR -> UserIconGraphic.Emoji("⭐")
        WAND -> UserIconGraphic.Emoji("🪄")
        CLAPPER_BOARD -> UserIconGraphic.Emoji("🎬")
        TACHOMETER -> UserIconGraphic.Emoji("⚡")
        BRUSH -> UserIconGraphic.Emoji("🎨")
        BELL -> UserIconGraphic.Emoji("🔔")
        THUMBS_UP -> UserIconGraphic.Emoji("👍")
        FIREFOX -> UserIconGraphic.Emoji("🦊")
        CHROME -> UserIconGraphic.Emoji("🌐")
        SAFARI -> UserIconGraphic.Emoji("🧭")
        ORION -> UserIconGraphic.Emoji("🌌")
        EDGE -> UserIconGraphic.Emoji("🌊")

        DEFAULT -> UserIconGraphic.VectorRes(R.drawable.desktop_user)
    }

    companion object {
        private val KEY_MAP = entries.associateBy { it.key.lowercase() }

        fun fromKey(raw: String?): UserIcon {
            if (raw.isNullOrBlank()) return DEFAULT
            val clean = raw.trim().lowercase()
            return KEY_MAP[clean] ?: DEFAULT
        }
    }
}
