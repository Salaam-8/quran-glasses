package com.quranglasses.app.asr

import com.quranglasses.core.NativeWords
import com.quranglasses.core.Transcriber
import com.quranglasses.core.Word

/** JNI entry points implemented in src/main/cpp/jni.cpp (whisper.cpp underneath). */
object WhisperNative {
    init { System.loadLibrary("qgwhisper") }

    @JvmStatic external fun init(modelPath: String, threads: Int): Long
    @JvmStatic external fun transcribe(handle: Long, pcm: FloatArray, prompt: String, audioCtx: Int): String
    @JvmStatic external fun free(handle: Long)
    @JvmStatic external fun systemInfo(): String
    @JvmStatic external fun lastLog(): String
}

/** The on-device Quran-tuned Whisper model as a [Transcriber] for the streaming session. */
class WhisperTranscriber private constructor(private var handle: Long, val modelName: String, val threads: Int) : Transcriber {

    override fun transcribe(pcm: ShortArray, prompt: String): List<Word> {
        val h = handle
        if (h == 0L || pcm.isEmpty()) return emptyList()
        val f = FloatArray(pcm.size) { pcm[it] / 32768f }
        return NativeWords.parse(WhisperNative.transcribe(h, f, prompt, 0))
    }

    fun close() {
        val h = handle
        handle = 0
        if (h != 0L) WhisperNative.free(h)
    }

    companion object {
        /** Loads the model; returns null when the file cannot be loaded. Slow: call off the main thread. */
        fun load(path: String, name: String, threads: Int): WhisperTranscriber? {
            val h = WhisperNative.init(path, threads)
            return if (h == 0L) null else WhisperTranscriber(h, name, threads)
        }
    }
}
