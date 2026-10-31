package com.quranglasses.app.asr

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import com.quranglasses.core.AsrEvent
import com.quranglasses.core.StreamingSession
import com.quranglasses.core.Transcriber
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Microphone -> StreamingSession -> events, fully on device.
 * Two threads: capture only reads the mic and queues 100 ms chunks; decode owns the session
 * (feeds chunks, runs the model when due), so a slow decode never drops audio.
 */
class RecitationListener(
    transcriber: Transcriber,
    private val onEvent: (AsrEvent) -> Unit,
    private val onError: (String) -> Unit,
) {
    private val session = StreamingSession(transcriber)
    private val queue = LinkedBlockingQueue<ShortArray>()
    @Volatile private var running = false
    private var record: AudioRecord? = null
    private var capture: Thread? = null
    private var decode: Thread? = null
    private val effects = mutableListOf<android.media.audiofx.AudioEffect>()

    var prompt: String
        get() = session.prompt
        set(v) { session.prompt = v }

    @SuppressLint("MissingPermission")   // the caller checks RECORD_AUDIO first
    fun start(): Boolean {
        if (running) return true
        val rate = session.rate
        val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (min <= 0) { onError("المايك غير متاح على هذا الجهاز"); return false }
        val rec = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, maxOf(min, rate * 2 / 5))
        } catch (e: Exception) { onError("تعذّر فتح المايك: ${e.message}"); return false }
        if (rec.state != AudioRecord.STATE_INITIALIZED) { rec.release(); onError("تعذّر فتح المايك"); return false }
        if (NoiseSuppressor.isAvailable()) NoiseSuppressor.create(rec.audioSessionId)?.let { it.enabled = true; effects += it }
        if (AutomaticGainControl.isAvailable()) AutomaticGainControl.create(rec.audioSessionId)?.let { it.enabled = true; effects += it }
        record = rec
        running = true
        rec.startRecording()

        capture = Thread({
            val chunk = rate / 10
            while (running) {
                val buf = ShortArray(chunk)
                var off = 0
                while (running && off < chunk) {
                    val n = rec.read(buf, off, chunk - off)
                    if (n < 0) { running = false; onError("انقطع المايك"); break }
                    off += n
                }
                if (off > 0) queue.put(if (off == chunk) buf else buf.copyOf(off))
            }
        }, "qg-capture").apply { start() }

        decode = Thread({
            try {
                while (running) {
                    val c = queue.poll(200, TimeUnit.MILLISECONDS) ?: continue
                    session.feed(c)
                    while (true) session.feed(queue.poll() ?: break)    // catch up after a slow decode
                    if (session.due() || session.pauseFlushDue()) session.step().forEach(onEvent)
                }
                session.flush().forEach(onEvent)
            } catch (e: Throwable) {
                onError("خطأ في التعرف على الصوت: ${e.message}")
            }
        }, "qg-decode").apply { priority = Thread.MAX_PRIORITY; start() }
        return true
    }

    fun stop() {
        if (!running && record == null) return
        running = false
        capture?.join(1000); decode?.join(5000)
        capture = null; decode = null
        effects.forEach { runCatching { it.release() } }; effects.clear()
        record?.let { runCatching { it.stop() }; it.release() }
        record = null
        queue.clear()
    }
}
