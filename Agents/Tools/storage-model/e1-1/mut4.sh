#!/bin/bash
# shortest counterexample (BFS) at the full E1 bounds, capped; summary line per mutant/control
cd "$(dirname "$0")"
for m in "$@"; do
  timeout 420 node bfs.mjs $m --bits 27 --cap 30000000 --out logs/bs_$m.json > logs/bs_$m.out 2> logs/bs_$m.err
  echo "$m exit=$? $(head -1 logs/bs_$m.out | cut -c1-130) $(grep -m1 Trace logs/bs_$m.out)" >> logs/mut4.summary
done
