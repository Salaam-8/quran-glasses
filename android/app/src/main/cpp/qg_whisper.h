// Thin C++ layer over whisper.cpp for streaming recitation recognition.
// Returns one entry per word with start/end times (seconds) relative to the audio passed in.
#pragma once
#include <string>
#include <vector>

struct whisper_context;

struct QgWord {
    float t0;
    float t1;
    std::string text;
};

class QgWhisper {
public:
    ~QgWhisper();
    bool load(const std::string & modelPath, int threads);
    // pcm: mono float samples at 16 kHz in [-1, 1]. prompt: previous text for context (may be empty).
    // audioCtx: encoder context in frames (0 = full 30 s); smaller is faster for short buffers.
    std::vector<QgWord> transcribe(const float * pcm, int n, const std::string & prompt, int audioCtx);
    bool loaded() const { return ctx_ != nullptr; }

private:
    whisper_context * ctx_ = nullptr;
    int threads_ = 4;
};

// Encoder context (frames) for a buffer of n samples: 50 frames per second, plus one second of margin.
int qgAudioCtxFor(int nSamples);
