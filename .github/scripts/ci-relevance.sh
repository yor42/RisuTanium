#!/usr/bin/env bash
# Decides whether a change needs the heavy CI jobs (unit tests, type check and build, server smoke test).
#
#   ci-relevance.sh paths [-0]   changed paths on stdin, newline-separated (-0: NUL-separated)
#   ci-relevance.sh git EVENT    the diff of the checked-out commit, as the CI "changes" job runs it
#
# Prints "relevant=true|false" and "reason=<fixed text>"; the CI job appends both to GITHUB_OUTPUT.
# A change is light only when every changed path is Markdown, under Agents/, or under docs/ outside
# docs/design/ (the theme-pack validator bundles docs/design, so it stays relevant). Anything else, an
# empty list, or any doubt prints relevant=true: a needless full run costs minutes, a skipped run on
# code is a false green. Path names come from the pull request, so they never reach the output raw.

set -u

emit() {
  printf 'relevant=%s\nreason=%s\n' "$1" "$2"
}

is_light() {
  case "$1" in
    # Tests collect, import or read files under these roots (Agents/Tools/*.test.mjs and its data, README.md assertions
    # under src and theme-packs), so a change there is never light, Markdown included.
    Agents/Tools/* | src/* | theme-packs/*) return 1 ;;
    *.md) return 0 ;;
    docs/design/*) return 1 ;;
    docs/* | Agents/*) return 0 ;;
    *) return 1 ;;
  esac
}

# Reads paths from stdin; $1 is the read delimiter ('' for NUL, newline otherwise).
classify() {
  local delim=$1 path total=0 first=''
  while IFS= read -r -d "$delim" path || [ -n "$path" ]; do
    [ -n "$path" ] || continue
    total=$((total + 1))
    if [ -z "$first" ] && ! is_light "$path"; then
      first=$(printf '%s' "$path" | tr -c 'A-Za-z0-9._/@+-' '?' | cut -c1-120)
    fi
    path=''
  done
  if [ "$total" -eq 0 ]; then
    emit true 'no changed paths listed'
  elif [ -n "$first" ]; then
    emit true "changes outside docs, Agents and Markdown, first: $first"
  else
    emit false "only docs, Agents and Markdown changed ($total paths)"
  fi
}

mode_git() {
  local event=${1:-} list
  case "$event" in
    pull_request)
      git rev-parse --verify -q 'HEAD^1' > /dev/null 2>&1 || { emit true 'checked-out commit has no first parent'; return; }
      [ -n "${PR_HEAD_SHA:-}" ] && [ "$(git rev-parse --verify -q 'HEAD^2' 2> /dev/null)" = "$PR_HEAD_SHA" ] ||
        { emit true 'checked-out commit is not the merge of the pull request head'; return; }
      ;;
    push)
      [ -n "${PUSH_BEFORE:-}" ] && [ "$(git rev-parse --verify -q 'HEAD^1' 2> /dev/null)" = "$PUSH_BEFORE" ] ||
        { emit true 'push is not a single step on the previous tip'; return; }
      ;;
    *) emit true "event ${event:-unset} always runs everything"; return ;;
  esac
  list=$(mktemp) || { emit true 'no temporary file'; return; }
  if ! git diff --name-only -z --no-renames 'HEAD^1' 'HEAD' > "$list" 2> /dev/null; then
    rm -f "$list"
    emit true 'git diff failed'
    return
  fi
  classify '' < "$list"
  rm -f "$list"
}

case "${1:-}" in
  paths)
    if [ "${2:-}" = '-0' ]; then classify '' ; else classify $'\n'; fi
    ;;
  git) mode_git "${2:-}" ;;
  *) emit true 'usage: ci-relevance.sh paths [-0] | git EVENT' ;;
esac
