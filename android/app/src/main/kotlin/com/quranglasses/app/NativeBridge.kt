package com.quranglasses.app

import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.quranglasses.app.asr.RecitationListener
import com.quranglasses.app.asr.WhisperNative
import com.quranglasses.app.asr.WhisperTranscriber
import com.quranglasses.core.AsrEvent
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.Executors
import kotlin.math.PI
import kotlin.math.sin

/**
 * window.QGNative in the page. JavaScript calls arrive on a background thread; results go back to
 * the page with evaluateJavascript on the main thread (window.QGN.onPartial / onFinal / onState / onError).
 */
class NativeBridge(private val activity: MainActivity, private val web: WebView) {
    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var status = "loading"
    @Volatile private var model: WhisperTranscriber? = null
    @Volatile private var listener: RecitationListener? = null
    @Volatile private var context = ""

    fun loadModelAsync(wanted: String? = null) {
        status = "loading"
        worker.execute {
            status = try {
                val all = ModelStore.available(activity)
                if (all.isEmpty()) throw IllegalStateException("لا يوجد نموذج تعرف داخل التطبيق")
                val order = listOfNotNull(wanted?.takeIf { it in all }) + all.filter { it != wanted }
                val threads = Runtime.getRuntime().availableProcessors().coerceIn(2, 4)
                model?.close(); model = null
                val failures = mutableListOf<String>()
                for (name in order) {                      // fall back to the next bundled model
                    val file = ModelStore.ensure(activity, name)
                    model = WhisperTranscriber.load(file.path, name, threads)
                    if (model != null) break
                    failures += "$name (${file.length()} bytes): " + WhisperNative.lastLog().lines().filter { it.isNotBlank() }.takeLast(4).joinToString(" | ")
                }
                if (model == null) throw IllegalStateException("تعذّر تحميل النموذج: " + failures.joinToString(" ; "))
                "ready"
            } catch (e: Throwable) {
                "error: ${e.message}"
            }
        }
    }

    @JavascriptInterface fun available(): Boolean = true

    /**
     * Device ID for subscription codes: 10 base32 characters derived from ANDROID_ID (stable per device and
     * signing key, survives app updates; changes on factory reset). Replace with the glasses' hardware serial
     * from the vendor SDK once available.
     */
    @JavascriptInterface fun deviceId(): String {
        val raw = Settings.Secure.getString(activity.contentResolver, Settings.Secure.ANDROID_ID) ?: return ""
        val h = MessageDigest.getInstance("SHA-256").digest("quran-glasses:$raw".toByteArray())
        val alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        return (0 until 10).map { alphabet[(h[it].toInt() and 0xff) % 32] }.joinToString("")
    }
    @JavascriptInterface fun status(): String = status

    @JavascriptInterface fun info(): String = JSONObject()
        .put("status", status)
        .put("model", model?.modelName ?: "")
        .put("threads", model?.threads ?: 0)
        .put("models", ModelStore.available(activity).joinToString(","))
        .put("system", runCatching { WhisperNative.systemInfo() }.getOrDefault(""))
        .toString()

    @JavascriptInterface fun setModel(name: String) {
        stop(); loadModelAsync(name)
    }

    @JavascriptInterface fun setContext(prompt: String) {
        context = prompt
        listener?.prompt = prompt
    }

    @JavascriptInterface fun start() {
        activity.runOnUiThread {
            activity.withMicPermission { granted ->
                if (!granted) { emit("onError", "المايك مرفوض. اسمح للتطبيق باستخدام الميكروفون من الإعدادات"); return@withMicPermission }
                worker.execute { startListening() }
            }
        }
    }

    @JavascriptInterface fun stop() {
        val l = listener
        listener = null
        if (l != null) worker.execute { l.stop() }
    }

    /** Used by the instrumentation test: runs the loaded model on 1 s of silence and 1 s of a tone. */
    @JavascriptInterface fun selfTest(): String {
        val m = model ?: return "no-model:$status"
        val silence = ShortArray(16000)
        val tone = ShortArray(16000) { (6000 * sin(2 * PI * 220 * it / 16000)).toInt().toShort() }
        val t0 = System.nanoTime()
        val a = m.transcribe(silence, "")
        val b = m.transcribe(tone, "")
        val ms = (System.nanoTime() - t0) / 1_000_000
        return "ok:${a.size}:${b.size}:${ms}ms"
    }

    private fun startListening() {
        val m = model
        if (m == null) { emit("onError", "نموذج التعرف غير جاهز: $status"); return }
        listener?.stop()
        val l = RecitationListener(m,
            onEvent = { e -> when (e) { is AsrEvent.Partial -> emit("onPartial", e.text); is AsrEvent.Final -> emit("onFinal", e.text) } },
            onError = { msg -> emit("onError", msg) })
        l.prompt = context
        if (l.start()) { listener = l; emit("onState", "listening") }
    }

    fun pushPose(w: Float, x: Float, y: Float, z: Float) = js("window.QuranGlasses && QuranGlasses.pushQuat($w,$x,$y,$z)")

    fun key(name: String) = js("window.QuranGlasses && QuranGlasses.key(${JSONObject.quote(name)})")

    private fun emit(fn: String, arg: String) = js("window.QGN && QGN.$fn(${JSONObject.quote(arg)})")

    private fun js(code: String) { web.post { web.evaluateJavascript(code, null) } }

    fun release() {
        listener?.stop(); listener = null
        worker.execute { model?.close(); model = null }
        worker.shutdown()
    }
}
