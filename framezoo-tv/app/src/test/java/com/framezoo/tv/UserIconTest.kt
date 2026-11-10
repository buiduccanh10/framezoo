package com.framezoo.tv

import com.framezoo.tv.model.UserIcon
import com.framezoo.tv.model.UserIconGraphic
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UserIconTest {

    @Test
    fun testAllDesktopIconsMapped() {
        val svgKeys = listOf(
            "cat", "weed", "user_group", "couch", "mobile", "ticket", "saturn", "headphones",
            "tv", "ghost", "coffee", "fire", "megaphone", "dragon", "rising_star",
            "cloud_arrow_up", "wand", "clapper_board", "film", "play", "watch_party",
            "tachometer", "circle_question", "brush", "bell", "thumbs_up", "bookmark",
            "firefox", "chrome", "safari", "orion", "edge"
        )
        val emojiKeys = listOf(
            "cat_face", "dog_face", "fox_face", "panda_face", "koala_face", "tiger_face",
            "rabbit_face", "bear_face", "monkey_face", "pig_face", "unicorn_face",
            "chick_face", "frog_face", "robot_face", "alien_face", "grinning_face",
            "smiling_face", "joy_face", "cool_face", "heart_eyes_face", "wink_face",
            "thinking_face", "nerd_face", "pleading_face", "sleepy_face", "angel_face"
        )

        for (key in svgKeys) {
            val icon = UserIcon.fromKey(key)
            assertNotNull("UserIcon for key $key should not be null", icon)
            val graphic = icon.toGraphic()
            assertTrue(
                "Graphic for $key must be VectorRes",
                graphic is UserIconGraphic.VectorRes
            )
        }

        for (key in emojiKeys) {
            val icon = UserIcon.fromKey(key)
            assertNotNull("UserIcon for key $key should not be null", icon)
            val graphic = icon.toGraphic()
            assertTrue(
                "Graphic for $key must be Emoji",
                graphic is UserIconGraphic.Emoji
            )
        }
    }

    @Test
    fun testPickerListsAndColorsMatchDesktop() {
        assertEquals(26, UserIcon.CLASSIC_ICONS.size)
        assertEquals(26, UserIcon.EMOJI_ICONS.size)
        assertEquals(5, UserIcon.AVATAR_COLORS.size)
        assertEquals("#0A54FF", UserIcon.INITIAL_COLOR)
        assertEquals(UserIcon.CAT, UserIcon.INITIAL_ICON)
    }

    @Test
    fun testFallbackForInvalidKeys() {
        assertEquals(UserIcon.DEFAULT, UserIcon.fromKey(null))
        assertEquals(UserIcon.DEFAULT, UserIcon.fromKey(""))
        assertEquals(UserIcon.DEFAULT, UserIcon.fromKey("   "))
        assertEquals(UserIcon.DEFAULT, UserIcon.fromKey("unknown_non_existent_key"))
    }

    @Test
    fun testCaseInsensitiveKeyResolution() {
        assertEquals(UserIcon.PANDA_FACE, UserIcon.fromKey("PANDA_FACE"))
        assertEquals(UserIcon.COOL_FACE, UserIcon.fromKey("Cool_Face"))
        assertEquals(UserIcon.CLOUD_ARROW_UP, UserIcon.fromKey("Cloud_Arrow_Up"))
    }

    @Test
    fun testFaceEmojisHaveCorrectUnicode() {
        val graphic = UserIcon.CAT_FACE.toGraphic() as UserIconGraphic.Emoji
        assertEquals("🐱", graphic.char)

        val pleading = UserIcon.PLEADING_FACE.toGraphic() as UserIconGraphic.Emoji
        assertEquals("🥺", pleading.char)
    }
}
