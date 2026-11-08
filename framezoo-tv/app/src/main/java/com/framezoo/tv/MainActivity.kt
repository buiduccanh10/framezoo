package com.framezoo.tv

import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.framezoo.tv.ui.FrameZooApp

class MainActivity : ComponentActivity() {
    var moveDownFromText: (() -> Boolean)? = null

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && event.keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
            val handler = moveDownFromText
            if (handler != null) {
                val imm = getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as? android.view.inputmethod.InputMethodManager
                imm?.hideSoftInputFromWindow(window.decorView.windowToken, 0)
                if (handler.invoke()) return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val initialPage = intent.getStringExtra("page")
        setContent { FrameZooApp(initialPage = initialPage) }
    }
}

