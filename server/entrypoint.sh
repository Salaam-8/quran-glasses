#!/bin/sh
# First start: convert the Quran-tuned Whisper model to CTranslate2 int8 (kept in the /models volume).
set -e
MODEL_ID="${ASR_MODEL_ID:-tarteel-ai/whisper-base-ar-quran}"
DIR="/models/$(echo "$MODEL_ID" | tr '/' '_')"
if [ ! -f "$DIR/model.bin" ]; then
  echo "converting $MODEL_ID -> $DIR (one time, a few minutes)"
  ct2-transformers-converter --model "$MODEL_ID" --output_dir "$DIR" --quantization int8 \
    --copy_files tokenizer.json preprocessor_config.json || \
  ct2-transformers-converter --model "$MODEL_ID" --output_dir "$DIR" --quantization int8
fi
export ASR_MODEL="$DIR"
exec python asr_server.py
