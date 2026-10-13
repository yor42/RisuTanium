#!/bin/bash
# usage: run.sh <logname> <capSeconds> <explorer-args...>   e.g. run.sh p1 1500 pexplore.mjs e1_node --workers 24 --bits 30 --set damage=0
# Writes logs/<logname>.{out,err,json,status}. Exit status recorded in logs/<logname>.status (0 pass, 2 violation, 4 table full, 124 cap).
cd "$(dirname "$0")"
name=$1; cap=$2; shift 2
mkdir -p logs
start=$(date +%s)
timeout "$cap" node "$@" --out "logs/$name.json" > "logs/$name.out" 2> "logs/$name.err"
rc=$?
end=$(date +%s)
echo "exit=$rc seconds=$((end-start)) cmd=node $*" > "logs/$name.status"
