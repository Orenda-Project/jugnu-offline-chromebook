#!/bin/bash
# Copies the browser libraries out of node_modules into speech/lib/ (gitignored), where jugnu-speech.js looks for them.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p lib
T=node_modules/@huggingface/transformers
cp "$T/dist/transformers.min.js" lib/
cp "$T/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs" "$T/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm" lib/
cp node_modules/onnxruntime-web/dist/ort.wasm.min.mjs node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm lib/
cp node_modules/vosk-browser/dist/vosk.js lib/
ls -la lib
