#!/usr/bin/env bash
# Tests the "CI gate" job in .github/workflows/ci.yml: its shell step is extracted from the workflow text and run
# against a table of job results, then the workflow's structure is checked. Run: bash .github/scripts/ci-gate.test.sh

set -u
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
workflow="$here/../workflows/ci.yml"
failures=0

fail() { echo "FAIL $1"; failures=$((failures + 1)); }
pass() { echo "ok   $1"; }

body=$(sed -n '/# gate-begin/,/# gate-end/p' "$workflow" | sed '1d;$d' | sed 's/^          //')
[ -n "$body" ] || { echo 'FAIL no gate step between gate-begin and gate-end'; exit 1; }

# gate_exit RELEVANT changes test check node_server -> exit status of the real gate step
gate_exit() {
  env -i PATH="$PATH" RELEVANT="$1" RESULT_changes="$2" RESULT_test="$3" RESULT_check="$4" RESULT_node_server="$5" bash -c "$body" > /dev/null 2>&1
  echo $?
}
gate_case() { # name expected(0|1) relevant changes test check node_server
  local name=$1 expected=$2 got
  shift 2
  got=$(gate_exit "$@")
  if [ "$expected" = pass ] && [ "$got" = 0 ]; then pass "gate: $name"
  elif [ "$expected" = fail ] && [ "$got" != 0 ]; then pass "gate: $name"
  else fail "gate: $name (expected $expected, exit $got)"; fi
}

S=success K=skipped F=failure C=cancelled
gate_case 'relevant, all succeeded' pass true $S $S $S $S
gate_case 'relevant, a shard failed' fail true $S $F $S $S
gate_case 'relevant, check failed' fail true $S $S $F $S
gate_case 'relevant, node server failed' fail true $S $S $S $F
gate_case 'relevant, tests cancelled' fail true $S $C $S $S
gate_case 'relevant, check cancelled' fail true $S $S $C $S
gate_case 'relevant, tests skipped (upstream failure)' fail true $S $K $S $S
gate_case 'relevant, node server skipped' fail true $S $S $S $K
gate_case 'not relevant, all skipped' pass false $S $K $K $K
gate_case 'not relevant, tests ran' fail false $S $S $K $K
gate_case 'not relevant, a heavy job failed' fail false $S $K $F $K
gate_case 'not relevant, a heavy job cancelled' fail false $S $K $K $C
gate_case 'changes failed' fail '' $F $K $K $K
gate_case 'changes failed but output says false' fail false $F $K $K $K
gate_case 'changes failed but output says true' fail true $F $S $S $S
gate_case 'changes cancelled' fail '' $C $K $K $K
gate_case 'changes skipped' fail false $K $K $K $K
gate_case 'relevant output empty after success' fail '' $S $K $K $K
gate_case 'relevant output not a boolean' fail maybe $S $S $S $S
gate_case 'relevant output upper case' fail TRUE $S $S $S $S
unset_exit=$(env -i PATH="$PATH" RELEVANT=true RESULT_changes=success RESULT_test=success RESULT_check=success bash -c "$body" > /dev/null 2>&1; echo $?)
[ "$unset_exit" != 0 ] && pass 'gate: a missing result variable fails' || fail 'gate: a missing result variable passed'

# Structure of the workflow the table cannot see.
job() { awk -v id="$1" '$0 ~ "^  " id ":" {on=1; print; next} on && /^  [A-Za-z_-]+:/ {exit} on {print}' "$workflow"; }
has() { grep -Eq -- "$2" <<< "$1"; }

gate=$(job gate)
has "$gate" "^    name: CI gate$" && pass 'structure: the gate is named exactly CI gate' || fail 'structure: gate name'
has "$gate" "^    if: always\(\)$" && pass 'structure: the gate runs always' || fail 'structure: gate if'
has "$gate" "^    permissions: \{\}$" && pass 'structure: the gate has no permissions' || fail 'structure: gate permissions'
has "$gate" "^    runs-on:" && ! has "$gate" "uses:" && pass 'structure: the gate uses no action' || fail 'structure: gate uses an action'

jobs=$(awk '/^jobs:/ {on=1; next} on && /^  [A-Za-z_-]+:/ {sub(/^  /,""); sub(/:.*/,""); print}' "$workflow")
needs_line=$(grep -E '^    needs: \[' <<< "$gate")
for id in $jobs; do
  [ "$id" = gate ] && continue
  if grep -Eq "[[:space:]\[]$id[],]" <<< "$needs_line"; then pass "structure: the gate needs $id"; else fail "structure: the gate does not need $id"; fi
done
for id in $jobs; do
  case "$id" in gate | changes) continue ;; esac
  has "$(job "$id")" "^    if: needs.changes.outputs.relevant == 'true'$" && has "$(job "$id")" "^    needs: changes$" \
    && pass "structure: $id waits for the decision" || fail "structure: $id is not gated on the decision"
done
! has "$(job changes)" "^    if:" && pass 'structure: the changes job has no condition' || fail 'structure: the changes job is conditional'

# No other workflow may define a job that reports under the same name as the required check.
named=$(grep -rE '^    name: CI gate$' "$here/../workflows" | wc -l)
[ "$named" -eq 1 ] && pass 'structure: exactly one job is named CI gate' || fail "structure: $named jobs are named CI gate"

on_block=$(awk '/^on:/ {on=1; next} on && /^[A-Za-z]/ {exit} on {print}' "$workflow")
! has "$on_block" 'paths|paths-ignore' && pass 'structure: no path filter on a trigger' || fail 'structure: a trigger has a path filter'
! grep -Eq '^[[:space:]]*(-[[:space:]]*)?pull_request_target' "$workflow" && pass 'structure: no pull_request_target' || fail 'structure: pull_request_target'
has "$on_block" '^  pull_request:' && has "$on_block" '^  push:' && has "$on_block" '^  workflow_dispatch:' && pass 'structure: pull_request, push and workflow_dispatch triggers' || fail 'structure: triggers'

# Token scope of every workflow: never pull_request_target, always an explicit top-level permissions block.
workflows_dir="$here/../workflows"
! grep -Eq '^[[:space:]]*(-[[:space:]]*)?pull_request_target' "$workflows_dir"/*.yml && pass 'structure: no workflow uses pull_request_target' || fail 'structure: a workflow uses pull_request_target'
for file in "$workflows_dir"/*.yml; do
  grep -q '^permissions:' "$file" && pass "structure: $(basename "$file") sets top-level permissions" || fail "structure: $(basename "$file") has no top-level permissions"
done
if [ -f "$workflows_dir/labeler.yml" ]; then
  grep -Eq 'uses: actions/labeler@[0-9a-f]{40} # v[0-9]' "$workflows_dir/labeler.yml" && pass 'structure: the labeler action is pinned to a SHA with its version' || fail 'structure: the labeler action is not SHA-pinned'
  grep -Eq '^      pull-requests: write$' "$workflows_dir/labeler.yml" && ! grep -Eq '^\s+(contents|issues|actions|checks|packages): write' "$workflows_dir/labeler.yml" && pass 'structure: the labeler asks for pull-requests write only' || fail 'structure: labeler permissions'
fi

# Every shard of the vitest split must be in the matrix, or an unrun shard would never fail anything.
denominator=$(sed -n 's/.*--shard=\${{ matrix.shard }}\/\([0-9][0-9]*\).*/\1/p' "$workflow" | head -n 1)
matrix=$(sed -n 's/^        shard: \[\(.*\)\]$/\1/p' "$workflow" | head -n 1 | tr -d ' ')
expected=$(seq -s, 1 "${denominator:-0}")
[ -n "$denominator" ] && [ "$matrix" = "$expected" ] && pass "structure: shard matrix $matrix covers 1/$denominator..$denominator/$denominator" || fail "structure: shard matrix '$matrix' does not cover the /$denominator split"

if [ "$failures" -ne 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo 'all ci-gate cases passed'
