package com.framezoo.tv.ui

import android.annotation.SuppressLint
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.view.View
import android.view.ViewGroup
import android.graphics.Rect
import android.widget.FrameLayout
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.delay

@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun TrailerBackground(key: String, muted: Boolean, modifier: Modifier = Modifier, paused: Boolean = false, onStatus: ((String) -> Unit)? = null) {
    require(key.matches(Regex("[A-Za-z0-9_-]{11}")))
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var playing by remember(key) { mutableStateOf(false) }
    var failed by remember(key) { mutableStateOf(false) }
    val web = remember(key) {
        object : WebView(context) {
            override fun requestFocus(direction: Int, previouslyFocusedRect: Rect?): Boolean = false
        }.apply {
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            isFocusable = false
            isFocusableInTouchMode = false
            descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = request.isForMainFrame
            }
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    when (message.message()) {
                        "framezoo-trailer-playing" -> playing = true
                        "framezoo-trailer-error" -> { playing = false; failed = true }
                    }
                    return true
                }
            }
            loadDataWithBaseURL("https://framezoo.com/", """
                <html><head><meta name="viewport" content="width=device-width, initial-scale=1" />
                <style>*{margin:0;padding:0}html,body,#player{width:100%;height:100%;background:transparent}</style></head>
                <body><div id="player"></div><script src="https://www.youtube.com/iframe_api"></script><script>
                var player;
                function onYouTubeIframeAPIReady() {
                  player = new YT.Player('player', {videoId:'$key', width:'100%', height:'100%',
                    playerVars:{autoplay:1,mute:1,controls:0,playsinline:1,rel:0,loop:1,playlist:'$key',origin:'https://framezoo.com'},
                    events:{onReady:function(e){e.target.mute();e.target.playVideo()},
                    onStateChange:function(e){if(e.data===YT.PlayerState.PLAYING)console.log('framezoo-trailer-playing')},
                    onError:function(){console.log('framezoo-trailer-error')}}});
                }
                </script></body></html>
            """.trimIndent(), "text/html", "UTF-8", null)
        }
    }
    LaunchedEffect(web) { delay(12_000); if (!playing) failed = true }
    LaunchedEffect(web, failed) { if (failed) web.loadUrl("about:blank") }
    LaunchedEffect(playing, failed) { onStatus?.invoke(if (failed) "error" else if (playing) "playing" else "loading") }
    LaunchedEffect(web, muted, playing) {
        if (playing) web.evaluateJavascript("if(window.player){player.${if (muted) "mute" else "unMute"}()}", null)
    }
    LaunchedEffect(web, paused, playing) {
        if (playing) web.evaluateJavascript("if(window.player){player.${if (paused) "pauseVideo" else "playVideo"}()}", null)
    }
    DisposableEffect(web) { onDispose { web.stopLoading(); web.destroy() } }
    DisposableEffect(web, lifecycle, paused) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE -> web.evaluateJavascript("if(window.player){player.pauseVideo()}", null)
                Lifecycle.Event.ON_RESUME -> if (!paused) web.evaluateJavascript("if(window.player){player.playVideo()}", null)
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    AndroidView(factory = { context ->
        FrameLayout(context).apply {
            isFocusable = false
            descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
    }, modifier = modifier.focusProperties { canFocus = false }.alpha(if (playing && !failed) 1f else 0f))
}
