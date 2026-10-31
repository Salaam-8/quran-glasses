package com.quranglasses.core

/**
 * Streaming recitation recognition on top of a non-streaming model (Whisper), fully on device.
 * Same policy as server/asr_server.py so both engines behave alike:
 *  - the rolling buffer is re-transcribed every [step] seconds of new audio;
 *  - LocalAgreement-2: words that two consecutive hypotheses agree on are committed ("final");
 *  - the uncommitted tail is reported as "partial";
 *  - a pause of [silenceFlush] seconds commits whatever is pending.
 */

/** One recognised word; times in seconds relative to the audio handed to the transcriber. */
data class Word(val start: Double, val end: Double, val text: String)

/** Anything that turns 16 kHz mono PCM into timed words (Whisper via JNI, or a fake in tests). */
fun interface Transcriber {
    fun transcribe(pcm: ShortArray, prompt: String): List<Word>
}

sealed class AsrEvent {
    data class Partial(val text: String) : AsrEvent()
    data class Final(val text: String) : AsrEvent()
}

object ArabicNorm {
    private val diacritics = Regex("[ؐ-ًؚ-ٰٟۖ-ۭـ]")
    private val alefs = Regex("[ٱأإآ]")
    private val nonLetters = Regex("[^ء-ي]")

    /** Spelling-insensitive key for comparing hypotheses (same rules as src/engine.js). */
    fun key(w: String): String {
        var s = diacritics.replace(w, "")
        s = alefs.replace(s, "ا").replace('ى', 'ي').replace('ة', 'ه').replace('ؤ', 'و').replace('ئ', 'ي')
        s = nonLetters.replace(s, "")
        return s.replace("ا", "").replace("ء", "")
    }
}

/** Parses the JNI output: one "t0\tt1\tword" line per word. */
object NativeWords {
    fun parse(s: String): List<Word> = s.lineSequence().mapNotNull { line ->
        val p = line.split('\t')
        if (p.size < 3) return@mapNotNull null
        val t0 = p[0].toDoubleOrNull() ?: return@mapNotNull null
        val t1 = p[1].toDoubleOrNull() ?: return@mapNotNull null
        val text = p.subList(2, p.size).joinToString("\t").trim()
        if (text.isEmpty()) null else Word(t0, t1, text)
    }.toList()
}

class StreamingSession(
    private val transcriber: Transcriber,
    val rate: Int = 16000,
    val step: Double = 1.0,
    val maxBuffer: Double = 8.0,
    val keepAfterTrim: Double = 4.0,
    val silenceFlush: Double = 1.2,
    val silenceRms: Double = 300.0,
) {
    private var buf = ShortArray(0)
    private var bufStart = 0.0          // absolute time (s) of buf[0]
    var received = 0.0                  // absolute seconds of audio received
        private set
    private var lastRun = 0.0
    var committedEnd = 0.0              // absolute end time of the last committed word
        private set
    private val committedText = ArrayDeque<String>()
    /** Uncommitted hypothesis from the previous run, absolute times. */
    var pending: List<Word> = emptyList()
        private set
    /** Context from the app: normally the previous ayah. */
    @Volatile var prompt: String = ""
    private var silentSince: Double? = null
    private var noiseFloor = silenceRms

    val bufferedSeconds: Double get() = buf.size.toDouble() / rate
    val bufferStart: Double get() = bufStart

    fun feed(pcm: ShortArray) {
        if (pcm.isEmpty()) return
        val start = received
        buf += pcm
        received += pcm.size.toDouble() / rate
        var sum = 0.0
        for (v in pcm) sum += v.toDouble() * v
        val rms = Math.sqrt(sum / pcm.size)
        // slow adaptive floor (learned from quiet chunks) so a noisy room does not count as speech forever
        if (rms < noiseFloor * 2) noiseFloor = (noiseFloor * 0.95 + rms * 0.05).coerceIn(silenceRms, silenceRms * 4)
        if (rms < noiseFloor * 1.2) {
            if (silentSince == null) silentSince = start
        } else silentSince = null
        if (buf.size > maxBuffer * rate) trim()
    }

    private fun trim() {
        val end = bufStart + buf.size.toDouble() / rate
        var cut = maxOf(committedEnd, end - keepAfterTrim)
        if (pending.isNotEmpty()) cut = minOf(cut, pending[0].start - 0.2)   // never cut words still being decided
        cut = maxOf(cut, end - maxBuffer)                                    // but keep the buffer bounded
        val n = ((cut - bufStart).coerceAtLeast(0.0) * rate).toInt().coerceAtMost(buf.size)
        if (n > 0) {
            buf = buf.copyOfRange(n, buf.size)
            bufStart += n.toDouble() / rate
        }
    }

    fun due(): Boolean = received - lastRun >= step && buf.size >= (0.6 * rate).toInt()

    fun silentTail(): Double = silentSince?.let { received - it } ?: 0.0

    /** Pending words should be committed because the reciter paused. */
    fun pauseFlushDue(): Boolean = pending.isNotEmpty() && silentTail() >= silenceFlush

    fun contextPrompt(): String {
        val tail = committedText.toList().takeLast(12).joinToString(" ")
        return (prompt + " " + tail).trim().takeLast(200)
    }

    /** One transcription pass. */
    fun step(): List<AsrEvent> {
        lastRun = received
        val out = mutableListOf<AsrEvent>()
        if (silentTail() >= silenceFlush) {
            if (pending.isNotEmpty()) {
                out += AsrEvent.Final(commit(pending))
                pending = emptyList()
            }
            return out
        }
        val words = transcriber.transcribe(buf.copyOf(), contextPrompt())
            .map { Word(it.start + bufStart, it.end + bufStart, it.text) }
            .filter { it.end > committedEnd + 0.05 }
        // LocalAgreement-2: commit the prefix both hypotheses agree on
        var k = 0
        while (k < words.size && k < pending.size && ArabicNorm.key(words[k].text) == ArabicNorm.key(pending[k].text)) k++
        if (k > 0) out += AsrEvent.Final(commit(words.subList(0, k)))
        pending = words.drop(k)
        if (pending.isNotEmpty()) out += AsrEvent.Partial(pending.joinToString(" ") { it.text })
        return out
    }

    fun flush(): List<AsrEvent> {
        if (pending.isEmpty()) return emptyList()
        val text = commit(pending)
        pending = emptyList()
        return listOf(AsrEvent.Final(text))
    }

    private fun commit(words: List<Word>): String {
        committedEnd = maxOf(committedEnd, words.last().end)
        words.forEach { committedText.addLast(it.text) }
        while (committedText.size > 40) committedText.removeFirst()
        return words.joinToString(" ") { it.text }
    }
}
