#!/usr/bin/env bash
# Loads every model in android/build-assets/models with whisper-cli on the build machine and decodes a
# sample, so a bad conversion fails here with whisper.cpp's own messages instead of on the device.
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
WHISPER=$HERE/third_party/whisper.cpp
B=$HERE/build/verify-whisper
cmake -S "$WHISPER" -B "$B" -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF > /dev/null
cmake --build "$B" --target whisper-cli -j"$(nproc)" > /dev/null
CLI=$(find "$B" -type f -name whisper-cli | head -1)
for m in "$HERE"/build-assets/models/*.bin; do
    echo "=== $(basename "$m") ($(stat -c %s "$m") bytes)"
    head -c 4 "$m" | od -An -tx1
    "$CLI" -m "$m" -f "$WHISPER/samples/jfk.wav" -l ar -t 4 -np -ml 1 -sow 2>&1 | tail -20
done
