#!/usr/bin/env bash
# Table test for ci-relevance.sh: the path rules, then the git mode on throwaway repositories.
# Run from anywhere: bash .github/scripts/ci-relevance.test.sh

set -u
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
script="$here/ci-relevance.sh"
failures=0

check() { # name expected actual
  if [ "$2" = "$3" ]; then
    echo "ok   $1"
  else
    echo "FAIL $1: expected relevant=$2, got relevant=$3"
    failures=$((failures + 1))
  fi
}

relevant_of() { sed -n 's/^relevant=//p' | head -n 1; }

paths_case() { # name expected path...   (newline-separated stdin)
  local name=$1 expected=$2
  shift 2
  check "paths: $name" "$expected" "$(printf '%s\n' "$@" | bash "$script" paths | relevant_of)"
}

paths_case 'code' true src/ts/foo.ts
paths_case 'docs only' false docs/workflow/gates.md docs/Privacy-Policy.md
paths_case 'docs non-markdown' false docs/branding/logo.svg
paths_case 'docs/design stylesheet' true docs/design/tokens.css
paths_case 'docs/design markdown' false docs/design/README.md
paths_case 'Agents notes' false Agents/mc/ticket.md Agents/Workflow-State.json
paths_case 'root markdown' false README.md
paths_case 'markdown under src' true src/lib/Notes.md
paths_case 'README read by a test' true theme-packs/README.md src/ts/drive/tests/rtbGoldens/README.md
paths_case 'Agents tool test' true Agents/Tools/full-run/classify.test.mjs
paths_case 'Agents tool data' true Agents/Tools/save-gen/c806-library.mjs
paths_case 'Agents notes outside Tools' false Agents/Lanes/x/brief.md Agents/mc/t.md
paths_case 'mixed docs and code' true docs/a.md src/ts/foo.ts
paths_case 'workflow file' true .github/workflows/ci.yml
paths_case 'claude config' true .claude/settings.json
paths_case 'package.json' true package.json
paths_case 'lockfile' true pnpm-lock.yaml
paths_case 'upper-case extension is not light' true NOTES.MD
paths_case 'lookalike Agents prefix' true AgentsX/file.json
paths_case 'lookalike docs prefix' true docsx/file.json
paths_case 'Agents directory name without slash' true Agents
paths_case 'empty list' true
paths_case 'blank line only' true ''

# Names with spaces, a newline or workflow-command text never reach the output raw.
out=$(printf 'src/a b.ts\0' | bash "$script" paths -0)
check 'paths -0: space in name' true "$(printf '%s\n' "$out" | relevant_of)"
out=$(printf 'docs/a.md\0src/x\nrelevant=false\0' | bash "$script" paths -0)
check 'paths -0: newline in name' true "$(printf '%s\n' "$out" | relevant_of)"
check 'paths -0: injected output line is not echoed' 2 "$(printf '%s\n' "$out" | grep -c '=')"
out=$(printf '::error::boom\n' | bash "$script" paths)
check 'paths: workflow-command name is sanitised' 0 "$(printf '%s\n' "$out" | grep -c '^::')"
check 'paths: no trailing newline on the last path' true "$(printf 'docs/a.md\nsrc/b.ts' | bash "$script" paths | relevant_of)"

# A large change list is read to the end; the last path decides a list of light ones.
big_docs=$(for i in $(seq 1 5000); do echo "docs/n/$i.md"; done)
check 'paths: 5000 light paths' false "$(printf '%s
' "$big_docs" | bash "$script" paths | relevant_of)"
check 'paths: code path after 5000 light paths' true "$(printf '%s
src/late.ts
' "$big_docs" | bash "$script" paths | relevant_of)"

# Git mode on throwaway repositories (never the checkout this runs from).
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
g() { git -C "$work/r" -c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false -c core.autocrlf=false "$@"; }
mkdir "$work/r" && g init -q -b main
mkdir -p "$work/r/src" "$work/r/docs"
echo a > "$work/r/src/a.ts"; echo d > "$work/r/docs/d.md"
g add -A && g commit -q -m base
base=$(g rev-parse HEAD)

merge_branch() { # branch  (the branch is already committed)
  g checkout -q main && g merge -q --no-ff -m "merge $1" "$1"
}
git_case() { # name expected event [env assignments...]
  local name=$1 expected=$2 event=$3
  shift 3
  check "git: $name" "$expected" "$(cd "$work/r" && env "$@" bash "$script" git "$event" | relevant_of)"
}

g checkout -q -b docsonly && echo d2 > "$work/r/docs/d2.md" && g add -A && g commit -q -m docs
docs_head=$(g rev-parse HEAD)
merge_branch docsonly
git_case 'pull_request docs-only merge' false pull_request "PR_HEAD_SHA=$docs_head"
git_case 'pull_request with the wrong head sha' true pull_request "PR_HEAD_SHA=$base"
git_case 'pull_request without head sha' true pull_request
docs_merge=$(g rev-parse HEAD)
git_case 'push docs-only merge' false push "PUSH_BEFORE=$base"
git_case 'push whose before is not the first parent' true push "PUSH_BEFORE=$docs_merge"
git_case 'push without before' true push
git_case 'push of a new branch (all-zero before)' true push "PUSH_BEFORE=0000000000000000000000000000000000000000"
git_case 'workflow_dispatch' true workflow_dispatch
git_case 'unset event' true ''

g checkout -q -b code && echo b >> "$work/r/src/a.ts" && g add -A && g commit -q -m code
code_head=$(g rev-parse HEAD)
before_code=$(g rev-parse main)
merge_branch code
git_case 'pull_request code merge' true pull_request "PR_HEAD_SHA=$code_head"
git_case 'push code merge' true push "PUSH_BEFORE=$before_code"

# A rename out of src into docs shows both paths with --no-renames, so the deleted source counts.
g checkout -q -b mv && mkdir -p "$work/r/docs" && g mv src/a.ts docs/a.md && g commit -q -m mv
mv_head=$(g rev-parse HEAD)
merge_branch mv
git_case 'rename from src into docs' true pull_request "PR_HEAD_SHA=$mv_head"

# A single-parent HEAD (a fast-forward or a shallow root) never decides on its own.
g checkout -q -b single && echo c > "$work/r/docs/c.md" && g add -A && g commit -q -m single
git_case 'single-parent head' true pull_request "PR_HEAD_SHA=$(g rev-parse HEAD)"
g checkout -q --orphan rootless && g commit -q --allow-empty -m root
git_case 'root commit' true pull_request "PR_HEAD_SHA=$(g rev-parse HEAD)"

if [ "$failures" -ne 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo 'all ci-relevance cases passed'
