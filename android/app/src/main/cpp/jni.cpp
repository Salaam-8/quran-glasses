// JNI bridge for com.quranglasses.app.asr.WhisperNative
#include <jni.h>
#include <android/log.h>
#include <memory>
#include <mutex>
#include <string>
#include "qg_whisper.h"
#include "whisper.h"

#define TAG "QgWhisper"

namespace {
std::mutex g_log_m;
std::string g_log;                 // tail of the whisper.cpp / ggml log, for error messages

void log_cb(enum ggml_log_level level, const char * text, void *) {
    if (!text) return;
    __android_log_print(level >= GGML_LOG_LEVEL_ERROR ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO, TAG, "%s", text);
    std::lock_guard<std::mutex> lock(g_log_m);
    g_log += text;
    if (g_log.size() > 4000) g_log.erase(0, g_log.size() - 4000);
}

struct Handle {
    QgWhisper w;
    std::mutex m;
};
std::string str(JNIEnv * env, jstring s) {
    if (!s) return {};
    const char * c = env->GetStringUTFChars(s, nullptr);
    std::string r(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return r;
}
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_quranglasses_app_asr_WhisperNative_init(JNIEnv * env, jclass, jstring path, jint threads) {
    whisper_log_set(log_cb, nullptr);
    ggml_log_set(log_cb, nullptr);
    { std::lock_guard<std::mutex> lock(g_log_m); g_log.clear(); }
    auto h = std::make_unique<Handle>();
    if (!h->w.load(str(env, path), threads)) {
        __android_log_print(ANDROID_LOG_ERROR, TAG, "model load failed");
        return 0;
    }
    return reinterpret_cast<jlong>(h.release());
}

// Returns "t0\tt1\tword\n" lines (times in seconds relative to the given audio).
extern "C" JNIEXPORT jstring JNICALL
Java_com_quranglasses_app_asr_WhisperNative_transcribe(JNIEnv * env, jclass, jlong handle, jfloatArray pcm, jstring prompt, jint audioCtx) {
    auto * h = reinterpret_cast<Handle *>(handle);
    if (!h || !pcm) return env->NewStringUTF("");
    const jsize n = env->GetArrayLength(pcm);
    jfloat * data = env->GetFloatArrayElements(pcm, nullptr);
    std::string out;
    {
        std::lock_guard<std::mutex> lock(h->m);
        const int ctx = audioCtx > 0 ? audioCtx : qgAudioCtxFor(n);
        for (const auto & w : h->w.transcribe(data, n, str(env, prompt), ctx)) {
            out += std::to_string(w.t0) + "\t" + std::to_string(w.t1) + "\t" + w.text + "\n";
        }
    }
    env->ReleaseFloatArrayElements(pcm, data, JNI_ABORT);
    return env->NewStringUTF(out.c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_com_quranglasses_app_asr_WhisperNative_free(JNIEnv *, jclass, jlong handle) {
    delete reinterpret_cast<Handle *>(handle);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_quranglasses_app_asr_WhisperNative_systemInfo(JNIEnv * env, jclass) {
    return env->NewStringUTF(whisper_print_system_info());
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_quranglasses_app_asr_WhisperNative_lastLog(JNIEnv * env, jclass) {
    std::lock_guard<std::mutex> lock(g_log_m);
    return env->NewStringUTF(g_log.c_str());
}
