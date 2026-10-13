#!/bin/bash
# full-bounds violation search per mutant (parallel explorer, stops at first violation; trace NOT necessarily shortest)
cd "$(dirname "$0")"
for m in "$@"; do
  bash run.sh pm_$m 900 pexplore.mjs $m --workers 26 --bits 30
  echo "$m $(cut -c1-30 logs/pm_$m.status) $(grep -m1 '"states"' logs/pm_$m.out) $(grep -m1 'Trace' logs/pm_$m.out)" >> logs/mut3.summary
done
