#!/usr/bin/env bash
# Tests vitest-summary.mjs on a report written by the real vitest JSON reporter (fixtures/vitest-report.json: one passing
# file, one file that failed to load, one file with two failed tests and a skipped one) and on generated oversize reports.
# Run: bash .github/scripts/vitest-summary.test.sh

set -u
# Git Bash on Windows would rewrite the path-looking GITHUB_WORKSPACE value; Linux CI needs neither line.
export MSYS2_ENV_CONV_EXCL=GITHUB_WORKSPACE
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
summary="$here/vitest-summary.mjs"
fixture="$here/fixtures/vitest-report.json"
work=$(mktemp -d)
if command -v cygpath > /dev/null; then work=$(cygpath -m "$work"); fi
trap 'rm -rf "$work"' EXIT
failures=0

ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; failures=$((failures + 1)); }
expect() { # name condition-exit-status
  if [ "$2" -eq 0 ]; then ok "$1"; else bad "$1"; fi
}

out="$work/summary.md"
GITHUB_WORKSPACE=/home/runner/work/RisuTanium/RisuTanium GITHUB_STEP_SUMMARY="$out" node "$summary" "$fixture" 'unit tests, shard 2/3'
expect 'exits 0 on a report with failures' $?
grep -q '^### Failed tests: unit tests, shard 2/3$' "$out"; expect 'heading carries the shard label' $?
grep -q '3 failure(s)' "$out"; expect 'counts the two failed tests and the file that failed to load' $?
grep -q 'src/sample.test.js` > `suite A fails with a diff`' "$out"; expect 'names file and test, relative to the workspace' $?
grep -q 'to deeply equal { a: 1, b: \[ 1, 3 \] }' "$out"; expect 'shows the assertion message' $?
grep -q 'file level failure' "$out"; expect 'shows a file-level failure' $?
! grep -q '    at ' "$out"; expect 'leaves stack frames out' $?
! grep -q 'runner/work' "$out"; expect 'no absolute runner path in the summary' $?
fences=$(grep -c '^ *```' "$out")
[ "$fences" -eq 6 ]; expect 'a message with backticks cannot add or close a code fence (6 fence lines for 3 failures)' $?

# A message whose own lines are code fences stays inside the block.
printf '%s' '{"success":false,"testResults":[{"name":"/w/a.test.ts","status":"failed","assertionResults":[{"fullName":"t `x`","status":"failed","failureMessages":["```\n# not a heading\n```\n    at x"]}]}]}' > "$work/fence.json"
node "$summary" "$work/fence.json" f > "$work/fence.md"
[ "$(grep -c '^ *```' "$work/fence.md")" -eq 2 ]; expect 'a message made of code fences cannot close the block' $?

printf 'earlier content\n' > "$work/existing.md"
GITHUB_STEP_SUMMARY="$work/existing.md" node "$summary" "$fixture" x
head -n 1 "$work/existing.md" | grep -q '^earlier content$'; expect 'appends to the summary file, never replaces it' $?

node "$summary" "$work/missing.json" 'shard 1/3' | grep -q 'No readable vitest report'
expect 'a missing report is reported, not fatal' ${PIPESTATUS[0]}
printf '{ not json' > "$work/corrupt.json"
node "$summary" "$work/corrupt.json" 'shard 1/3' > /dev/null; expect 'a corrupt report exits 0' $?
GITHUB_STEP_SUMMARY="$work/no-such-dir/summary.md" node "$summary" "$fixture" x > /dev/null 2>&1; expect 'an unwritable summary path exits 0' $?

# 400 failures with 200-line messages stay under the size cap and say what was left out.
node -e '
const fail = (i) => ({ fullName: `suite t${i}`, status: "failed", failureMessages: [Array.from({ length: 200 }, (_, n) => `line ${n} ${"x".repeat(200)}`).join("\n")] })
const report = { success: false, testResults: [{ name: "/w/a.test.ts", status: "failed", message: "", assertionResults: Array.from({ length: 400 }, (_, i) => fail(i)) }] }
require("fs").writeFileSync(process.argv[1], JSON.stringify(report))' "$work/big.json"
GITHUB_STEP_SUMMARY="$work/big.md" node "$summary" "$work/big.json" big
size=$(wc -c < "$work/big.md")
[ "$size" -lt 210000 ]; expect "an oversize report stays under the cap ($size bytes)" $?
grep -q 'more failure(s) not listed' "$work/big.md"; expect 'an oversize report says what was left out' $?
lines=$(grep -c 'more line(s)' "$work/big.md")
[ "$lines" -ge 1 ]; expect 'a long message is cut with a line count' $?

printf '{"success":false,"testResults":[]}' > "$work/silent.json"
node "$summary" "$work/silent.json" s | grep -q 'without a failed test'; expect 'a failed run with no failed test points at the log' ${PIPESTATUS[0]}

if [ "$failures" -ne 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo 'all vitest-summary cases passed'
