#include "qg_whisper.h"
#include "whisper.h"
#include <algorithm>
#include <cctype>

QgWhisper::~QgWhisper() {
    if (ctx_) whisper_free(ctx_);
}

bool QgWhisper::load(const std::string & modelPath, int threads) {
    if (ctx_) { whisper_free(ctx_); ctx_ = nullptr; }
    whisper_context_params cp = whisper_context_default_params();
    cp.use_gpu = false;
    ctx_ = whisper_init_from_file_with_params(modelPath.c_str(), cp);
    threads_ = std::max(1, threads);
    return ctx_ != nullptr;
}

int qgAudioCtxFor(int nSamples) {
    const int frames = (nSamples / 16000 + 1) * 50;   // encoder: 50 frames per second
    return std::min(1500, std::max(150, frames));
}

static std::string trim(const std::string & s) {
    size_t a = 0, b = s.size();
    while (a < b && std::isspace((unsigned char) s[a])) a++;
    while (b > a && std::isspace((unsigned char) s[b - 1])) b--;
    return s.substr(a, b - a);
}

std::vector<QgWord> QgWhisper::transcribe(const float * pcm, int n, const std::string & prompt, int audioCtx) {
    std::vector<QgWord> out;
    if (!ctx_ || n <= 0) return out;

    whisper_full_params p = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    p.language = "ar";
    p.detect_language = false;
    p.translate = false;
    p.n_threads = threads_;
    p.no_context = true;              // context comes only from our prompt
    p.single_segment = false;
    p.print_special = false;
    p.print_progress = false;
    p.print_realtime = false;
    p.print_timestamps = false;
    p.token_timestamps = true;        // word timing for the streaming commit policy
    p.max_len = 1;                    // with split_on_word: one segment per word
    p.split_on_word = true;
    p.suppress_blank = true;
    p.suppress_nst = true;
    p.temperature = 0.0f;
    p.temperature_inc = 0.0f;         // no fallback re-decodes: predictable latency
    p.greedy.best_of = 1;
    p.no_speech_thold = 0.6f;
    p.audio_ctx = audioCtx;
    p.initial_prompt = prompt.empty() ? nullptr : prompt.c_str();

    if (whisper_full(ctx_, p, pcm, n) != 0) return out;

    const int ns = whisper_full_n_segments(ctx_);
    for (int i = 0; i < ns; i++) {
        std::string t = trim(whisper_full_get_segment_text(ctx_, i));
        if (t.empty() || t[0] == '[' || t[0] == '(') continue;   // [MUSIC], (noise) and similar
        const float t0 = whisper_full_get_segment_t0(ctx_, i) / 100.0f;   // centiseconds -> seconds
        const float t1 = whisper_full_get_segment_t1(ctx_, i) / 100.0f;
        out.push_back({ t0, t1, t });
    }
    return out;
}
