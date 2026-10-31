#!/usr/bin/env bash
# Converts the Quran-tuned Whisper models (Hugging Face, Apache-2.0) into quantized whisper.cpp files
# in android/build-assets/models/, which the APK ships. Needs Python with torch + transformers +
# huggingface_hub, cmake, a C++ compiler and internet access. Run by CI; the result is cached there.
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)          # android/
WORK=${WORK:-$HERE/build/models-work}
OUT=$HERE/build-assets/models
WHISPER=$HERE/third_party/whisper.cpp
mkdir -p "$WORK" "$OUT"
"$HERE/scripts/fetch-whisper.sh"
[ -d "$WORK/openai-whisper" ] || git clone --depth 1 https://github.com/openai/whisper "$WORK/openai-whisper"   # mel filters

cmake -S "$WHISPER" -B "$WORK/wbuild" -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF
cmake --build "$WORK/wbuild" --target whisper-quantize -j"$(nproc)"
QUANT=$(find "$WORK/wbuild" -type f -name whisper-quantize | head -1)

convert() {   # repo  short-name  quantization
    local repo=$1 name=$2 qtype=$3 dir="$WORK/hf-$2"
    python3 - "$repo" "$dir" <<'PY'
import json, os, shutil, sys
from huggingface_hub import hf_hub_download, snapshot_download
repo, out = sys.argv[1], sys.argv[2]
snapshot_download(repo, local_dir=out, allow_patterns=["*.json", "*.safetensors", "*.bin", "*.txt"])
# the converter needs vocab.json and added_tokens.json; newer fine-tunes may only carry tokenizer_config.json
for f in ("vocab.json", "added_tokens.json"):
    p = os.path.join(out, f)
    if os.path.exists(p):
        continue
    tc = os.path.join(out, "tokenizer_config.json")
    dec = json.load(open(tc, encoding="utf8")).get("added_tokens_decoder") if os.path.exists(tc) else None
    if f == "added_tokens.json" and dec:
        json.dump({v["content"]: int(k) for k, v in dec.items()}, open(p, "w", encoding="utf8"), ensure_ascii=False)
    else:   # same tokenizer as the multilingual base model
        shutil.copy(hf_hub_download("openai/whisper-base", f), p)
    print("filled", f)
# the converter writes config["max_length"] as the decoder text context; fine-tunes often set it to the
# generation length (e.g. 225) while the decoder position table has max_target_positions (448) rows, which
# whisper.cpp then rejects as a wrongly shaped tensor. Use the real table size.
cp = os.path.join(out, "config.json")
cfg = json.load(open(cp, encoding="utf8"))
if cfg.get("max_length") != cfg["max_target_positions"]:
    print("max_length", cfg.get("max_length"), "->", cfg["max_target_positions"])
    cfg["max_length"] = cfg["max_target_positions"]
    json.dump(cfg, open(cp, "w", encoding="utf8"), indent=1)
PY
    python3 "$WHISPER/models/convert-h5-to-ggml.py" "$dir" "$WORK/openai-whisper" "$dir"
    "$QUANT" "$dir/ggml-model.bin" "$OUT/ggml-quran-$name.bin" "$qtype"
}

convert tarteel-ai/whisper-base-ar-quran base q5_1
convert tarteel-ai/whisper-tiny-ar-quran tiny q8_0 || echo "::warning::tiny model not built (optional)"
ls -la "$OUT"
