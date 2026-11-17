#!/bin/bash
# Speed and memory of each candidate, one at a time on a quiet machine: 6 clean passage readings per language
# (about 3 minutes of sound), at 1x and with Chrome's CPU throttle. Usage: bash bench/speed.sh [throttle=8]
set -euo pipefail
cd "$(dirname "$0")/.."
T=${1:-8}
R=bench/results/raw
run() { node bench/run.mjs --port 8870 --set syn --kinds passage --noise clean --filter story01.clean. --isolate "$@"; }
for t in 1 "$T"; do
  run --lang en --engines moonshine-tiny,moonshine-base --opts '{"bias":4}' --tag b4 --throttle "$t" --out "$R/speed.en.moonshine.t$t.jsonl"
  run --lang en --engines whisper-tiny.en,whisper-base,vosk-small-en --throttle "$t" --out "$R/speed.en.other.t$t.jsonl"
  run --lang ur --engines dolphin-base,whisper-base --throttle "$t" --out "$R/speed.ur.t$t.jsonl"
done
