package com.quranglasses.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader

/**
 * The whole reader runs as the same offline web page used on GitHub Pages (dist/android/web),
 * served from the APK. Native parts: on-device speech recognition, the device's rotation sensor,
 * and hardware buttons. No network permission.
 */
class MainActivity : ComponentActivity() {
    lateinit var webView: WebView
        private set
    lateinit var bridge: NativeBridge
        private set
    private lateinit var pose: PoseSource
    @Volatile var pageLoaded = false
        private set

    private var micCallback: ((Boolean) -> Unit)? = null
    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        micCallback?.invoke(granted); micCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true          // settings and the saved position live in localStorage
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)
                override fun onPageFinished(view: WebView, url: String) { pageLoaded = true }
            }
        }
        bridge = NativeBridge(this, webView)
        webView.addJavascriptInterface(bridge, "QGNative")
        setContentView(webView)
        bridge.loadModelAsync()
        webView.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")

        pose = PoseSource(this) { w, x, y, z -> bridge.pushPose(w, x, y, z) }
    }

    fun withMicPermission(cb: (Boolean) -> Unit) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) cb(true)
        else { micCallback = cb; micPermission.launch(Manifest.permission.RECORD_AUDIO) }
    }

    override fun onResume() { super.onResume(); pose.start() }
    override fun onPause() { pose.stop(); super.onPause() }
    override fun onDestroy() { bridge.release(); webView.destroy(); super.onDestroy() }

    /**
     * Hardware buttons on glasses: volume down = next page, volume up = previous page,
     * play/pause (or a headset button) = pause / resume tracking, menu = show the settings.
     * Everything else (D-pad, Enter, keyboard) goes to the page, which already handles it.
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val action = when (event.keyCode) {
            KeyEvent.KEYCODE_VOLUME_DOWN, KeyEvent.KEYCODE_PAGE_DOWN, KeyEvent.KEYCODE_MEDIA_NEXT -> "next"
            KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_PAGE_UP, KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "prev"
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK,
            KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> "pause"
            KeyEvent.KEYCODE_MENU -> "settings"
            else -> null
        } ?: return super.dispatchKeyEvent(event)
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) bridge.key(action)
        return true
    }
}
