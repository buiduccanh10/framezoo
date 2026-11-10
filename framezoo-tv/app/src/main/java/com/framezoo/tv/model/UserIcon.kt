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
 * Mirrors framezoo-desktop `UserIcons` enum (UserIcon.tsx) & `IconPicker.tsx` / `ColorPicker.tsx`.
 * Contains all 58 user avatar icons with exact key strings and typed graphics.
 */
enum class UserIcon(val key: String) {
    // Standard Object / Symbol SVG Icons (from UserIcon.tsx)
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

    // Face Emojis (from UserIcon.tsx)
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
        // Face Emojis
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

        // Exact Vector Drawables generated from UserIcon.tsx SVGs
        CAT -> UserIconGraphic.VectorRes(R.drawable.user_icon_cat)
        WEED -> UserIconGraphic.VectorRes(R.drawable.user_icon_weed)
        USER_GROUP -> UserIconGraphic.VectorRes(R.drawable.user_icon_user_group)
        COUCH -> UserIconGraphic.VectorRes(R.drawable.user_icon_couch)
        MOBILE -> UserIconGraphic.VectorRes(R.drawable.user_icon_mobile)
        TICKET -> UserIconGraphic.VectorRes(R.drawable.user_icon_ticket)
        SATURN -> UserIconGraphic.VectorRes(R.drawable.user_icon_saturn)
        HEADPHONES -> UserIconGraphic.VectorRes(R.drawable.user_icon_headphones)
        TV -> UserIconGraphic.VectorRes(R.drawable.user_icon_tv)
        GHOST -> UserIconGraphic.VectorRes(R.drawable.user_icon_ghost)
        COFFEE -> UserIconGraphic.VectorRes(R.drawable.user_icon_coffee)
        FIRE -> UserIconGraphic.VectorRes(R.drawable.user_icon_fire)
        MEGAPHONE -> UserIconGraphic.VectorRes(R.drawable.user_icon_megaphone)
        DRAGON -> UserIconGraphic.VectorRes(R.drawable.user_icon_dragon)
        RISING_STAR -> UserIconGraphic.VectorRes(R.drawable.user_icon_rising_star)
        CLOUD_ARROW_UP -> UserIconGraphic.VectorRes(R.drawable.user_icon_cloud_arrow_up)
        WAND -> UserIconGraphic.VectorRes(R.drawable.user_icon_wand)
        CLAPPER_BOARD -> UserIconGraphic.VectorRes(R.drawable.user_icon_clapper_board)
        FILM -> UserIconGraphic.VectorRes(R.drawable.user_icon_film)
        PLAY -> UserIconGraphic.VectorRes(R.drawable.user_icon_play)
        WATCH_PARTY -> UserIconGraphic.VectorRes(R.drawable.user_icon_watch_party)
        TACHOMETER -> UserIconGraphic.VectorRes(R.drawable.user_icon_tachometer)
        CIRCLE_QUESTION -> UserIconGraphic.VectorRes(R.drawable.user_icon_circle_question)
        BRUSH -> UserIconGraphic.VectorRes(R.drawable.user_icon_brush)
        BELL -> UserIconGraphic.VectorRes(R.drawable.user_icon_bell)
        THUMBS_UP -> UserIconGraphic.VectorRes(R.drawable.user_icon_thumbs_up)
        BOOKMARK -> UserIconGraphic.VectorRes(R.drawable.user_icon_bookmark)
        FIREFOX -> UserIconGraphic.VectorRes(R.drawable.user_icon_firefox)
        CHROME -> UserIconGraphic.VectorRes(R.drawable.user_icon_chrome)
        SAFARI -> UserIconGraphic.VectorRes(R.drawable.user_icon_safari)
        ORION -> UserIconGraphic.VectorRes(R.drawable.user_icon_orion)
        EDGE -> UserIconGraphic.VectorRes(R.drawable.user_icon_edge)

        DEFAULT -> UserIconGraphic.VectorRes(R.drawable.desktop_user)
    }

    companion object {
        private val KEY_MAP = entries.associateBy { it.key.lowercase() }

        /**
         * Mirrors `classicIconList` in `IconPicker.tsx` (26 icons).
         */
        val CLASSIC_ICONS: List<UserIcon> = listOf(
            CAT,
            WEED,
            USER_GROUP,
            COUCH,
            MOBILE,
            TICKET,
            SATURN,
            HEADPHONES,
            TV,
            GHOST,
            COFFEE,
            FIRE,
            MEGAPHONE,
            DRAGON,
            RISING_STAR,
            CLOUD_ARROW_UP,
            WAND,
            CLAPPER_BOARD,
            FILM,
            PLAY,
            WATCH_PARTY,
            TACHOMETER,
            CIRCLE_QUESTION,
            BRUSH,
            BELL,
            THUMBS_UP
        )

        /**
         * Mirrors `emojiIconList` in `IconPicker.tsx` (26 icons).
         */
        val EMOJI_ICONS: List<UserIcon> = listOf(
            CAT_FACE,
            DOG_FACE,
            FOX_FACE,
            PANDA_FACE,
            KOALA_FACE,
            TIGER_FACE,
            RABBIT_FACE,
            BEAR_FACE,
            MONKEY_FACE,
            PIG_FACE,
            UNICORN_FACE,
            CHICK_FACE,
            FROG_FACE,
            ROBOT_FACE,
            ALIEN_FACE,
            GRINNING_FACE,
            SMILING_FACE,
            JOY_FACE,
            COOL_FACE,
            HEART_EYES_FACE,
            WINK_FACE,
            THINKING_FACE,
            NERD_FACE,
            PLEADING_FACE,
            SLEEPY_FACE,
            ANGEL_FACE
        )

        /**
         * Mirrors `colors` in `ColorPicker.tsx`.
         */
        val AVATAR_COLORS: List<String> = listOf(
            "#0A54FF",
            "#CF2E68",
            "#F9DD7F",
            "#7652DD",
            "#2ECFA8"
        )

        val INITIAL_COLOR: String = AVATAR_COLORS.first()
        val INITIAL_ICON: UserIcon = CLASSIC_ICONS.first()

        fun fromKey(raw: String?): UserIcon {
            if (raw.isNullOrBlank()) return DEFAULT
            val clean = raw.trim().lowercase()
            return KEY_MAP[clean] ?: DEFAULT
        }
    }
}
