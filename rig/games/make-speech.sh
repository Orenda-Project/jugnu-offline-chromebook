#!/bin/bash
# Speech for the rig's microphone (read-aloud items), written to logs/speech/ (not committed):
#   en.wav  the battery's English story read by the Mac's voice (macOS `say`)
#   ur.wav  real Urdu speech: Jugnu's own recording of the Urdu listening story (the Mac has no Urdu voice)
#   quiet.wav  5 s of silence (the "no voice" path)
# 16-bit PCM, 16 kHz mono, the shape Chrome's --use-file-for-fake-audio-capture wants.
#   CB_BASE=http://localhost:8812 bash rig/games/make-speech.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
BASE="${CB_BASE:-http://localhost:8812}"
OUT=logs/speech; mkdir -p "$OUT"
curl -fsS -m 60 "$BASE/sa/batteries/sa.game.G1.en.json" -o "$OUT/battery.json"
node -e '
const fs=require("fs"); const b=JSON.parse(fs.readFileSync(process.argv[1]+"/battery.json","utf8"));
const t=(id)=>b.tasks.find((x)=>x.id===id);
fs.writeFileSync(process.argv[1]+"/en.txt", t("en.story").passage.text.replace(/\s+/g," "));
fs.writeFileSync(process.argv[1]+"/ur.clip", t("ur.listening").passage.audio);
' "$OUT"
say -v Samantha -r 150 -o "$OUT/en.aiff" -f "$OUT/en.txt" 2>/dev/null || say -r 150 -o "$OUT/en.aiff" -f "$OUT/en.txt"
afconvert -f WAVE -d LEI16@16000 -c 1 "$OUT/en.aiff" "$OUT/en.wav"
curl -fsS -m 60 "$BASE/$(cat "$OUT/ur.clip")" -o "$OUT/ur.mp3"
afconvert -f WAVE -d LEI16@16000 -c 1 "$OUT/ur.mp3" "$OUT/ur.wav"
node -e 'const fs=require("fs");const n=16000*5*2;const h=Buffer.alloc(44);h.write("RIFF",0);h.writeUInt32LE(36+n,4);h.write("WAVEfmt ",8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(16000,24);h.writeUInt32LE(32000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write("data",36);h.writeUInt32LE(n,40);fs.writeFileSync(process.argv[1]+"/quiet.wav",Buffer.concat([h,Buffer.alloc(n)]));' "$OUT"
rm -f "$OUT/en.aiff" "$OUT/battery.json" "$OUT/ur.clip"
ls -la "$OUT"
