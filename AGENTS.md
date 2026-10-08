# RisuTanium / RisuAI working instructions

This is a targeted stabilization and improvement campaign, not a rewrite. Use a senior-orchestrator workflow: keep discovery, implementation, independent review and arbitration in separate contexts when the agent system permits it. Do not assume the orchestrator's model identity.

## Start with the smallest relevant context

- Read [Agents/README.md](Agents/README.md) for document authority and [Live-State](Agents/Live-State.md) for dated current state.
- Locate maintainer decisions through [Decision-Index](Agents/Decision-Index.md), then read the relevant original `MC-` entries in [Maintainer-Context](Agents/Maintainer-Context.md). Every subagent brief names the relevant IDs; where a product decision is missing, ask the maintainer rather than inventing it.
- Detailed local policy: [routing](docs/workflow/routing.md), [gates](docs/workflow/gates.md), [project reference](docs/workflow/project-reference.md). Claude skill entry point: `campaign-workflow`.
- A tiny, targeted lookup may run inline. Delegate substantial batched surveys to `code-searcher`; behavior questions go to `investigator`. Keep each dispatch bounded by a question, named files or search scope, acceptance evidence and write ownership.

## Compatibility and authorization

- `.bin` backups must travel upstream → fork and fork → upstream without loss. Upstream need not read the fork's own storage directly. Upstream-compatible characters, modules, presets, plugins and supported integrations continue to work (MC-175).
- Sole size exception: fork → upstream may omit data larger than upstream can hold only after a warning naming it and confirmation before export starts. Upstream → fork must always work (MC-223).
- This fork has never shipped; upstream has the users. Fork-local behavior is not a reason to preserve a defect, and there is no release pressure (MC-011). Do not design recovery for already-corrupted fork-local state.
- Scope may be amended for agreed mobile behavior, necessary technical prerequisites, shared-cause corrections or an explicit complexity reduction. Record the failure, causal connection and smallest coherent correction. New product trade-offs remain the maintainer's (MC-091).
- Preserve existing working changes and untracked files. Do not overwrite, revert, stash, reset or clean someone else's work. Stage only named paths; no blanket staging. Commit or push only within the maintainer's actual authorization.
- Do not edit `docs/wiki/**`, `docs/branding/**`, `docs/Terms-of-Services.md`, `docs/Privacy-Policy.md` or `src/lib/Others/Legal.svelte` without the applicable authorization. Preserve `.claude/launch.json`, the existing Android manifest edits and the handoff evidence.
- Never read or quote signing secrets (`src-tauri/key.txt`, keystores, `keystore.properties`). Two community-code directories are protected; the rest of the evidence tree is not blanket-protected or ignored (MC-027; exact paths in the project reference). Inspect only task-relevant evidence; never quote protected code.

## Implementation traps

- `DBState` is a rune-based plain reactive object: `DBState.db`, never `$DBState`. Legitimate writable-store subscriptions remain valid. Use Svelte 5 runes appropriately.
- Do not use `any` or `unknown` as a lazy type-error fix. Use domain types; `unknown` at an actual boundary followed by narrowing is appropriate.
- Use custom theme colors from `src/styles.css` (`textcolor`, `textcolor2`, `bgcolor`, `darkbg`, `darkbutton`, `selected`, `borderc`, `darkborderc`, `draculared`); opacity modifiers are supported. Inspect `colorscheme.ts` only for theme work.
- No configured formatter/linter: match surrounding style by hand. Preserve each file's line endings; no formatter across an edited file.
- Code/test comments state invariants and consequences, not investigation history. No repository line numbers in comments. Dated reports may cite verified `file:line` evidence.
- Dirty tracking must retain every mutation dependency. Partition work without dropping dependencies; narrowing can silently omit saved blocks.
- Persisted kinds use the page's byte store in `storage/store/appStore.ts`; do not add platform bypasses. OPFS is transitional fallback/copy-back, not the normal web write store. Trace the current code before changing storage.
- Check the actual build's `src-tauri/Cargo.lock` before citing crate source: `Cargo.toml` ranges do not pin resolved versions. Check `package.json` and the installed dependencies rather than copying dated version claims.
- Sanitized-markup tests use jsdom (`// @vitest-environment jsdom`); happy-dom sanitizer output is not evidence. Prove an identity sanitizer makes relevant assertions fail (MC-239).
- Translator owns all non-English locales, including Korean; preserve the maintainer's edits, keys, interpolations, CBS tags and line endings (MC-058).

## Gates and evidence

- Every AI-authored application-code change gets a fresh independent post-implementation review. Nontrivial changes also get an independent plan review; uncertain risk uses both.
- Save/persistence, save format, reactive database, asset caching or silent data-loss risk use `opus-reviewer`. Expensive-to-reverse plans receive `senior-advisor` challenge before implementation.
- Three consecutive substantive `[REJECT]` rounds require advisor escalation before a fourth revision. `[EDITORIAL]` neither counts nor breaks the streak. At the second rejection, reconsider the mechanism.
- Every AI-authored investigative report requires independent verification before final acceptance. Raw helper location/triage packets are inputs, not independently accepted reports. Documentation flow: evidence/code-reader → doc-writer → independent doc-verifier → orchestrator. Reviewers never mutate repository files; scratch experiments stay outside the tree.
- Evidence names sources or commands plus applicable code, dirty/untracked changes, dependencies, runtime, configuration and inputs. HEAD alone is insufficient. Independently check decision-critical high-risk inferences; an agent's VERIFIED label is not evidence.
- Distinguish regression reproducers (intended defect fails on the relevant pre-fix base), compatibility guards (may pass before and after) and diagnostic experiments. Mocked success does not prove native behavior.
- One named owner runs full `pnpm test`, `pnpm check` and the relevant build on the final application snapshot. Remediation uses targeted tests and type checks; repeat full checks when their applicability changes. Documentation-only edits do not trigger application tests.
- Before substantial Gate 1 work, size the mechanism/subsystems/stages and settle decision-critical product/error behavior; unresolved product questions block affected implementation. Tiny low-risk tasks keep the carve-out. See [gates](docs/workflow/gates.md).
- An item is COMPLETE only after applicable decisions, gates, status and remaining-work records are current; record closeout uses incremental verification, not an automatic Gate 2 restart. See [records](docs/workflow/records.md).
- Narrow independent Haiku verification is limited to the approved [10-item pilot](docs/workflow/review-pilot.md); [write ownership](docs/workflow/ownership.md) keeps one app-code writer per checkout and exact named document ownership.
- Budgets prompt reassessment, never acceptance of incomplete work. Preserve useful context; reset only when size, contamination or scope warrants it. Do not invent token costs or unmeasured savings.

## Commands and navigation

| Need | Command / source |
|---|---|
| Web development / build | `pnpm dev` / `pnpm build` |
| Hosted web build | `pnpm buildsite` |
| Desktop development / build | `pnpm tauri dev` / `pnpm tauri build` |
| Tests / type checks | `pnpm test` / `pnpm check` |
| Hono build | `pnpm hono:build` |
| Workflow validation / decision index | [docs/workflow/README.md](docs/workflow/README.md) |
| Measurement procedures | [Agents/Tools/README.md](Agents/Tools/README.md) |

Use the shell/tool actually available. Check a profile's real tool grant before promising it a tool. Kill only processes you own; do not remove a shared `node_modules` junction recursively. No probes of external community services; use synthetic fixtures.
