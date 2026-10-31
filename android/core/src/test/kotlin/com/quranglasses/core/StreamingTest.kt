package com.quranglasses.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin

/** Same scenarios as tests/test_server.py, so the device and the server behave alike. */
class StreamingTest {
    private val rate = 16000

    /** Hears SCRIPT at 2 words per second of non-silent audio. */
    private class FakeTranscriber : Transcriber {
        val script = "الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين إياك نعبد وإياك نستعين".split(" ")
        var calls = 0
        var lastPrompt = ""
        override fun transcribe(pcm: ShortArray, prompt: String): List<Word> {
            calls++; lastPrompt = prompt
            if (pcm.map { Math.abs(it.toInt()) }.average() < 50) return emptyList()
            val n = minOf(script.size, (pcm.size.toDouble() / 16000 * 2).toInt())
            return (0 until n).map { Word(it * 0.5, it * 0.5 + 0.45, script[it]) }
        }
    }

    private fun tone(sec: Double, amp: Double = 3000.0) =
        ShortArray((sec * rate).toInt()) { (amp * sin(2 * PI * 220 * it / rate)).toInt().toShort() }

    private fun silence(sec: Double) = ShortArray((sec * rate).toInt())

    // the server's step is 0.5 s; use the same here so the scripted expectations carry over
    private fun session(t: Transcriber = FakeTranscriber()) = StreamingSession(t, step = 0.5)

    @Test fun localAgreementCommitsWhatTwoPassesAgreeOn() {
        val s = session()
        s.feed(tone(1.0)); assertTrue(s.due())
        val m1 = s.step()
        assertEquals(listOf(AsrEvent.Partial("الحمد لله")), m1)
        s.feed(tone(0.5))
        val m2 = s.step()
        assertEquals(AsrEvent.Final("الحمد لله"), m2[0])
        assertEquals(AsrEvent.Partial("رب"), m2[1])
        s.feed(tone(0.5))
        assertEquals(AsrEvent.Final("رب"), s.step()[0])
        assertEquals(1.45, s.committedEnd, 1e-9)
        assertTrue(s.contextPrompt().endsWith("الحمد لله رب"))
    }

    @Test fun pauseCommitsThePendingTail() {
        val s = session()
        s.feed(tone(1.0)); s.step(); s.feed(tone(0.5)); s.step(); s.feed(tone(0.5)); s.step()
        s.feed(silence(1.3))
        assertTrue(s.silentTail() >= s.silenceFlush)
        assertTrue(s.pauseFlushDue())
        assertEquals(listOf(AsrEvent.Final("العالمين")), s.step())
        assertTrue(s.pending.isEmpty())
    }

    @Test fun bufferStaysBoundedAndKeepsWorking() {
        val s = session()
        repeat(30) { s.feed(tone(0.5)) }
        assertTrue(s.bufferedSeconds <= s.maxBuffer + 1e-9)
        assertTrue(s.bufferStart > 0)
        s.step(); s.feed(tone(0.5)); s.step()
        assertTrue(s.pending.isNotEmpty() || s.committedEnd > 0)
    }

    @Test fun promptCarriesAppContextAndCommittedWords() {
        val t = FakeTranscriber()
        val s = session(t)
        s.prompt = "بسم الله الرحمن الرحيم"
        s.feed(tone(1.0)); s.step(); s.feed(tone(0.5)); s.step(); s.feed(tone(0.5)); s.step()
        assertTrue(t.lastPrompt.startsWith("بسم الله الرحمن الرحيم"))
        assertTrue(t.lastPrompt.contains("الحمد لله"))
    }

    @Test fun silenceNeverCallsTheModelForNothing() {
        val t = FakeTranscriber()
        val s = session(t)
        s.feed(silence(2.0))
        assertTrue(s.step().isEmpty())
        assertEquals(0, t.calls)
    }

    @Test fun flushOnStop() {
        val s = session()
        s.feed(tone(1.0)); s.step()
        assertEquals(listOf(AsrEvent.Final("الحمد لله")), s.flush())
        assertTrue(s.flush().isEmpty())
    }

    @Test fun defaultStepIsOneSecondOnDevice() {
        val s = StreamingSession(FakeTranscriber())
        s.feed(tone(0.7)); assertTrue(!s.due())
        s.feed(tone(0.4)); assertTrue(s.due())
    }

    @Test fun normalisationUnifiesUthmaniAndPlainSpelling() {
        assertEquals(ArabicNorm.key("ٱلْحَمْدُ"), ArabicNorm.key("الحمد"))
        assertEquals("يك", ArabicNorm.key("إِيَّاكَ"))
    }

    @Test fun parsesNativeOutput() {
        val w = NativeWords.parse("0.000000\t0.420000\tالحمد\n0.420000\t0.800000\tلله\n\nbad line\n")
        assertEquals(listOf(Word(0.0, 0.42, "الحمد"), Word(0.42, 0.8, "لله")), w)
        assertTrue(NativeWords.parse("").isEmpty())
    }
}
