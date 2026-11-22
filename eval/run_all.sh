#!/bin/sh
# Runs every experiment in order. Safe to stop and restart: finished experiments are skipped.
cd "$(dirname "$0")/.."
for e in scripted-vs-scripted stealth5-vs-stealth1 stealth1-hider night5-seeker night1-seeker \
         ai8-seeker-vs-scripted scripted-vs-ai8-hider ai8-vs-ai8 ai8-no-memory ai8-memory5 \
         ai14-seeker-vs-ai8 ai8-seeker-vs-ai14; do
  node eval/run.mjs "$e" || echo "FAILED: $e"
done
echo ALL DONE
