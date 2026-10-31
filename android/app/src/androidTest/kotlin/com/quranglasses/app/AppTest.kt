package com.quranglasses.app

import android.Manifest
import android.view.KeyEvent
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.rule.GrantPermissionRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Runs on an emulator in CI: the page loads offline, the bridge is there, the model loads and decodes. */
@RunWith(AndroidJUnit4::class)
class AppTest {
    @get:Rule val mic: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.RECORD_AUDIO)
    @get:Rule val rule = ActivityScenarioRule(MainActivity::class.java)

    private fun activity(): MainActivity { var a: MainActivity? = null; rule.scenario.onActivity { a = it }; return a!! }

    private fun js(code: String): String {
        val latch = CountDownLatch(1); var out = ""
        rule.scenario.onActivity { it.webView.evaluateJavascript(code) { r -> out = r ?: ""; latch.countDown() } }
        latch.await(15, TimeUnit.SECONDS)
        return out
    }

    private fun waitFor(timeoutMs: Long, what: String, cond: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) { if (cond()) return; Thread.sleep(250) }
        throw AssertionError("timed out waiting for $what")
    }

    @Test fun pageLoadsOfflineWithTheNativeBridge() {
        waitFor(30_000, "page load") { activity().pageLoaded }
        waitFor(10_000, "QuranGlasses") { js("typeof QuranGlasses") == "\"object\"" }
        assertEquals("\"object\"", js("typeof QGNative"))
        assertEquals("\"native\"", js("S.engine"))
        assertEquals("true", js("document.body.classList.contains('focus-mode')"))
        assertEquals("114", js("Q.length"))
        assertTrue(js("document.querySelector('.head').textContent").contains("سورة"))
    }

    @Test fun speechModelLoadsAndDecodesOnDevice() {
        val bridge = activity().bridge
        waitFor(180_000, "model (status=${bridge.status()})") { bridge.status() != "loading" }
        assertEquals("ready", bridge.status())
        val r = bridge.selfTest()
        android.util.Log.i("QgTest", "selfTest $r · ${bridge.info()}")
        assertTrue("selfTest: $r", r.startsWith("ok:"))
    }

    @Test fun hardwareButtonsTurnPages() {
        waitFor(30_000, "page load") { activity().pageLoaded }
        waitFor(10_000, "QuranGlasses") { js("typeof QuranGlasses") == "\"object\"" }
        js("stopMic(); Object.assign(S, LOOK_DEFAULTS); S.top = 90; applyLook(); QuranGlasses.goto(2, 1)")
        val before = js("S.a")
        rule.scenario.onActivity {
            it.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_VOLUME_DOWN))
            it.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_VOLUME_DOWN))
        }
        waitFor(5_000, "page turn") { js("S.a") != before }
        rule.scenario.onActivity {
            it.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
        }
        waitFor(5_000, "pause") { js("paused") == "true" }
    }

    @Test fun deviceSensorReachesThePage() {
        waitFor(30_000, "page load") { activity().pageLoaded }
        waitFor(10_000, "QuranGlasses") { js("typeof QuranGlasses") == "\"object\"" }
        activity().bridge.pushPose(1f, 0f, 0f, 0f)
        waitFor(5_000, "native sensor") { js("QuranGlasses.imu.nativeActive") == "true" }
    }
}
