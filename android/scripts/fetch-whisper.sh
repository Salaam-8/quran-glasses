#!/usr/bin/env bash
# Fetches the pinned whisper.cpp source used by the native speech engine (android/third_party/).
set -euo pipefail
TAG=${WHISPER_TAG:-v1.9.5}
DIR=$(cd "$(dirname "$0")/.." && pwd)/third_party/whisper.cpp
if [ -f "$DIR/CMakeLists.txt" ]; then exit 0; fi
git clone --depth 1 --branch "$TAG" https://github.com/ggml-org/whisper.cpp "$DIR"
