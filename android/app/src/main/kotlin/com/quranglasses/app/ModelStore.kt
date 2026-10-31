package com.quranglasses.app

import android.content.Context
import java.io.File

/**
 * Speech models ship inside the APK (assets/models/<name>.bin, uncompressed). whisper.cpp needs a file
 * path, so the chosen model is copied once to app storage; the copy is reused while its size matches.
 */
object ModelStore {
    private const val DIR = "models"
    /** Preference order: the larger, more accurate model first. */
    private val PREFERRED = listOf("ggml-quran-base.bin", "ggml-quran-tiny.bin")

    fun available(ctx: Context): List<String> =
        (ctx.assets.list(DIR) ?: emptyArray()).filter { it.endsWith(".bin") }.sortedBy { PREFERRED.indexOf(it).let { i -> if (i < 0) 99 else i } }

    fun pick(ctx: Context, wanted: String?): String? {
        val all = available(ctx)
        return if (wanted != null && wanted in all) wanted else all.firstOrNull()
    }

    /** Returns the on-disk path of the model, copying it from the APK when needed. */
    fun ensure(ctx: Context, name: String): File {
        val out = File(ctx.noBackupFilesDir, name)
        val size = ctx.assets.openFd("$DIR/$name").use { it.length }
        if (out.exists() && out.length() == size) return out
        val tmp = File(out.path + ".part")
        ctx.assets.open("$DIR/$name").use { input -> tmp.outputStream().use { input.copyTo(it, 1 shl 20) } }
        if (!tmp.renameTo(out)) throw IllegalStateException("cannot store model")
        // remove other models' old copies
        ctx.noBackupFilesDir.listFiles { f -> f.name.endsWith(".bin") && f.name != name }?.forEach { it.delete() }
        return out
    }
}
