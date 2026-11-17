#!/bin/bash
# Mirrors the candidate models into speech/models/ (gitignored) so the measurements run with no network.
# Pinned revisions: the same URLs the module fetches at Get ready.
set -euo pipefail
cd "$(dirname "$0")/.."
UA="read-aloud-bench/0.1"
hf() { # repo revision file...
  local repo=$1 rev=$2; shift 2
  for f in "$@"; do
    mkdir -p "models/$repo/$(dirname "$f")"
    [ -s "models/$repo/$f" ] || curl -fsSL -A "$UA" -o "models/$repo/$f" "https://huggingface.co/$repo/resolve/$rev/$f"
  done
}
TJS="config.json generation_config.json preprocessor_config.json tokenizer.json tokenizer_config.json onnx/encoder_model_quantized.onnx onnx/decoder_model_merged_quantized.onnx"
hf onnx-community/moonshine-tiny-ONNX a6da1241cd305dcd64eab1edbd615f2bb9aabb95 $TJS
hf onnx-community/moonshine-base-ONNX b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad $TJS
hf onnx-community/whisper-tiny        ff4177021cc41f7db950912b73ea4fdf7d01d8e7 $TJS
hf onnx-community/whisper-base        27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c $TJS
hf onnx-community/whisper-tiny.en     794207fec2761281fe63a23a94b7e9f53a4efbc1 $TJS

# Vosk small English (Kaldi), repacked as the .tar.gz vosk-browser loads
mkdir -p models/vosk
if [ ! -s models/vosk/vosk-model-small-en-us-0.15.tar.gz ]; then
  t=$(mktemp -d models/vosk/dl.XXXX)
  curl -fsSL -A "$UA" -o "$t/m.zip" https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
  (cd "$t" && unzip -q m.zip && tar -czf ../vosk-model-small-en-us-0.15.tar.gz vosk-model-small-en-us-0.15)
  rm -rf "$t"
fi

# Dolphin base CTC (DataoceanAI, Apache-2.0; sherpa-onnx's int8 export): Urdu and 39 other Eastern languages
mkdir -p models/dolphin
if [ ! -s models/dolphin/base/model.int8.onnx ]; then
  t=$(mktemp -d models/dolphin/dl.XXXX)
  curl -fsSL -A "$UA" -o "$t/m.tar.bz2" https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-dolphin-base-ctc-multi-lang-int8-2025-04-02.tar.bz2
  (cd "$t" && tar -xjf m.tar.bz2)
  mkdir -p models/dolphin/base && cp "$t"/*/model.int8.onnx "$t"/*/tokens.txt models/dolphin/base/
  rm -rf "$t"
fi
du -sh models/*/* 2>/dev/null
